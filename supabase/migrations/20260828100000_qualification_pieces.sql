-- ============================================================================
-- Qualification des pièces justificatives (décisions PO, 2026-08-28).
--
-- L'agent déclare chaque pièce CONFORME ou NON CONFORME, avec un motif pris
-- dans un catalogue fermé de cinq et, s'il veut, une précision libre.
--   . une pièce OBLIGATOIRE non conforme, pas encore qualifiée, ou jamais
--     déposée ferme « Résoudre positivement » — et elle seule : on refuse
--     souvent PARCE QU'une pièce manque, et une pièce qui cloche doit pouvoir
--     mettre le dossier en attente ;
--   . déclarer une pièce non conforme place la demande « En attente
--     d'information » (le statut `en_attente` existe déjà et porte exactement
--     ce libellé — aucun 8e statut, l'invariant du workflow fixe tient) ;
--   . le retour en instruction reste un geste d'agent : l'UI le PROPOSE quand
--     tout est redevenu conforme, elle ne le fait pas à sa place.
--
-- CE QUE « OBLIGATOIRE » VEUT DIRE : la garde ne peut pas se contenter des
-- lignes déposées — une exigence jamais honorée n'a aucune ligne. Elle relit
-- donc `procedure_snapshot -> 'form_schema'` et rejoue les conditions sur
-- `form_data`, comme le fait l'écran. D'où le JUMEAU SQL du moteur de
-- conditions ci-dessous, miroir EXACT de
-- `supabase/functions/create-request-from-procedure/_shared/procedureForm.ts`
-- (parseCondition / parseField / parseNode / parseFormSchema / evaluateRule /
-- evaluateCondition / fieldIsVisible / attachmentIsRequired / dataKey).
--
-- ⚠️ La FIDÉLITÉ DU PARSEUR est ce qui compte, pas sa tolérance : côté TS, un
-- seul nœud illisible rend le schéma ENTIER vide (parité Socle). Le jumeau SQL
-- refait ce choix à l'identique. Sans cela, la base bloquerait sur une exigence
-- que l'écran ne sait pas afficher — un refus qu'un agent ne pourrait ni
-- comprendre ni lever. En cas de doute, le SQL ne trouve AUCUNE exigence et
-- ne bloque rien : la dégradation va toujours dans le sens qui laisse
-- travailler.
--
-- Reprise : les demandes déjà en cours n'ont aucune pièce qualifiée. Elles ne
-- pourront donc être résolues positivement qu'après qualification — c'est le
-- comportement voulu, pas un effet de bord.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Les colonnes de qualification, sur la pièce elle-même
--
-- Une pièce = un verdict. La LECTURE, elle, se fait par exigence du formulaire
-- (un champ « pièce » qui accepte plusieurs fichiers n'est satisfait que si
-- TOUS le sont) — c'est le rôle de form_attachment_requirements plus bas.
-- ----------------------------------------------------------------------------

alter table public.request_attachments
  add column if not exists compliance       text,
  add column if not exists compliance_motif text,
  add column if not exists compliance_note  text,
  add column if not exists compliance_by    uuid references public.users(id),
  add column if not exists compliance_at    timestamptz;

alter table public.request_attachments drop constraint if exists request_attachments_compliance_values;
alter table public.request_attachments add constraint request_attachments_compliance_values
  check (compliance is null or compliance in ('conforme', 'non_conforme'));

alter table public.request_attachments drop constraint if exists request_attachments_compliance_motif_values;
alter table public.request_attachments add constraint request_attachments_compliance_motif_values
  check (compliance_motif is null or compliance_motif in (
    'nom_inattendu', 'illisible', 'format_non_pris_en_charge', 'incomplete', 'non_a_jour'));

alter table public.request_attachments drop constraint if exists request_attachments_compliance_note_len;
alter table public.request_attachments add constraint request_attachments_compliance_note_len
  check (compliance_note is null or (btrim(compliance_note) <> '' and length(compliance_note) <= 500));

