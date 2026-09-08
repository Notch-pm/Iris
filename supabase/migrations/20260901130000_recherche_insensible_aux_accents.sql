-- ============================================================================
-- Recherche globale (barre du header) — INSENSIBLE AUX ACCENTS.
--
-- `ilike` ignore la casse, jamais les accents : « eclairage » ne trouvait pas
-- « Éclairage ». Or personne ne tape les diacritiques dans une barre de
-- recherche, et un usager au téléphone épelle rarement « Benoît » avec son
-- accent circonflexe.
--
-- La normalisation ne peut PAS vivre dans le navigateur : elle doit être la
-- même des deux côtés de la comparaison, et seul Postgres connaît le texte
-- stocké. On ne fabrique donc pas de jumeau JavaScript d'`unaccent` (ils
-- auraient divergé sur « cœur », « ß », « ø »…) : la saisie est envoyée telle
-- quelle à une RPC qui normalise LES DEUX CÔTÉS avec la même fonction.
--
-- `security invoker` VOULU : le RLS s'applique à l'appelant, la recherche ne
-- rend donc que les demandes de son périmètre — exactement ce que rendait la
-- requête PostgREST qu'elle remplace.
-- ⚠️ Ne jamais la passer en SECURITY DEFINER : ce serait une fuite hors
-- périmètre (et le piège `current_user` documenté dans CLAUDE.md).
-- ============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- `unaccent()` est STABLE (il dépend d'un dictionnaire que l'on peut recharger),
-- or un index d'expression exige de l'IMMUTABLE. Enveloppe standard, avec le
-- dictionnaire NOMMÉ explicitement : sans cela, la fonction dépendrait du
-- search_path de l'appelant, ce que `set search_path = ''` interdit.
create or replace function public.immutable_unaccent(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text)
$$;

comment on function public.immutable_unaccent(text) is
  'unaccent() rendu IMMUTABLE (dictionnaire nommé) pour servir dans un index d''expression. Fonction de texte pure : aucune donnée, aucun droit.';

-- Texte cherché d'une demande : code de suivi ET libellé, en minuscules sans
-- accents. Le corps et le formulaire figé n'y entrent PAS — les balayer ferait
-- de chaque frappe un scan du tenant, et une réponse d'usager n'a rien à faire
-- dans une liste de résultats.
create or replace function public.request_search_text(p_reference text, p_subject text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.immutable_unaccent(lower(coalesce(p_reference, '') || ' ' || coalesce(p_subject, '')))
$$;

comment on function public.request_search_text(text, text) is
  'Texte cherché d''une demande (référence + objet, minuscules sans accents). Unique porteuse de cette définition : l''index et search_requests l''appellent tous deux.';

-- ⚠️ Ces deux fonctions gardent leur EXECUTE à PUBLIC, contrairement aux
-- fonctions trigger et aux RPC de service : elles sont appelées à l'intérieur
-- d'une fonction SECURITY INVOKER (donc avec les droits de l'appelant) et par
-- l'index ci-dessous, que toute écriture dans `requests` doit maintenir —
-- ingestion partenaire en service_role comprise. Les révoquer casserait les
-- insertions. Elles ne lisent aucune donnée : ce sont des fonctions de texte.

-- L'index rend la recherche possible à volume : `like '%…%'` n'utilise aucun
-- btree, seul un GIN trigramme le sert. L'expression est celle de la RPC, au
-- mot près — sinon le planificateur ne reconnaîtrait pas l'index.
create index if not exists requests_search_trgm_idx
  on public.requests
  using gin (public.request_search_text(reference, subject) extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- La recherche elle-même.
-- ----------------------------------------------------------------------------
-- Noms de colonnes de sortie DISTINCTS de ceux de `requests` : en `language
-- sql`, les colonnes d'un RETURNS TABLE sont des paramètres OUT visibles dans
-- le corps (même piège que `contact_request_counts`).
create or replace function public.search_requests(
  p_org_id uuid,
  p_query  text,
  p_limit  int default 6
)
returns table (
  request_id          uuid,
  request_reference   text,
  request_subject     text,
  request_status      text,
  request_received_at timestamptz,
  request_assigned_to uuid,
  request_organisme   text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.reference, r.subject, r.status, r.received_at,
         r.assigned_to, r.socle_organization_label
    from public.requests r
   where r.organization_id = p_org_id
     -- Jumeau SQL de MIN_QUERY_LENGTH (src/features/search/search.ts) : la
     -- garde vit ICI aussi, un appel direct ne doit pas pouvoir demander
     -- « tout le tenant » avec une saisie d'un caractère. `coalesce` d'abord :
     -- un NULL rendrait la condition NULL, donc fausse — mais silencieusement.
     and char_length(btrim(coalesce(p_query, ''))) >= 3
     and public.request_search_text(r.reference, r.subject) like
         '%' || replace(replace(replace(
                  public.immutable_unaccent(lower(btrim(p_query))),
                  '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by r.received_at desc
   limit least(greatest(coalesce(p_limit, 6), 1), 20);
$$;

comment on function public.search_requests(uuid, text, int) is
  'Recherche globale : demandes du tenant dont la référence ou l''objet contient la saisie, accents et casse ignorés. SECURITY INVOKER — bornée au périmètre du lecteur par le RLS.';

-- Les métacaractères de LIKE sont échappés côté serveur (antislash d'abord,
-- sinon on échapperait ses propres échappements) : « 100 % » cherche un
-- pourcentage, pas un joker.

revoke execute on function public.search_requests(uuid, text, int) from public, anon;
grant  execute on function public.search_requests(uuid, text, int) to authenticated;
