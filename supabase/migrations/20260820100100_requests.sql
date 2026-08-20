-- ============================================================================
-- Fondations Iris — 2/4 : requests (cœur métier), numérotation, gardes.
-- Réf : docs/architecture-proposee.md §1.2, §1.4, §3 · docs/data-model.md.
-- Statuts FIXES (décision PO) : a_traiter, en_instruction, en_attente,
-- annulee, resolue_positive, resolue_negative, archivee.
-- ============================================================================

-- Compteurs annuels par tenant (motif courier_sequences de Clara).
create table if not exists public.request_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  year            int  not null,
  last_value      int  not null default 0,
  primary key (organization_id, year)
);

create table if not exists public.requests (
  id               uuid primary key default gen_random_uuid(),
  -- RESTRICT volontaire : une demande est une pièce administrative, elle ne
  -- disparaît jamais par effet de bord d'une suppression de tenant.
  organization_id  uuid not null references public.organizations(id) on delete restrict,

  -- Numéro lisible, posé par trigger (cité aux usagers : contrat de fait).
  reference        text not null,
  reference_year   int  not null,
  reference_seq    int  not null,

  -- Références Socle : UUID nus, SANS FK inter-base. Libellés figés à la création.
  socle_root_org_id        uuid not null,  -- racine Socle du tenant (synchronisée par trigger)
  socle_organization_id    uuid,           -- organisation destinataire éventuelle (sous-arbre)
  socle_organization_label text,
  socle_procedure_id       uuid,           -- démarche éventuelle (null = demande libre)
  socle_procedure_label    text,
  socle_category_label     text,           -- catégorie de démarche Socle (libellé figé)
  socle_contact_id         uuid,           -- contact éventuel

  -- Snapshot figé à la création : { procedure: {form_schema, requester_config},
  -- requester_declared: {...}, contact: {display_name, canal retenu} }.
  -- ⚠️ internal_notes n'y entre JAMAIS (règle d'or Socle).
  snapshot         jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  identity_status  text not null default 'non_rapprochee'
                     check (identity_status in ('rapprochee','non_rapprochee','anonyme')),

  -- Origine. `source` = registre fermé, une valeur par émetteur.
  source           text not null default 'iris'
                     check (source in ('iris','clara','portail','arpege')),
  external_ref     text,
  external_url     text,
  channel          text,
  received_at      timestamptz not null default now(),  -- date de réception D'ORIGINE, immuable

  -- Contenu.
  subject          text not null check (btrim(subject) <> ''),
  body             text,
  form_data        jsonb not null default '{}'::jsonb check (jsonb_typeof(form_data) = 'object'),

  -- Cycle de vie (workflow fixe — garde par trigger, jamais UI seulement).
  status           text not null default 'a_traiter'
                     check (status in ('a_traiter','en_instruction','en_attente',
                                       'annulee','resolue_positive','resolue_negative','archivee')),
  closure_motif    text check (closure_motif in
                     ('irrecevable','abandon','retrait_usager','doublon','reorientation')),
  closure_text     text,          -- destiné à l'USAGER (réutilisé par Clara en brouillon)
  master_request_id uuid references public.requests(id),
  priority         text not null default 'normale'
                     check (priority in ('basse','normale','haute','urgente')),
  assigned_to      uuid references public.users(id) on delete set null,
  anomalies        jsonb not null default '[]'::jsonb check (jsonb_typeof(anomalies) = 'array'),
  version          int not null default 1,  -- monotone : idempotence des webhooks sortants

  due_at           timestamptz,
  closed_at        timestamptz,
  retention_until  timestamptz,   -- RGPD dès la première migration (décision D9)
  purged_at        timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (organization_id, reference_year, reference_seq),
  -- Née dans Iris ⟺ pas de référence externe.
  check ((source = 'iris') = (external_ref is null)),
  -- Un doublon référence obligatoirement sa demande maître.
  check (closure_motif is distinct from 'doublon' or master_request_id is not null)
);
comment on table public.requests is
  'Demandes d''usagers — propriété exclusive d''Iris. Références Socle en UUID nus sans FK.';
comment on column public.requests.snapshot is
  'Pièce du dossier figée à la création (démarche, identité déclarée, contact minimal). Jamais rafraîchie, jamais d''internal_notes.';

-- Idempotence d'ingestion (contrat §5) : une même (source, référence externe)
-- ne crée jamais deux demandes dans un tenant.
create unique index if not exists requests_source_external_ref_unique
  on public.requests (organization_id, source, external_ref)
  where external_ref is not null;