-- Cohérence : pas de motif sans non-conformité, pas de trace sans verdict.
alter table public.request_attachments drop constraint if exists request_attachments_compliance_coherente;
alter table public.request_attachments add constraint request_attachments_compliance_coherente
  check (
    case
      when compliance is null then
        compliance_motif is null and compliance_note is null
        and compliance_by is null and compliance_at is null
      when compliance = 'non_conforme' then
        compliance_motif is not null and compliance_by is not null and compliance_at is not null
      else
        compliance_motif is null and compliance_by is not null and compliance_at is not null
    end
  );

comment on column public.request_attachments.compliance is
  'Qualification par un agent : NULL = pas encore examinée, ''conforme'', ''non_conforme''. Écrite EXCLUSIVEMENT par la RPC qualify_request_attachment (aucune policy UPDATE cliente sur cette table).';
comment on column public.request_attachments.compliance_motif is
  'Catalogue FERMÉ, jumeau de NONCONFORMITY_MOTIFS (src/features/requests/instruction/conformite.ts). Obligatoire si non conforme, interdit sinon.';
comment on column public.request_attachments.compliance_note is
  'Précision libre facultative de l''agent (500 caractères). Reprise telle quelle dans le courriel de signalement : elle est écrite POUR l''usager.';

-- ============================================================================
-- 2. Jumeau SQL du moteur de formulaire (contrat Socle form_schema v1)
--
-- Toutes IMMUTABLE et sans accès aux tables : ce sont des fonctions de calcul
-- pur sur du jsonb. EXECUTE révoqué partout — rien ici n'est une API cliente,
-- l'écran a son propre exemplaire en TypeScript.
-- ============================================================================

