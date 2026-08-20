-- ============================================================================
-- Fondations Iris — 3/4 : satellites de requests — journal immuable,
-- historique d'affectation, messages, pièces, liens, outbox d'intégration.
-- Réf : docs/architecture-proposee.md §1.2, §6 · docs/data-model.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- request_events — journal d'audit IMMUABLE.
-- Écrit uniquement par les triggers DEFINER de requests et par le service_role.
-- Aucune policy d'écriture cliente + garde SQL anti UPDATE/DELETE (l'immuabilité
-- est portée par la base, pas par une convention).
-- ----------------------------------------------------------------------------

create table if not exists public.request_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,   -- dénormalisé : évite un join dans la policy
  request_id      uuid not null references public.requests(id) on delete cascade,
  event_type      text not null,   -- texte libre par conception (motif courier_events de Clara) :
                                   -- 'created','status_changed','assigned',…  Ajouter un type = zéro migration.
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_by      uuid references public.users(id),  -- NULL = système / intégration (attribué à la SOURCE)
  created_at      timestamptz not null default now()
);
create index if not exists request_events_request_idx on public.request_events (request_id, created_at);
create index if not exists request_events_org_idx     on public.request_events (organization_id, created_at desc);

-- Garde d'immuabilité : personne — service_role compris — ne réécrit l'histoire.
create or replace function public.forbid_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% immuable : % interdit.', tg_table_name, tg_op;
end;
$$;
revoke execute on function public.forbid_change() from public, anon, authenticated;

drop trigger if exists t01_request_events_immutable on public.request_events;
create trigger t01_request_events_immutable
  before update or delete on public.request_events
  for each row execute function public.forbid_change();

-- ----------------------------------------------------------------------------
-- request_assignments — historique d'affectation, append-only, alimenté par
-- trigger quand requests.assigned_to change (assigned_to NULL = désaffectation).
-- ----------------------------------------------------------------------------

create table if not exists public.request_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id      uuid not null references public.requests(id) on delete cascade,
  assigned_to     uuid references public.users(id) on delete set null,
  assigned_by     uuid references public.users(id),  -- NULL = système
  created_at      timestamptz not null default now()
);
create index if not exists request_assignments_request_idx on public.request_assignments (request_id, created_at);

drop trigger if exists t01_request_assignments_immutable on public.request_assignments;
create trigger t01_request_assignments_immutable
  before update or delete on public.request_assignments
  for each row execute function public.forbid_change();

-- ----------------------------------------------------------------------------
-- request_messages — notes internes d'instruction.
-- ⚠️ Ne quittent JAMAIS Iris (miroir de la règle internal_notes du Socle) :
-- aucune sérialisation externe ne devra les exposer.
-- ----------------------------------------------------------------------------

create table if not exists public.request_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id      uuid not null references public.requests(id) on delete cascade,
  author_id       uuid references public.users(id),
  kind            text not null default 'note_interne' check (kind in ('note_interne')),
  body            text not null check (btrim(body) <> ''),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists request_messages_request_idx on public.request_messages (request_id, created_at);

drop trigger if exists t02_request_messages_updated_at on public.request_messages;
create trigger t02_request_messages_updated_at
  before update on public.request_messages
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- request_attachments — pièces d'une demande (bucket privé request-attachments,
-- migration 4/4). Iris COPIE les pièces à l'ingestion, il ne les référence pas.
-- ----------------------------------------------------------------------------

create table if not exists public.request_attachments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id      uuid not null references public.requests(id) on delete cascade,
  storage_path    text not null,   -- '{organization_id}/{request_id}/{uuid}-{slug}' — porteur du RLS storage
  file_name       text not null,
  mime_type       text,
  file_size       bigint check (file_size is null or file_size >= 0),
  checksum        text,            -- dédup de la copie asynchrone
  document_type_socle_id uuid,     -- type de PJ Socle : UUID nu, sans FK
  document_type_label    text,     -- libellé figé
  copy_status     text not null default 'copied' check (copy_status in ('copied','pending','error')),
  uploaded_by     uuid references public.users(id),  -- NULL = ingestion
  created_at      timestamptz not null default now()
);
create index if not exists request_attachments_request_idx on public.request_attachments (request_id);
create index if not exists request_attachments_org_idx     on public.request_attachments (organization_id);

