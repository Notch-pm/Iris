-- ============================================================================
-- Règle métier impérative (PO, 2026-08-20) : Iris ne gère AUCUNE demande
-- libre — toute NOUVELLE demande est fondée sur une démarche Socle active du
-- tenant. Les demandes historiques sans démarche restent lisibles et
-- transitionnables ; il est impossible d'en créer de nouvelles.
--
-- Restructuration des snapshots : l'ancien `snapshot` (fourre-tout) éclate en
-- `procedure_snapshot` (démarche figée, construite CÔTÉ SERVEUR depuis Socle)
-- et `requester_snapshot` (identité retenue au dépôt, immuable). `form_data`
-- (réponses indexées par la clé machine `key` des champs Socle) existait déjà.
-- ============================================================================

-- 1. Colonnes de snapshot dédiées.
alter table public.requests add column if not exists procedure_snapshot jsonb;
alter table public.requests add column if not exists requester_snapshot jsonb;

comment on column public.requests.procedure_snapshot is
  'Démarche figée au dépôt (id, name, type, category_id, form_schema, requester_config). Construit CÔTÉ SERVEUR depuis Socle — jamais accepté d''un payload externe. degraded=true si Socle était injoignable (snapshot minimal du cache).';
comment on column public.requests.requester_snapshot is
  'Identité retenue au dépôt : { declared: {...} | null, socle_contact_id: uuid | null }. IMMUABLE — pièce du dossier. Jamais d''internal_notes.';
comment on column public.requests.form_data is
  'Réponses au formulaire de la démarche, indexées par la clé machine `key` des champs du form_schema Socle (jamais `id`).';

-- 2. Reprise des données historiques depuis l''ancien snapshot.
update public.requests
   set procedure_snapshot = coalesce(procedure_snapshot,
         case when snapshot ? 'procedure' then snapshot -> 'procedure' end),
       requester_snapshot = coalesce(requester_snapshot,
         case when snapshot ? 'requester_declared'
              then jsonb_build_object('declared', snapshot -> 'requester_declared',
                                      'socle_contact_id', to_jsonb(socle_contact_id))
         end)
 where snapshot is not null and snapshot <> '{}'::jsonb;

alter table public.requests drop column if exists snapshot;

alter table public.requests drop constraint if exists requests_procedure_snapshot_object;
alter table public.requests add constraint requests_procedure_snapshot_object
  check (procedure_snapshot is null or jsonb_typeof(procedure_snapshot) = 'object');
alter table public.requests drop constraint if exists requests_requester_snapshot_object;
alter table public.requests add constraint requests_requester_snapshot_object
  check (requester_snapshot is null or jsonb_typeof(requester_snapshot) = 'object');

-- 3. Rattachement d''une pièce à un champ « pièce justificative » du formulaire.
alter table public.request_attachments add column if not exists form_field_key text;
comment on column public.request_attachments.form_field_key is
  'Clé machine (`key`) du champ pièce justificative du form_schema Socle auquel la pièce répond. NULL = pièce hors formulaire.';

-- 4. Garde : toute NOUVELLE demande est fondée sur une démarche du tenant,
-- active dans le cache, avec un snapshot cohérent. S''applique à TOUT LE MONDE,
-- service_role compris (règle métier, pas garde d''UX). Les libellés démarche/
-- catégorie sont TOUJOURS réécrits depuis le cache (vérité serveur).
-- DEFINER : lit socle_procedure_cache hors RLS ; EXECUTE révoqué (règle CLAUDE.md).
create or replace function public.requests_require_procedure()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cache record;
begin
  if new.socle_procedure_id is null then
    raise exception 'Toute demande doit être fondée sur une démarche Socle (socle_procedure_id manquant).';
  end if;
  select name, category_name into v_cache
    from public.socle_procedure_cache
   where socle_id = new.socle_procedure_id
     and organization_id = new.organization_id
     and obsoleted_at is null;
  if not found then
    raise exception 'Démarche introuvable, obsolète ou hors du périmètre du tenant.';
  end if;
  if new.procedure_snapshot is null
     or jsonb_typeof(new.procedure_snapshot) <> 'object'
     or new.procedure_snapshot = '{}'::jsonb then
    raise exception 'Le snapshot de la démarche est obligatoire (construit côté serveur depuis Socle).';
  end if;
  if new.procedure_snapshot ->> 'id' is distinct from new.socle_procedure_id::text then
    raise exception 'Snapshot incohérent : il ne correspond pas à la démarche déclarée.';
  end if;
  new.socle_procedure_label := v_cache.name;
  new.socle_category_label  := v_cache.category_name;
  return new;
end;
$$;
revoke execute on function public.requests_require_procedure() from public, anon, authenticated;

drop trigger if exists t16_requests_require_procedure on public.requests;
create trigger t16_requests_require_procedure
  before insert on public.requests
  for each row execute function public.requests_require_procedure();

-- 5. L''identité retenue au dépôt est immuable (protect_immutable étendu).
create or replace function public.requests_protect_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reference         is distinct from old.reference
     or new.reference_year is distinct from old.reference_year
     or new.reference_seq  is distinct from old.reference_seq
     or new.organization_id   is distinct from old.organization_id
     or new.socle_root_org_id is distinct from old.socle_root_org_id
     or new.source          is distinct from old.source
     or new.external_ref    is distinct from old.external_ref
     or new.received_at     is distinct from old.received_at
     or new.created_at      is distinct from old.created_at
     or new.requester_snapshot is distinct from old.requester_snapshot then
    raise exception 'Colonne immuable : reference, organization_id, socle_root_org_id, source, external_ref, received_at, created_at et requester_snapshot ne changent jamais.';
  end if;

  if old.status = 'archivee' then
    if new.status = 'archivee' then
      raise exception 'Demande archivée : aucune modification possible (désarchiver d''abord).';
    end if;
    if new.subject       is distinct from old.subject
       or new.body       is distinct from old.body
       or new.form_data  is distinct from old.form_data
       or new.procedure_snapshot is distinct from old.procedure_snapshot
       or new.closure_motif is distinct from old.closure_motif
       or new.closure_text  is distinct from old.closure_text
       or new.assigned_to   is distinct from old.assigned_to
       or new.priority      is distinct from old.priority
       or new.anomalies     is distinct from old.anomalies
       or new.socle_organization_id is distinct from old.socle_organization_id
       or new.socle_procedure_id    is distinct from old.socle_procedure_id
       or new.socle_contact_id      is distinct from old.socle_contact_id then
      raise exception 'Désarchivage : seul le statut peut changer.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_protect_immutable() from public, anon, authenticated;