-- parseCondition(raw) !== null — une condition ABSENTE est valide (undefined).
create or replace function public.form_condition_valid(p_raw jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  r jsonb;
begin
  if p_raw is null or jsonb_typeof(p_raw) = 'null' then return true; end if;
  if jsonb_typeof(p_raw) <> 'object' then return false; end if;
  if coalesce(p_raw ->> 'combinator', '') not in ('and', 'or') then return false; end if;
  if jsonb_typeof(p_raw -> 'rules') <> 'array' then return false; end if;

  for r in select * from jsonb_array_elements(p_raw -> 'rules') loop
    if jsonb_typeof(r) <> 'object' then return false; end if;
    if jsonb_typeof(r -> 'fieldId') <> 'string' then return false; end if;
    if jsonb_typeof(r -> 'operator') <> 'string'
       or (r ->> 'operator') not in ('equals', 'notEquals', 'includes', 'isEmpty', 'isNotEmpty') then
      return false;
    end if;
    -- value : chaîne, tableau de chaînes, ou absente. Présente à `null` = invalide
    -- (parité stricte : côté TS, `r.value !== undefined` attrape le null JSON).
    if r ? 'value' then
      if jsonb_typeof(r -> 'value') = 'array' then
        if exists (select 1 from jsonb_array_elements(r -> 'value') v
                    where jsonb_typeof(v) <> 'string') then
          return false;
        end if;
      elsif jsonb_typeof(r -> 'value') <> 'string' then
        return false;
      end if;
    end if;
  end loop;
  return true;
end;
$$;
revoke execute on function public.form_condition_valid(jsonb) from public, anon, authenticated;

-- isEmptyValue(value) — undefined/null, chaîne blanche, tableau vide.
create or replace function public.form_value_empty(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then true
    when jsonb_typeof(p_value) = 'string' then btrim(p_value #>> '{}') = ''
    when jsonb_typeof(p_value) = 'array'  then jsonb_array_length(p_value) = 0
    else false
  end;
$$;
revoke execute on function public.form_value_empty(jsonb) from public, anon, authenticated;

-- asScalar(value) — premier élément d'un tableau, sinon la valeur, sinon ''.
create or replace function public.form_rule_target(p_value jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_value is null then ''
    when jsonb_typeof(p_value) = 'array' then
      coalesce((p_value -> 0) #>> '{}', '')
    else coalesce(p_value #>> '{}', '')
  end;
$$;
revoke execute on function public.form_rule_target(jsonb) from public, anon, authenticated;

-- ruleEquals(fieldValue, target) — un tableau vaut « contient ».
create or replace function public.form_rule_equals(p_field jsonb, p_target text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_field is null or jsonb_typeof(p_field) = 'null' then false
    when jsonb_typeof(p_field) = 'array' then
      exists (select 1 from jsonb_array_elements(p_field) e where e #>> '{}' = p_target)
    else (p_field #>> '{}') = p_target
  end;
$$;
revoke execute on function public.form_rule_equals(jsonb, text) from public, anon, authenticated;

-- ruleIncludes(fieldValue, target) — tableau : appartenance ; chaîne : sous-chaîne.
create or replace function public.form_rule_includes(p_field jsonb, p_target text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_field is null then false
    when jsonb_typeof(p_field) = 'array' then
      exists (select 1 from jsonb_array_elements(p_field) e where e #>> '{}' = p_target)
    when jsonb_typeof(p_field) = 'string' then strpos(p_field #>> '{}', p_target) > 0
    else false
  end;
$$;
revoke execute on function public.form_rule_includes(jsonb, text) from public, anon, authenticated;

-- evaluateCondition(condition, values). Condition absente ou sans règle = vraie.
create or replace function public.form_condition_met(p_condition jsonb, p_values jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_or     boolean;
  r        jsonb;
  v_field  jsonb;
  v_target text;
  v_op     text;
  v_hit    boolean;
  v_any    boolean := false;
  v_all    boolean := true;
  v_count  int := 0;
begin
  if p_condition is null or jsonb_typeof(p_condition) <> 'object' then return true; end if;
  if jsonb_typeof(p_condition -> 'rules') <> 'array'
     or jsonb_array_length(p_condition -> 'rules') = 0 then
    return true;
  end if;
  v_or := (p_condition ->> 'combinator') = 'or';

  for r in select * from jsonb_array_elements(p_condition -> 'rules') loop
    v_count  := v_count + 1;
    v_field  := coalesce(p_values, '{}'::jsonb) -> (r ->> 'fieldId');
    v_target := public.form_rule_target(r -> 'value');
    v_op     := r ->> 'operator';

    if v_op = 'isEmpty' then
      v_hit := public.form_value_empty(v_field);
    elsif v_op = 'isNotEmpty' then
      v_hit := not public.form_value_empty(v_field);
    elsif v_op = 'equals' then
      v_hit := public.form_rule_equals(v_field, v_target);
    elsif v_op = 'notEquals' then
      v_hit := not public.form_rule_equals(v_field, v_target);
    elsif v_op = 'includes' then
      v_hit := public.form_rule_includes(v_field, v_target);
    else
      v_hit := false;   -- opérateur inconnu : jamais satisfait (parité TS)
    end if;

    v_any := v_any or v_hit;
    v_all := v_all and v_hit;
  end loop;

  if v_count = 0 then return true; end if;
  return case when v_or then v_any else v_all end;
end;
$$;
revoke execute on function public.form_condition_met(jsonb, jsonb) from public, anon, authenticated;

-- parseField(raw) !== null.
create or replace function public.form_field_valid(p_raw jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_type text;
  o      jsonb;
begin
  if p_raw is null or jsonb_typeof(p_raw) <> 'object' then return false; end if;
  if jsonb_typeof(p_raw -> 'type') <> 'string' then return false; end if;
  -- parseCommon
  if jsonb_typeof(p_raw -> 'id') <> 'string'
     or jsonb_typeof(p_raw -> 'key') <> 'string'
     or jsonb_typeof(p_raw -> 'label') <> 'string' then
    return false;
  end if;
  if not public.form_condition_valid(p_raw -> 'visibleIf') then return false; end if;

  v_type := p_raw ->> 'type';
  if v_type = 'attachment' then
    return public.form_condition_valid(p_raw -> 'requiredIf');
  end if;
  if v_type in ('select', 'radio', 'checkboxes') then
    if jsonb_typeof(p_raw -> 'options') = 'array' then
      for o in select * from jsonb_array_elements(p_raw -> 'options') loop
        if jsonb_typeof(o) <> 'object'
           or jsonb_typeof(o -> 'value') <> 'string'
           or jsonb_typeof(o -> 'label') <> 'string' then
          return false;
        end if;
      end loop;
    end if;
    return true;
  end if;
  return v_type in ('text', 'textarea', 'number', 'date', 'email', 'phone', 'boolean');
end;
$$;
revoke execute on function public.form_field_valid(jsonb) from public, anon, authenticated;

-- parseNode(raw) !== null.
create or replace function public.form_node_valid(p_raw jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
begin
  if p_raw is null or jsonb_typeof(p_raw) <> 'object' then return false; end if;
  if p_raw -> 'kind' = '"section"'::jsonb then
    if jsonb_typeof(p_raw -> 'id') <> 'string'
       or jsonb_typeof(p_raw -> 'title') <> 'string' then
      return false;
    end if;
    if not public.form_condition_valid(p_raw -> 'visibleIf') then return false; end if;
    if jsonb_typeof(p_raw -> 'fields') = 'array' then
      for f in select * from jsonb_array_elements(p_raw -> 'fields') loop
        if not public.form_field_valid(f) then return false; end if;
      end loop;
    end if;
    return true;
  end if;
  return public.form_field_valid(p_raw);
end;
$$;
revoke execute on function public.form_node_valid(jsonb) from public, anon, authenticated;

-- parseFormSchema(raw) — contenu valide, ou tableau VIDE (un seul nœud illisible
-- vide le schéma entier : parité Socle, et dégradation qui ne bloque rien).
create or replace function public.form_schema_content(p_form_schema jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  n jsonb;
begin
  if p_form_schema is null or jsonb_typeof(p_form_schema) <> 'object' then
    return '[]'::jsonb;
  end if;
  if (p_form_schema ? 'version') and (p_form_schema -> 'version') <> '1'::jsonb then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_form_schema -> 'content') <> 'array' then return '[]'::jsonb; end if;
  for n in select * from jsonb_array_elements(p_form_schema -> 'content') loop
    if not public.form_node_valid(n) then return '[]'::jsonb; end if;
  end loop;
  return p_form_schema -> 'content';
end;
$$;
revoke execute on function public.form_schema_content(jsonb) from public, anon, authenticated;

-- dataKey(field) — clé machine, repli sur l'id quand le builder Socle l'a
-- laissée vide (constaté en production sur les démarches ACCM).
create or replace function public.form_data_key(p_field jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when btrim(coalesce(p_field ->> 'key', '')) <> '' then btrim(p_field ->> 'key')
    else p_field ->> 'id'
  end;
$$;
revoke execute on function public.form_data_key(jsonb) from public, anon, authenticated;

-- attachmentIsRequired — `required` statique OU `requiredIf` satisfaite.
-- ⚠️ `requiredIf` ABSENTE n'oblige à rien (contrairement à visibleIf, où
-- l'absence signifie « toujours visible »).
create or replace function public.form_attachment_required(p_field jsonb, p_values jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when (p_field -> 'required') = 'true'::jsonb then true
    when jsonb_typeof(p_field -> 'requiredIf') <> 'object' then false
    when jsonb_typeof(p_field -> 'requiredIf' -> 'rules') <> 'array'
      or jsonb_array_length(p_field -> 'requiredIf' -> 'rules') = 0 then false
    else public.form_condition_met(p_field -> 'requiredIf', p_values)
  end;
$$;
revoke execute on function public.form_attachment_required(jsonb, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- form_attachment_requirements — LA fonction utile : les champs « pièce »
-- VISIBLES d'une demande, avec leur exigence, dans l'ordre du formulaire.
--
-- Jumeau de `pieceFields()` (conformite.ts). ⚠️ `form_data` est indexé par clé
-- machine (`dataKey` = `key` non vide, repli sur `id`), les conditions par `id`
-- de champ : la table `byId` fait le pont — exactement comme `formAnswers`.
-- ----------------------------------------------------------------------------
create or replace function public.form_attachment_requirements(
  p_form_schema jsonb,
  p_form_data   jsonb
) returns table (field_key text, label text, required boolean)
language plpgsql immutable set search_path = '' as $$
declare
  v_content jsonb := public.form_schema_content(p_form_schema);
  v_data    jsonb := case when jsonb_typeof(p_form_data) = 'object'
                          then p_form_data else '{}'::jsonb end;
  v_by_id   jsonb := '{}'::jsonb;
  n         jsonb;
  f         jsonb;
  v_key     text;
  v_visible boolean;
  v_req     boolean;
begin
  -- Passe 1 : byId[field.id] = form_data[dataKey(field)], sections aplaties.
  for n in select * from jsonb_array_elements(v_content) loop
    if n -> 'kind' = '"section"'::jsonb then
      for f in select * from jsonb_array_elements(coalesce(
                 case when jsonb_typeof(n -> 'fields') = 'array' then n -> 'fields' end,
                 '[]'::jsonb)) loop
        v_key   := public.form_data_key(f);
        v_by_id := jsonb_set(v_by_id, array[f ->> 'id'], coalesce(v_data -> v_key, 'null'::jsonb));
      end loop;
    else
      v_key   := public.form_data_key(n);
      v_by_id := jsonb_set(v_by_id, array[n ->> 'id'], coalesce(v_data -> v_key, 'null'::jsonb));
    end if;
  end loop;

  -- Passe 2 : les champs « pièce » visibles, avec leur exigence.
  for n in select * from jsonb_array_elements(v_content) loop
    if n -> 'kind' = '"section"'::jsonb then
      v_visible := public.form_condition_met(n -> 'visibleIf', v_by_id);
      for f in select * from jsonb_array_elements(coalesce(
                 case when jsonb_typeof(n -> 'fields') = 'array' then n -> 'fields' end,
                 '[]'::jsonb)) loop
        if f ->> 'type' = 'attachment'
           and v_visible
           and public.form_condition_met(f -> 'visibleIf', v_by_id) then
          v_req := public.form_attachment_required(f, v_by_id);
          field_key := public.form_data_key(f);
          label     := f ->> 'label';
          required  := v_req;
          return next;
        end if;
      end loop;
    elsif n ->> 'type' = 'attachment'
          and public.form_condition_met(n -> 'visibleIf', v_by_id) then
      v_req := public.form_attachment_required(n, v_by_id);
      field_key := public.form_data_key(n);
      label     := n ->> 'label';
      required  := v_req;
      return next;
    end if;
  end loop;
end;
$$;
revoke execute on function public.form_attachment_requirements(jsonb, jsonb) from public, anon, authenticated;

-- ============================================================================
-- 3. Ce qui bloque la résolution positive
--
-- DEFINER : lit request_attachments hors RLS pour rendre un verdict complet
-- même si l'appelant ne voyait pas toutes les lignes. EXECUTE révoqué partout —
-- passer un request_id arbitraire divulguerait les libellés d'une autre
-- demande ; la seule bouche est le trigger ci-dessous.
--
-- Le schéma et les données sont PASSÉS EN ARGUMENT, pas relus : dans un trigger
-- BEFORE, `new` peut porter un form_data que la table n'a pas encore.
-- ============================================================================
create or replace function public.request_pieces_blocking(
  p_request_id  uuid,
  p_form_schema jsonb,
  p_form_data   jsonb
) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(r.label order by r.ord), '{}'::text[])
    from (
      select req.label,
             row_number() over () as ord,
             (select count(*) from public.request_attachments a
               where a.request_id = p_request_id
                 and a.email_id is null
                 and a.form_field_key = req.field_key) as total,
             (select count(*) from public.request_attachments a
               where a.request_id = p_request_id
                 and a.email_id is null
                 and a.form_field_key = req.field_key
                 and a.compliance = 'conforme') as conformes
        from public.form_attachment_requirements(p_form_schema, p_form_data) req
       where req.required
    ) r
   where r.total = 0 or r.conformes < r.total;
$$;
revoke execute on function public.request_pieces_blocking(uuid, jsonb, jsonb) from public, anon, authenticated;

comment on function public.request_pieces_blocking(uuid, jsonb, jsonb) is
  'Libellés des exigences de pièces OBLIGATOIRES non satisfaites (manquante, pas encore qualifiée, ou non conforme). Vide = « Résoudre positivement » est ouvert. Jumeau de blockingRequirements() (conformite.ts).';

-- ----------------------------------------------------------------------------
-- Garde t17 — « Résolue positivement » exige des pièces obligatoires conformes.
--
-- S'applique à TOUT LE MONDE, service_role compris : c'est une règle métier,
-- pas une garde d'UX (même parti pris que t16_requests_require_procedure).
-- Ne vise QUE en_instruction → resolue_positive : le désarchivage
-- (archivee → resolue_positive) restaure un état déjà jugé et ne doit pas
-- pouvoir se retrouver piégé.
-- ----------------------------------------------------------------------------
-- DEFINER (motif t16_requests_require_procedure) : sans cela, un client
-- authentifié ne pourrait pas appeler request_pieces_blocking, dont l'EXECUTE
-- est révoqué — le trigger échouerait sur un refus de permission.
create or replace function public.requests_require_pieces_conformes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_blocking text[];
begin
  if new.status = 'resolue_positive' and old.status = 'en_instruction' then
    v_blocking := public.request_pieces_blocking(
      new.id, new.procedure_snapshot -> 'form_schema', new.form_data);
    if array_length(v_blocking, 1) > 0 then
      raise exception 'Résolution positive : pièce(s) obligatoire(s) à qualifier comme conformes — %.',
        array_to_string(v_blocking, ', ');
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_require_pieces_conformes() from public, anon, authenticated;

drop trigger if exists t17_requests_require_pieces_conformes on public.requests;
create trigger t17_requests_require_pieces_conformes
  before update on public.requests
  for each row execute function public.requests_require_pieces_conformes();

-- ============================================================================
-- 4. qualify_request_attachment — l'UNIQUE porte d'écriture
--
-- Aucune policy UPDATE cliente n'est ajoutée sur request_attachments (elle n'en
-- a jamais eu) : la RPC reste la seule entrée, comme pour les tables
-- permission_* et pour request_emails. Elle écrit le verdict, journalise, et
-- place la demande en attente d'information si la pièce est non conforme.
--
-- ⚠️ PIÈGE DOCUMENTÉ (CLAUDE.md racine) : dans une fonction SECURITY DEFINER,
-- `current_user` devient le PROPRIÉTAIRE, donc `is_service_context()` y vaut
-- toujours vrai. L'UPDATE de statut ci-dessous traverse par conséquent
-- `requests_guard_write` en « contexte de service » : ses portes par DROIT sont
-- contournées. C'est assumé et c'est pourquoi le droit d'INSTRUCTION est
-- vérifié ICI, explicitement, avant toute écriture. La matrice des transitions
-- et les exigences de données, elles, restent appliquées (elles ne dépendent
-- pas du contexte) — y compris la garde t17 ci-dessus.
-- ============================================================================
create or replace function public.qualify_request_attachment(
  p_attachment_id uuid,
  p_compliance    text,
  p_motif         text default null,
  p_note          text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_att    public.request_attachments%rowtype;
  v_req    public.requests%rowtype;
  v_uid    uuid := auth.uid();
  v_motif  text := nullif(btrim(coalesce(p_motif, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_waited boolean := false;
begin
  if v_uid is null then
    raise exception 'Qualification : authentification requise.';
  end if;
  if p_compliance not in ('conforme', 'non_conforme') then
    raise exception 'Qualification : verdict attendu « conforme » ou « non_conforme ».';
  end if;

  select * into v_att from public.request_attachments a where a.id = p_attachment_id;
  if not found then
    raise exception 'Qualification : pièce introuvable.';
  end if;
  -- Une pièce jointe à un e-mail SORTANT est un envoi du service : elle n'a
  -- rien à faire dans l'examen des pièces de l'usager.
  if v_att.email_id is not null then
    raise exception 'Qualification : cette pièce est jointe à un échange sortant, pas déposée par l''usager.';
  end if;

  select * into v_req from public.requests r where r.id = v_att.request_id;
  if not found then
    raise exception 'Qualification : demande introuvable.';
  end if;
  if v_req.status in ('annulee', 'resolue_positive', 'resolue_negative', 'archivee') then
    raise exception 'Qualification : la demande est close (%), ses pièces ne se requalifient plus.', v_req.status;
  end if;

  if not (public.is_platform_admin() or public.user_has_request_right(
            v_uid, v_req.organization_id, v_req.socle_organization_id,
            v_req.socle_procedure_id, 'instruction')) then
    raise exception 'Qualifier une pièce exige le droit d''instruction sur cette démarche pour ce service.';
  end if;

  if p_compliance = 'non_conforme' then
    if v_motif is null then
      raise exception 'Qualification : un motif de non-conformité est obligatoire.';
    end if;
    if v_motif not in ('nom_inattendu', 'illisible', 'format_non_pris_en_charge',
                       'incomplete', 'non_a_jour') then
      raise exception 'Qualification : motif de non-conformité inconnu (%).', v_motif;
    end if;
  else
    v_motif := null;   -- une pièce conforme n'a pas de motif ; la précision, elle, reste.
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'Qualification : la précision ne peut pas dépasser 500 caractères.';
  end if;

  update public.request_attachments
     set compliance       = p_compliance,
         compliance_motif = v_motif,
         compliance_note  = v_note,
         compliance_by    = v_uid,
         compliance_at    = now()
   where id = p_attachment_id;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (v_req.organization_id, v_req.id, 'piece_qualifiee',
          jsonb_build_object(
            'attachment_id', v_att.id,
            'file_name',     v_att.file_name,
            'form_field_key', v_att.form_field_key,
            'compliance',    p_compliance,
            'motif',         v_motif),
          v_uid);

  -- Une pièce non conforme met la demande en attente d'information. Depuis
  -- « À traiter », la matrice des transitions l'interdit (a_traiter → en_attente
  -- n'existe pas) : le statut ne bouge pas, la prise en charge reste le geste
  -- attendu. On le DIT à l'appelant plutôt que de le deviner à l'écran.
  if p_compliance = 'non_conforme' and v_req.status = 'en_instruction' then
    update public.requests set status = 'en_attente' where id = v_req.id;
    v_waited := true;
  end if;

  return jsonb_build_object(
    'attachment_id', v_att.id,
    'request_id',    v_req.id,
    'compliance',    p_compliance,
    'motif',         v_motif,
    'status',        case when v_waited then 'en_attente' else v_req.status end,
    'status_changed', v_waited);
end;
$$;
revoke execute on function public.qualify_request_attachment(uuid, text, text, text)
  from public, anon;
grant execute on function public.qualify_request_attachment(uuid, text, text, text)
  to authenticated;

comment on function public.qualify_request_attachment(uuid, text, text, text) is
  'Unique porte d''écriture de la qualification d''une pièce. Exige le droit d''instruction (vérifié ICI : le contournement is_service_context() est inévitable dans un DEFINER). Journalise ''piece_qualifiee'' et place la demande en attente d''information si la pièce est non conforme et la demande en instruction.';