-- ----------------------------------------------------------------------------
-- request_links — relations d'une demande : demande↔demande (doublon, scission,
-- liaison libre) et demande↔ressource externe (courrier Clara, ticket partenaire).
-- NB : la référence externe PRIMAIRE (idempotence) reste requests.external_ref ;
-- les liens portent les relations additionnelles.
-- ----------------------------------------------------------------------------

create table if not exists public.request_links (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  request_id        uuid not null references public.requests(id) on delete cascade,
  link_type         text not null check (link_type in ('doublon_de','issue_de_scission','liee_a','externe')),
  target_request_id uuid references public.requests(id) on delete cascade,
  external_type     text,   -- ex. 'clara_courier', 'arpege_demande'
  external_id       text,
  external_url      text,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),

  check ((link_type = 'externe') = (target_request_id is null)),
  check (link_type <> 'externe' or (external_type is not null and external_id is not null)),
  check (link_type = 'externe' or (external_type is null and external_id is null and external_url is null)),
  check (target_request_id is distinct from request_id)
);
create unique index if not exists request_links_internal_unique
  on public.request_links (request_id, link_type, target_request_id)
  where target_request_id is not null;
create unique index if not exists request_links_external_unique
  on public.request_links (request_id, external_type, external_id)
  where external_id is not null;

-- Cohérence de périmètre (INVOKER : la lecture passe par le RLS — une demande
-- cible d'un autre tenant est invisible, donc « introuvable » : l'isolation
-- fait partie de la vérification).
create or replace function public.request_links_check_scope()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_org uuid;
begin
  select r.organization_id into v_org from public.requests r where r.id = new.request_id;
  if v_org is null or v_org is distinct from new.organization_id then
    raise exception 'Lien : demande source introuvable ou hors tenant.';
  end if;
  if new.target_request_id is not null then
    select r.organization_id into v_org from public.requests r where r.id = new.target_request_id;
    if v_org is null or v_org is distinct from new.organization_id then
      raise exception 'Lien : demande cible introuvable ou hors tenant.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.request_links_check_scope() from public, anon, authenticated;

drop trigger if exists t01_request_links_check_scope on public.request_links;
create trigger t01_request_links_check_scope
  before insert on public.request_links
  for each row execute function public.request_links_check_scope();

-- Même vérification de périmètre pour les écritures clientes des satellites.
create or replace function public.satellite_check_request_org()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_org uuid;
begin
  select r.organization_id into v_org from public.requests r where r.id = new.request_id;
  if v_org is null or v_org is distinct from new.organization_id then
    raise exception '%: demande introuvable ou hors tenant.', tg_table_name;
  end if;
  return new;
end;
$$;
revoke execute on function public.satellite_check_request_org() from public, anon, authenticated;

drop trigger if exists t01_request_messages_check_org on public.request_messages;
create trigger t01_request_messages_check_org
  before insert on public.request_messages
  for each row execute function public.satellite_check_request_org();

drop trigger if exists t01_request_attachments_check_org on public.request_attachments;
create trigger t01_request_attachments_check_org
  before insert on public.request_attachments
  for each row execute function public.satellite_check_request_org();

-- ----------------------------------------------------------------------------
-- integration_deliveries — outbox du retour d'état (webhook signé vers Clara,
-- contrat §6). Les workers (phase 4) consomment en service_role ; ici, la table
-- et son RLS seulement — aucun déclenchement d'émission n'est encore branché.
-- ----------------------------------------------------------------------------

create table if not exists public.integration_deliveries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id      uuid not null references public.requests(id) on delete cascade,
  event_id        uuid not null unique default gen_random_uuid(),  -- idempotence côté consommateur
  event_type      text not null,          -- ex. 'request.status_changed'
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  target          text not null check (target in ('clara')),
  status          text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts        int  not null default 0,
  next_attempt_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);
create index if not exists integration_deliveries_pending_idx
  on public.integration_deliveries (next_attempt_at)
  where status = 'pending';