create index if not exists requests_org_status_idx        on public.requests (organization_id, status);
create index if not exists requests_org_socle_org_idx     on public.requests (organization_id, socle_organization_id);
create index if not exists requests_org_procedure_idx     on public.requests (organization_id, socle_procedure_id);
create index if not exists requests_org_created_idx       on public.requests (organization_id, created_at desc);
create index if not exists requests_org_assigned_idx      on public.requests (organization_id, assigned_to);
create index if not exists requests_master_idx            on public.requests (master_request_id) where master_request_id is not null;

-- ----------------------------------------------------------------------------
-- Triggers BEFORE INSERT (ordre alphabétique des noms = ordre d'exécution).
-- ----------------------------------------------------------------------------

-- t10 — garde d'entrée (INVOKER : dépend du rôle de session).
-- Toute demande naît en a_traiter ; seul le contexte de service (reprise de
-- stock, ingestion) peut atterrir ailleurs — et le registre des sources est
-- réservé : un client authentifié ne crée que des demandes source 'iris'
-- (verrouillé aussi par la policy INSERT).
create or replace function public.requests_before_insert_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_service_context() then
    if new.status <> 'a_traiter' then
      raise exception 'Une demande naît toujours au statut a_traiter (reçu : %).', new.status;
    end if;
  end if;
  new.version := 1;
  return new;
end;
$$;
revoke execute on function public.requests_before_insert_guard() from public, anon, authenticated;

drop trigger if exists t10_requests_before_insert_guard on public.requests;
create trigger t10_requests_before_insert_guard
  before insert on public.requests
  for each row execute function public.requests_before_insert_guard();

-- t20 — numérotation + synchronisation de la racine Socle (DEFINER : écrit
-- request_sequences et lit organizations hors RLS). Upsert atomique : le
-- verrou de ligne ne sérialise que le même tenant la même année.
create or replace function public.requests_set_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_year int := extract(year from now())::int;
  v_seq  int;
  v_root uuid;
begin
  select o.socle_org_id into v_root from public.organizations o where o.id = new.organization_id;
  if v_root is null then
    raise exception 'Tenant inconnu : %.', new.organization_id;
  end if;
  new.socle_root_org_id := v_root;  -- toujours dérivée du tenant, jamais du payload

  insert into public.request_sequences (organization_id, year, last_value)
  values (new.organization_id, v_year, 1)
  on conflict (organization_id, year)
  do update set last_value = public.request_sequences.last_value + 1
  returning last_value into v_seq;

  new.reference_year := v_year;
  new.reference_seq  := v_seq;
  new.reference      := format('DEM-%s-%s', v_year, lpad(v_seq::text, 6, '0'));
  return new;
end;
$$;
revoke execute on function public.requests_set_reference() from public, anon, authenticated;

drop trigger if exists t20_requests_set_reference on public.requests;
create trigger t20_requests_set_reference
  before insert on public.requests
  for each row execute function public.requests_set_reference();

-- ----------------------------------------------------------------------------
-- Triggers BEFORE UPDATE.
-- ----------------------------------------------------------------------------

-- t10 — immuabilité des colonnes d'origine + gel des demandes archivées.
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
     or new.created_at      is distinct from old.created_at then
    raise exception 'Colonne immuable : reference, organization_id, socle_root_org_id, source, external_ref, received_at et created_at ne changent jamais.';
  end if;

  -- Une demande archivée est gelée : seul le désarchivage (changement de
  -- statut vers un statut terminal, garde t11) est autorisé.
  if old.status = 'archivee' then
    if new.status = 'archivee' then
      raise exception 'Demande archivée : aucune modification possible (désarchiver d''abord).';
    end if;
    if new.subject       is distinct from old.subject
       or new.body       is distinct from old.body
       or new.form_data  is distinct from old.form_data
       or new.snapshot   is distinct from old.snapshot
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

drop trigger if exists t10_requests_protect_immutable on public.requests;
create trigger t10_requests_protect_immutable
  before update on public.requests
  for each row execute function public.requests_protect_immutable();

-- t11 — garde des transitions de statut (matrice fixe, §3.2 de l'architecture).
-- INVOKER : les vérifications de rôle utilisent la session ; le contexte de
-- service (ingestion, péremption automatique, reprise) est contourné
-- EXPLICITEMENT — une garde sans contournement bloquerait ses propres
-- automatismes (leçon Clara, garde-transitions-workflow.md).
create or replace function public.requests_guard_transition()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_service boolean := public.is_service_context();
  v_role    text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Matrice fixe des transitions autorisées.
  if not (
       (old.status = 'a_traiter'      and new.status in ('en_instruction','resolue_negative','annulee'))
    or (old.status = 'en_instruction' and new.status in ('en_attente','resolue_positive','resolue_negative','annulee','a_traiter'))
    or (old.status = 'en_attente'     and new.status in ('en_instruction','annulee'))
    or (old.status in ('annulee','resolue_positive','resolue_negative')
                                      and new.status in ('en_instruction','archivee'))
    or (old.status = 'archivee'       and new.status in ('annulee','resolue_positive','resolue_negative'))
  ) then
    raise exception 'Transition de statut interdite : % → %.', old.status, new.status;
  end if;

  -- Exigences de données.
  if old.status = 'a_traiter' and new.status = 'en_instruction' and new.assigned_to is null then
    raise exception 'Passage en instruction : un agent assigné est obligatoire.';
  end if;
  if new.status in ('resolue_positive','resolue_negative') and old.status <> 'archivee'
     and (new.closure_text is null or btrim(new.closure_text) = '') then
    raise exception 'Résolution : le texte de clôture destiné à l''usager est obligatoire.';
  end if;
  if old.status = 'a_traiter' and new.status = 'resolue_negative'
     and coalesce(new.closure_motif, '') not in ('irrecevable','doublon','reorientation') then
    raise exception 'Clôture négative sans instruction : motif irrecevable, doublon ou reorientation obligatoire.';
  end if;
  if new.status = 'annulee'
     and coalesce(new.closure_motif, '') not in ('abandon','retrait_usager') then
    raise exception 'Annulation : motif abandon ou retrait_usager obligatoire.';
  end if;

  -- Portes par rôle (contournées en contexte de service, tracé par ailleurs).
  if not v_service then
    v_role := public.member_role(new.organization_id);
    if old.status in ('annulee','resolue_positive','resolue_negative') and new.status = 'en_instruction'
       and coalesce(v_role, '') not in ('superviseur','admin') and not public.is_platform_admin() then
      raise exception 'Réouverture réservée au superviseur ou à l''admin.';
    end if;
    if (new.status = 'archivee' or old.status = 'archivee')
       and coalesce(v_role, '') <> 'admin' and not public.is_platform_admin() then
      raise exception 'Archivage et désarchivage réservés à l''admin.';
    end if;
  end if;

  -- Effets.
  if new.status in ('annulee','resolue_positive','resolue_negative')
     and old.status in ('a_traiter','en_instruction','en_attente') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  if old.status in ('annulee','resolue_positive','resolue_negative') and new.status = 'en_instruction' then
    -- Réouverture : la clôture précédente reste dans le journal (request_events).
    new.closed_at := null;
    new.closure_motif := null;
    new.closure_text := null;
    new.master_request_id := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_guard_transition() from public, anon, authenticated;

drop trigger if exists t11_requests_guard_transition on public.requests;
create trigger t11_requests_guard_transition
  before update on public.requests
  for each row execute function public.requests_guard_transition();

-- t19 — version monotone + updated_at (toujours en dernier).
create or replace function public.requests_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.requests_touch() from public, anon, authenticated;

drop trigger if exists t19_requests_touch on public.requests;
create trigger t19_requests_touch
  before update on public.requests
  for each row execute function public.requests_touch();

-- Les triggers AFTER (journal request_events, historique request_assignments)
-- sont créés dans la migration 3/4, après les tables satellites.

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.request_sequences enable row level security;
alter table public.requests enable row level security;

drop policy if exists request_sequences_select on public.request_sequences;
create policy request_sequences_select on public.request_sequences
  for select to authenticated using (public.is_org_member(organization_id));
-- Aucune écriture cliente : le trigger DEFINER est le seul écrivain.

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests
  for select to authenticated using (public.is_org_member(organization_id));

-- Création manuelle par un agent : uniquement dans son tenant, uniquement
-- source 'iris'. Les autres sources (clara, portail, arpege) n'entrent que par
-- l'API d'ingestion (service_role) — contrat §5.
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests
  for insert to authenticated
  with check (public.is_org_writer(organization_id) and source = 'iris');

drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests
  for update to authenticated
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Pas de policy DELETE : une demande ne se supprime jamais côté client.
-- La purge RGPD passera par une procédure service_role dédiée.
