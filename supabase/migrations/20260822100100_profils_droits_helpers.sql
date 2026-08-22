-- ============================================================================
-- Profils de droits — M2/9 : moteur de calcul des droits effectifs.
-- Réf : spec-profils-droits.md §2.2 (combinaison PAR COUPLE), RM-25 à RM-30 ·
-- architecture-profils-droits.md ADR-01, ADR-04, ADR-05.
-- Aucune policy dans ce fichier : uniquement des fonctions STABLE/IMMUTABLE.
-- Toutes SECURITY DEFINER, search_path = '' (anti-récursion). EXECUTE révoqué
-- de PUBLIC/anon systématiquement ; accordé à authenticated UNIQUEMENT pour
-- les fonctions évaluées par le RLS ou exposées comme RPC (advisor 0029 assumé
-- — même posture que les helpers existants, docs/data-model.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- request_scope_org — organisation Socle PORTEUSE DES DROITS pour un couple
-- (tenant, destinataire éventuel) : le destinataire s'il est connu du miroir
-- (obsolète comprise, RM-30), la racine Socle du tenant sinon (RM-27/RM-28).
-- Utilisée par le trigger requests_set_scope_org (M3) et par
-- user_has_request_right ci-dessous (évite de dupliquer la résolution).
-- ----------------------------------------------------------------------------
create or replace function public.request_scope_org(p_org_id uuid, p_socle_org_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.socle_id from public.socle_organizations m
      where m.organization_id = p_org_id and m.socle_id = p_socle_org_id),
    (select o.socle_org_id from public.organizations o where o.id = p_org_id)
  );
$$;
comment on function public.request_scope_org(uuid, uuid) is
  'Organisation Socle porteuse des droits : destinataire si connu du miroir du tenant, racine sinon (RM-27/28). Fonction interne, pas de EXECUTE client (utilisée par des DEFINER).';