create index if not exists integration_deliveries_request_idx
  on public.integration_deliveries (request_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Triggers AFTER de requests → journal + historique (DEFINER : ces tables
-- n'ont aucune policy d'écriture cliente).
-- ----------------------------------------------------------------------------

create or replace function public.requests_log_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (new.organization_id, new.id, 'created',
          jsonb_build_object('reference', new.reference, 'source', new.source, 'status', new.status),
          auth.uid());
  if new.assigned_to is not null then
    insert into public.request_assignments (organization_id, request_id, assigned_to, assigned_by)
    values (new.organization_id, new.id, new.assigned_to, auth.uid());
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'assigned',
            jsonb_build_object('from', null, 'to', new.assigned_to), auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_log_insert() from public, anon, authenticated;

drop trigger if exists t30_requests_log_insert on public.requests;
create trigger t30_requests_log_insert
  after insert on public.requests
  for each row execute function public.requests_log_insert();

create or replace function public.requests_log_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status,
                               'motif', new.closure_motif, 'version', new.version),
            auth.uid());
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.request_assignments (organization_id, request_id, assigned_to, assigned_by)
    values (new.organization_id, new.id, new.assigned_to, auth.uid());
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'assigned',
            jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to), auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_log_update() from public, anon, authenticated;

drop trigger if exists t30_requests_log_update on public.requests;
create trigger t30_requests_log_update
  after update on public.requests
  for each row execute function public.requests_log_update();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.request_events enable row level security;
alter table public.request_assignments enable row level security;
alter table public.request_messages enable row level security;
alter table public.request_attachments enable row level security;
alter table public.request_links enable row level security;
alter table public.integration_deliveries enable row level security;

drop policy if exists request_events_select on public.request_events;
create policy request_events_select on public.request_events
  for select to authenticated using (public.is_org_member(organization_id));
-- Aucune policy d'écriture : triggers DEFINER + service_role uniquement.

drop policy if exists request_assignments_select on public.request_assignments;
create policy request_assignments_select on public.request_assignments
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists request_messages_select on public.request_messages;
create policy request_messages_select on public.request_messages
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists request_messages_insert on public.request_messages;
create policy request_messages_insert on public.request_messages
  for insert to authenticated
  with check (public.is_org_writer(organization_id) and author_id = auth.uid());
-- Durcissement volontaire vs Clara : une note n'est modifiable que par son
-- auteur ou un admin.
drop policy if exists request_messages_update on public.request_messages;
create policy request_messages_update on public.request_messages
  for update to authenticated
  using ((author_id = auth.uid() and public.is_org_writer(organization_id))
         or public.is_org_admin(organization_id))
  with check ((author_id = auth.uid() and public.is_org_writer(organization_id))
              or public.is_org_admin(organization_id));
drop policy if exists request_messages_delete on public.request_messages;
create policy request_messages_delete on public.request_messages
  for delete to authenticated
  using ((author_id = auth.uid() and public.is_org_writer(organization_id))
         or public.is_org_admin(organization_id));

drop policy if exists request_attachments_select on public.request_attachments;
create policy request_attachments_select on public.request_attachments
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists request_attachments_insert on public.request_attachments;
create policy request_attachments_insert on public.request_attachments
  for insert to authenticated
  with check (public.is_org_writer(organization_id) and uploaded_by = auth.uid());
drop policy if exists request_attachments_delete on public.request_attachments;
create policy request_attachments_delete on public.request_attachments
  for delete to authenticated using (public.is_org_admin(organization_id));
-- Pas d'UPDATE client (copy_status est géré par les workers service_role).

drop policy if exists request_links_select on public.request_links;
create policy request_links_select on public.request_links
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists request_links_insert on public.request_links;
create policy request_links_insert on public.request_links
  for insert to authenticated with check (public.is_org_writer(organization_id));
drop policy if exists request_links_delete on public.request_links;
create policy request_links_delete on public.request_links
  for delete to authenticated using (public.is_org_admin(organization_id));

drop policy if exists integration_deliveries_select on public.integration_deliveries;
create policy integration_deliveries_select on public.integration_deliveries
  for select to authenticated using (public.is_org_member(organization_id));
-- Aucune écriture cliente : outbox alimentée et consommée en service_role.