revoke execute on function public.request_scope_org(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- permission_profile_scope — expansion SEULE du périmètre d'un profil
-- (sous-arbre, profondeur bornée à 10, anti-cycle — RM-26, parité
-- has_socle_org_access de l'architecture §4.2). Extraite de permission_pairs_of
-- pour ne PAS dupliquer la récursion (utilisée aussi par my_rights, M5).
-- Les nœuds obsolètes participent (RM-30).
-- ----------------------------------------------------------------------------
create or replace function public.permission_profile_scope(p_profile_id uuid)
returns table (socle_org_id uuid)
language sql stable security definer set search_path = '' as $$
  with recursive tree as (
    select po.socle_org_id, 1 as depth, array[po.socle_org_id] as seen
      from public.permission_profile_organizations po
     where po.profile_id = p_profile_id
    union all
    select m.socle_id, t.depth + 1, t.seen || m.socle_id
      from tree t
      join public.socle_organizations m
        on m.organization_id = (select p.organization_id
                                   from public.permission_profiles p where p.id = p_profile_id)
       and m.socle_parent_id = t.socle_org_id
     where t.depth < 10 and not (m.socle_id = any(t.seen))
  )
  select distinct socle_org_id from tree;
$$;
comment on function public.permission_profile_scope(uuid) is
  'Périmètre EXPANSÉ (sous-arbre) d''un profil, indépendant des droits accordés. Profondeur bornée à 10, anti-cycle (RM-26). Interne : pas de EXECUTE authenticated direct (passe par my_rights, M5).';
revoke execute on function public.permission_profile_scope(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- permission_pairs_of — MOTEUR UNIQUE de la sémantique « par couple » (§2.2).
-- p_right ∈ consultation | creation | instruction | cloture | ecriture
--   (« ecriture » = creation OU instruction OU cloture — RM-15, policy UPDATE)
-- Aucune seconde implémentation de cette sémantique n'existe côté SQL : toutes
-- les policies et tous les contrôles unitaires passent par ici (ADR-04).
-- ----------------------------------------------------------------------------
create or replace function public.permission_pairs_of(
  p_profile_ids uuid[], p_right text, p_org_id uuid default null)
returns table (organization_id uuid, socle_org_id uuid, socle_procedure_id uuid)
language sql stable security definer set search_path = ''
as $$
  with recursive prof as (
    select p.id, p.organization_id,
           case p_right
             when 'consultation' then p.default_view
             when 'creation'     then p.default_create
             when 'instruction'  then p.default_process
             when 'cloture'      then p.default_close
             when 'ecriture'     then (p.default_create or p.default_process or p.default_close)
           end as by_default
      from public.permission_profiles p
     where p.id = any(p_profile_ids)
       and (p_org_id is null or p.organization_id = p_org_id)
  ),
  tree as (
    select pr.id as profile_id, pr.organization_id, pr.by_default,
           po.socle_org_id, 1 as depth, array[po.socle_org_id] as seen
      from prof pr
      join public.permission_profile_organizations po on po.profile_id = pr.id
    union all
    select t.profile_id, t.organization_id, t.by_default,
           m.socle_id, t.depth + 1, t.seen || m.socle_id
      from tree t
      join public.socle_organizations m
        on m.organization_id = t.organization_id
       and m.socle_parent_id = t.socle_org_id
     where t.depth < 10 and not (m.socle_id = any(t.seen))
  ),
  listed as (   -- démarches explicitement listées accordant le droit demandé
    select distinct t.organization_id, t.socle_org_id, pp.socle_procedure_id
      from tree t
      join public.permission_profile_procedures pp on pp.profile_id = t.profile_id
     where case p_right
             when 'consultation' then pp.right_view
             when 'creation'     then pp.right_create
             when 'instruction'  then pp.right_process
             when 'cloture'      then pp.right_close
             when 'ecriture'     then (pp.right_create or pp.right_process or pp.right_close)
           end
  ),
  defaulted as (
    select distinct t.profile_id, t.organization_id, t.socle_org_id
      from tree t where t.by_default
  ),
  -- Le « défaut » se déplie sur le cache COURANT des démarches (obsolètes
  -- comprises, CL-10) + la pseudo-démarche « sans démarche » (RM-36). Une
  -- démarche future entre dans l'ensemble dès qu'elle est synchronisée : rien
  -- à recalculer (RM-32). Une ligne EXPLICITE dans la matrice (même à 4
  -- booléens FALSE) prime sur le défaut : exclue via NOT EXISTS.
  from_default as (
    select d.organization_id, d.socle_org_id, c.socle_id
      from defaulted d
      join public.socle_procedure_cache c on c.organization_id = d.organization_id
     where not exists (select 1 from public.permission_profile_procedures x
                        where x.profile_id = d.profile_id and x.socle_procedure_id = c.socle_id)
    union
    select d.organization_id, d.socle_org_id, public.nil_procedure()
      from defaulted d
     where not exists (select 1 from public.permission_profile_procedures x
                        where x.profile_id = d.profile_id
                          and x.socle_procedure_id = public.nil_procedure())
  )
  select * from listed
  union
  select * from from_default;
$$;
comment on function public.permission_pairs_of(uuid[], text, uuid) is
  'Moteur UNIQUE de la sémantique « par couple » (organisation, démarche). Interne : aucune EXECUTE client, uniquement appelée par des DEFINER (my_permission_pairs, user_has_request_right, save_permission_profile, assert_editor_can_manage_profile…).';
revoke execute on function public.permission_pairs_of(uuid[], text, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- my_permission_pairs — enveloppe des policies (auth.uid() est STABLE → la
-- sous-requête reste NON CORRÉLÉE, hashed SubPlan, ADR-04).
--
-- ⚠️ Pas de paramètre d'exclusion (retiré lors de la relecture du
-- 2026-08-22, point 1) : la première version anti-escalade excluait le
-- profil contrôlé des droits de l'éditeur, mais évaluée APRÈS mutation, elle
-- cassait RM-51 pour le cas ordinaire — un administrateur dont l'UNIQUE
-- profil est justement celui édité (ex. le fondateur avec son profil
-- « Administrateur » de reprise) se voyait refuser jusqu'à un simple
-- renommage. La non-escalade de save_permission_profile (M5) compare
-- désormais l'état APRÈS mutation à une PRÉ-IMAGE des droits de l'éditeur
-- capturée AVANT toute mutation — jamais besoin d'exclure un profil
-- puisqu'on ne compare jamais un profil à lui-même après l'avoir modifié.
-- ----------------------------------------------------------------------------
create or replace function public.my_permission_pairs(p_right text)
returns table (organization_id uuid, socle_org_id uuid, socle_procedure_id uuid)
language sql stable security definer set search_path = '' as $$
  select * from public.permission_pairs_of(
    array(select a.profile_id
            from public.permission_profile_assignments a
            join public.permission_profiles p on p.id = a.profile_id
           where a.user_id = auth.uid() and p.status = 'active'),
    p_right, null);
$$;
comment on function public.my_permission_pairs(text) is
  'Couples autorisés pour l''utilisateur COURANT (auth.uid()). Utilisée par les policies RLS (IN non corrélé).';
revoke execute on function public.my_permission_pairs(text) from public, anon;
grant  execute on function public.my_permission_pairs(text) to authenticated;

-- ----------------------------------------------------------------------------
-- user_has_request_right — contrôle UNITAIRE, MÊME moteur, arguments BRUTS
-- (normalisation interne via request_scope_org / nil_procedure). Utilisée par
-- requests_guard_write (M8, RM-13/16/18/21), eligible_assignees (M5).
--
-- ⚠️ p_user_id est LIBRE (n'importe quel utilisateur, pas seulement
-- auth.uid()) et la fonction est GRANT à authenticated (nécessaire pour
-- RM-16 : vérifier le droit du DESTINATAIRE d'une affectation, pas de
-- l'auteur du geste). Sans garde, un client authentifié pourrait appeler
-- cette RPC directement pour SONDER les droits d'un tiers quelconque
-- (fuite d'information sur l'organisation d'autrui). Restriction : si
-- l'appel provient d'un contexte CLIENT (voir piège ci-dessous) et porte
-- sur un AUTRE utilisateur que l'appelant, il faut que l'appelant ET la
-- cible soient tous deux membres du tenant interrogé — sinon réponse FALSE
-- (jamais d'erreur : cette fonction reste un simple prédicat).
--
-- Piège DEFINER/current_user (vérifié empiriquement, 2026-08-22) : à
-- l'intérieur d'une fonction SECURITY DEFINER, current_user devient le
-- PROPRIÉTAIRE de la fonction (ex. postgres), y compris quand elle est
-- appelée en cascade depuis une AUTRE fonction SECURITY DEFINER (le
-- changement de current_user n'est PAS restauré entre deux DEFINER
-- imbriqués) — is_service_context()/current_user ne permettent donc PAS de
-- savoir de façon fiable si l'appelant d'ORIGINE est un client authentifié.
-- current_setting('role', true), en revanche, reflète le rôle POSITIONNÉ
-- PAR POSTGREST POUR LA REQUÊTE (SET LOCAL ROLE authenticated|service_role)
-- et N'EST PAS affecté par SECURITY DEFINER — c'est le seul signal fiable
-- pour distinguer un appel client (authenticated) d'un appel service_role
-- ou d'un contexte de migration/test (postgres), même en profondeur
-- derrière plusieurs fonctions DEFINER imbriquées. Cette leçon s'applique à
-- TOUTE garde posée à l'intérieur d'une fonction DEFINER dans ce projet :
-- ne jamais y utiliser is_service_context() (motif exact du redesign de M4).
-- ----------------------------------------------------------------------------
create or replace function public.user_has_request_right(
  p_user_id uuid, p_org_id uuid, p_socle_org_id uuid,
  p_socle_procedure_id uuid, p_right text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if current_setting('role', true) = 'authenticated'
     and p_user_id is distinct from auth.uid()
     and not (
       public.is_org_member(p_org_id)
       and exists (select 1 from public.organization_members m
                    where m.organization_id = p_org_id and m.user_id = p_user_id)
     ) then
    return false;
  end if;

  return coalesce((select u.is_platform_admin from public.users u where u.id = p_user_id), false)
      or exists (
        select 1 from public.permission_pairs_of(
                 array(select a.profile_id
                         from public.permission_profile_assignments a
                         join public.permission_profiles p on p.id = a.profile_id
                        where a.user_id = p_user_id
                          and a.organization_id = p_org_id
                          and p.status = 'active'),
                 p_right, p_org_id) s
         where s.socle_org_id = public.request_scope_org(p_org_id, p_socle_org_id)
           and s.socle_procedure_id = coalesce(p_socle_procedure_id, public.nil_procedure())
      );
end;
$$;
comment on function public.user_has_request_right(uuid,uuid,uuid,uuid,text) is
  'Contrôle unitaire du droit d''un utilisateur sur le couple porté par une demande (arguments bruts, non normalisés). Même moteur que permission_pairs_of. Sondage d''un tiers restreint aux co-membres du même tenant côté client (current_setting(''role'',true) = ''authenticated'') — service_role et appels internes DEFINER passent.';
revoke execute on function public.user_has_request_right(uuid,uuid,uuid,uuid,text) from public, anon;
grant  execute on function public.user_has_request_right(uuid,uuid,uuid,uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- has_admin_scope — administration (RM-23), PAR organisation (remontée
-- d'ascendance : un profil admin sur Voirie couvre Voirie et ses descendants ;
-- on remonte ici de l'organisation TESTÉE vers ses ANCÊTRES pour vérifier
-- qu'un des ancêtres — ou elle-même — est dans le périmètre d'un profil admin).
-- Pas de paramètre d'exclusion (retiré, voir my_permission_pairs ci-dessus —
-- même motif : la non-escalade de save_permission_profile compare désormais
-- l'état post-mutation à une pré-image capturée avant toute mutation).
-- ----------------------------------------------------------------------------
create or replace function public.has_admin_scope(p_org_id uuid, p_socle_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select m.socle_id, m.socle_parent_id, 1 as depth, array[m.socle_id] as seen
      from public.socle_organizations m
     where m.organization_id = p_org_id and m.socle_id = p_socle_org_id
    union all
    select m.socle_id, m.socle_parent_id, u.depth + 1, u.seen || m.socle_id
      from up u
      join public.socle_organizations m
        on m.organization_id = p_org_id and m.socle_id = u.socle_parent_id
     where u.depth < 10 and not (m.socle_id = any(u.seen))
  )
  select public.is_platform_admin() or exists (
    select 1
      from public.permission_profile_assignments a
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_admin
      join public.permission_profile_organizations po on po.profile_id = p.id
     where a.user_id = auth.uid() and a.organization_id = p_org_id
       and (po.socle_org_id in (select socle_id from up) or po.socle_org_id = p_socle_org_id)
  );
$$;
comment on function public.has_admin_scope(uuid, uuid) is
  'Administration effective de l''utilisateur courant sur une organisation donnée (RM-21/23) : union des périmètres de ses profils actifs is_admin, remontée d''ascendance bornée à 10 (RM-26).';
revoke execute on function public.has_admin_scope(uuid, uuid) from public, anon;
grant  execute on function public.has_admin_scope(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- is_org_admin_anywhere — administration « quelque part dans le tenant » :
-- ouvre la zone Paramètres (RM-20), gouverne l'entrée de toutes les RPC
-- d'écriture (M5, contrôle initial avant vérification fine par organisation).
-- ----------------------------------------------------------------------------
create or replace function public.is_org_admin_anywhere(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.permission_profile_assignments a
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_admin
     where a.user_id = auth.uid() and a.organization_id = p_org_id
  );
$$;
comment on function public.is_org_admin_anywhere(uuid) is
  'Vrai si l''utilisateur courant détient administration sur AU MOINS UNE organisation du tenant (RM-20). Gouverne l''accès à la zone Paramètres et l''entrée des RPC d''écriture des profils.';
revoke execute on function public.is_org_admin_anywhere(uuid) from public, anon;
grant  execute on function public.is_org_admin_anywhere(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- has_any_creation_right — droit de création « quelque part dans le tenant » :
-- storage de brouillon (RM-59) et socle-proxy /v1/contacts/* (RM-64).
-- has_any_creation_right_for : variante paramétrée par utilisateur, RÉVOQUÉE
-- des clients — appelée en service_role par l'edge function socle-proxy.
-- ----------------------------------------------------------------------------
create or replace function public.has_any_creation_right(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.my_permission_pairs('creation') s
     where s.organization_id = p_org_id);
$$;
comment on function public.has_any_creation_right(uuid) is
  'Vrai si l''utilisateur courant détient création sur au moins un couple du tenant (RM-59, RM-64). Utilisée par la policy storage INSERT (brouillon).';
revoke execute on function public.has_any_creation_right(uuid) from public, anon;
grant  execute on function public.has_any_creation_right(uuid) to authenticated;

create or replace function public.has_any_creation_right_for(p_user_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_platform_admin from public.users u where u.id = p_user_id), false)
      or exists (
        select 1 from public.permission_pairs_of(
                 array(select a.profile_id
                         from public.permission_profile_assignments a
                         join public.permission_profiles p on p.id = a.profile_id
                        where a.user_id = p_user_id and a.organization_id = p_org_id
                          and p.status = 'active'),
                 'creation', p_org_id) s
      );
$$;
comment on function public.has_any_creation_right_for(uuid, uuid) is
  'Variante service_role de has_any_creation_right, paramétrée par utilisateur : appelée par socle-proxy (RM-64), jamais par un client.';
revoke execute on function public.has_any_creation_right_for(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- can_read/write/process/admin_request — ÉCART ASSUMÉ vs la carte de
-- couplage : ces quatre enveloppes lisent public.requests.socle_scope_org_id,
-- colonne créée seulement en M3. Une fonction LANGUAGE SQL est analysée
-- (parse tree résolu, comme une vue) AU MOMENT de CREATE FUNCTION — contrairement
-- à PL/pgSQL dont le corps est opaque jusqu'au premier appel — donc les créer
-- ici échouerait (colonne inexistante). Elles sont définies à la FIN de
-- 20260822100200_requests_scope_org.sql (M3), juste après la colonne et son
-- index. Rien d'autre ne change : mêmes signatures, même comportement.
-- ----------------------------------------------------------------------------
