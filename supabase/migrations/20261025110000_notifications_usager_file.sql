-- ============================================================================
-- B12, lot L4c-1 — avis de statut à l'usager : la FILE.
-- Architecture : docs/notifications-usager-architecture.md (ADR-2 à ADR-9, ADR-13).
--
-- Un changement de statut ne décide RIEN : le trigger t41 enfile le fait (de,
-- vers, à) sur l'unique ligne `pending` de la demande, et le facteur
-- (`notifications-mailer/citizenNotices.ts`) décide À L'ENVOI, par une règle
-- pure et unique, en comparant le statut COURANT au statut CONNU de l'usager.
-- Chaque ligne finit `sent`, `skipped` (raison d'un catalogue fermé) ou
-- `failed` : c'est ce qui répond à « pourquoi n'ai-je rien reçu ? ».
--
-- TROIS VERROUS pour qu'aucune démonstration n'écrive à personne (ADR-9) :
--   1. l'interrupteur par collectivité, ÉTEINT par défaut (aucune ligne = éteint) ;
--   2. le drapeau transactionnel `iris.silence_usager` (set_config(..., true)
--      en tête de tout script de seed, de démonstration ou de nettoyage) ;
--   3. la décision relue à l'envoi : éteindre fait taire ce qui est en file.
--
-- Posé dès ce lot, rempli au lot L4c-2 (routes 2.10.0 poussées par Nora) :
-- `citizen_space_links`, `integration_sources.citizen_space_url`,
-- `request_access_codes.notify_email` — le choix du canal (ADR-4) en a besoin,
-- et une table vide vaut « aucun espace » : seul le canal invité sert d'ici là.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. L'interrupteur par collectivité (ADR-7)
-- ----------------------------------------------------------------------------

create table if not exists public.citizen_notification_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled         boolean not null default false,
  updated_by      uuid references public.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);
comment on table public.citizen_notification_settings is
  'Interrupteur des avis automatiques à l''usager (B12), par tenant. Aucune ligne = éteint. Écrit par la seule RPC save_citizen_notification_settings (administration de l''organisation principale).';

alter table public.citizen_notification_settings enable row level security;
drop policy if exists citizen_notification_settings_select on public.citizen_notification_settings;
create policy citizen_notification_settings_select on public.citizen_notification_settings
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists citizen_notification_settings_service on public.citizen_notification_settings;
create policy citizen_notification_settings_service on public.citizen_notification_settings
  for all to service_role using (true) with check (true);

create or replace function public.citizen_notices_enabled(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enabled from public.citizen_notification_settings s
                    where s.organization_id = p_org_id), false);
$$;
revoke execute on function public.citizen_notices_enabled(uuid) from public, anon, authenticated;
grant execute on function public.citizen_notices_enabled(uuid) to service_role;

create or replace function public.save_citizen_notification_settings(p_org_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_root uuid;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  select o.socle_org_id into v_root from public.organizations o where o.id = p_org_id;
  if v_root is null then
    raise exception 'Tenant introuvable.';
  end if;
  -- Écrire aux habitants est une décision sur toute la collectivité.
  if not public.has_admin_scope(p_org_id, v_root) then
    raise exception 'Les avis à l''usager se règlent par l''administration de l''organisation principale.';
  end if;
  if p_enabled is null then
    raise exception 'Avis à l''usager : état obligatoire.';
  end if;

  insert into public.citizen_notification_settings as s (organization_id, enabled, updated_by, updated_at)
  values (p_org_id, p_enabled, v_uid, now())
  on conflict (organization_id) do update
    set enabled = excluded.enabled, updated_by = v_uid, updated_at = now();

  return jsonb_build_object('enabled', p_enabled);
end;
$$;
revoke execute on function public.save_citizen_notification_settings(uuid, boolean) from public, anon;
grant execute on function public.save_citizen_notification_settings(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Ce que le canal doit savoir (ADR-2, ADR-3, ADR-4) — rempli au lot L4c-2
-- ----------------------------------------------------------------------------

create table if not exists public.citizen_space_links (
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  socle_contact_id      uuid not null,
  integration_source_id uuid references public.integration_sources(id) on delete set null,
  space_active          boolean not null default true,
  channel_prefs         jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(channel_prefs) = 'object'),
  account_email_hash    text check (account_email_hash is null or account_email_hash ~ '^[0-9a-f]{64}$'),
  pushed_at             timestamptz not null default now(),
  primary key (organization_id, socle_contact_id)
);
comment on table public.citizen_space_links is
  'Copie poussée par Nora (propriétaire) : la fiche Socle a un espace usager, ses préférences par canal, et l''EMPREINTE HMAC de l''adresse du compte. Aucun attribut d''identité, aucune adresse en clair (ADR-2). Aucune surface cliente.';
alter table public.citizen_space_links enable row level security;
drop policy if exists citizen_space_links_service on public.citizen_space_links;
create policy citizen_space_links_service on public.citizen_space_links
  for all to service_role using (true) with check (true);

alter table public.integration_sources
  add column if not exists citizen_space_url text
    check (citizen_space_url is null or (citizen_space_url ~ '^https://' and length(citizen_space_url) <= 500)),
  add column if not exists citizen_request_url_template text
    check (citizen_request_url_template is null
           or (citizen_request_url_template ~ '^https://'
               and length(citizen_request_url_template) <= 500
               and position('{request_id}' in citizen_request_url_template) > 0));
comment on column public.integration_sources.citizen_space_url is
  'Adresse de « Mes demandes » dans l''espace usager du portail (ADR-3), poussée par Nora. Lien des avis au canal compte.';
comment on column public.integration_sources.citizen_request_url_template is
  'Gabarit facultatif de la page d''une demande dans l''espace usager, contenant {request_id}, de même origine que citizen_space_url.';

alter table public.request_access_codes
  add column if not exists notify_email boolean not null default true,
  add column if not exists notify_changed_at timestamptz;
comment on column public.request_access_codes.notify_email is
  'Préférence de l''INVITÉ pour cette demande seule (lien de désinscription). Vrai par défaut : fail open.';

-- ----------------------------------------------------------------------------
-- 3. Le statut CONNU de l'usager (ADR-6)
-- ----------------------------------------------------------------------------

create table if not exists public.request_citizen_status (
  request_id   uuid primary key references public.requests(id) on delete cascade,
  known_status text not null,
  known_at     timestamptz not null default now()
);
comment on table public.request_citizen_status is
  'Dernier statut que l''usager CONNAÎT : initialisé au premier enfilement (statut d''avant), avancé quand un avis de statut part, quand l''usager répond (B11) et quand l''avis de clôture part. Aucune surface cliente.';
alter table public.request_citizen_status enable row level security;
drop policy if exists request_citizen_status_service on public.request_citizen_status;
create policy request_citizen_status_service on public.request_citizen_status
  for all to service_role using (true) with check (true);

create or replace function public.note_citizen_known_status(p_request_id uuid, p_status text)
returns void language sql security definer set search_path = '' as $$
  insert into public.request_citizen_status (request_id, known_status, known_at)
  select p_request_id, p_status, now()
   where p_status is not null and exists (select 1 from public.requests r where r.id = p_request_id)
  on conflict (request_id) do update set known_status = excluded.known_status, known_at = now();
$$;
comment on function public.note_citizen_known_status(uuid, text) is
  'L''usager connaît désormais ce statut (avis de statut ou de clôture parti, réponse de l''usager). service_role uniquement.';
revoke execute on function public.note_citizen_known_status(uuid, text) from public, anon, authenticated;
grant execute on function public.note_citizen_known_status(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. La file (ADR-5, ADR-6, ADR-13)
-- ----------------------------------------------------------------------------

create table if not exists public.citizen_notices (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  request_id        uuid not null references public.requests(id) on delete cascade,
  channel           text not null default 'email' check (channel in ('email')),
  events            jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  message_email_ids uuid[] not null default '{}',
  due_at            timestamptz not null,
  status            text not null default 'pending'
                    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  reason            text check (reason is null or reason in (
                      'interrupteur', 'evenement_non_retenu', 'couvert_par_avis_cloture',
                      'aucun_changement', 'preference', 'aucun_acces_en_ligne',
                      'adresse_compte_differente', 'masquee', 'clara', 'pas_d_adresse',
                      'pas_de_relais')),
  event_sent        text,
  target            text check (target is null or target in ('compte', 'invite')),
  attempts          int not null default 0,
  attempted_at      timestamptz,
  next_attempt_at   timestamptz,
  error             text,
  email_id          uuid references public.request_emails(id) on delete set null,
  created_at        timestamptz not null default now(),
  settled_at        timestamptz
);
comment on table public.citizen_notices is
  'File des avis automatiques à l''usager (B12). Une seule ligne pending par demande : les événements d''une rafale s''y ajoutent, due_at = premier événement + 10 min (fenêtre fixe). Aucune adresse n''y est stockée : le destinataire se calcule à l''envoi. Écrite par le trigger t41 et les RPC de service.';
comment on column public.citizen_notices.reason is
  'Raison d''un non-envoi (skipped), catalogue fermé partagé avec _shared/citizenNotices/.';

create unique index if not exists citizen_notices_one_pending
  on public.citizen_notices (request_id) where status = 'pending';
create index if not exists citizen_notices_queue_idx
  on public.citizen_notices (due_at) where status in ('pending', 'sending');
create index if not exists citizen_notices_request_idx
  on public.citizen_notices (request_id, created_at desc);

alter table public.citizen_notices enable row level security;
-- Lisible par qui consulte la demande (onglet Échanges, L4c-3) : rien n'y identifie l'usager.
drop policy if exists citizen_notices_select on public.citizen_notices;
create policy citizen_notices_select on public.citizen_notices
  for select to authenticated using (public.can_consult_request(request_id));
drop policy if exists citizen_notices_service on public.citizen_notices;
create policy citizen_notices_service on public.citizen_notices
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 5. Le trigger t41 — il enfile le FAIT, il ne décide rien
-- ----------------------------------------------------------------------------

create or replace function public.requests_citizen_notice()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  -- Une demande issue de Clara : Clara tient la relation avec son auteur.
  if new.source = 'clara' then
    return null;
  end if;
  -- Jeu de démonstration, script de seed ou de nettoyage (ADR-9).
  if coalesce(current_setting('iris.silence_usager', true), '') = 'on' then
    return null;
  end if;
  -- La réponse de l'usager a remis la demande en instruction (B11) : c'est son
  -- geste, il le connaît. Rien à enfiler, le statut connu suit.
  if coalesce(current_setting('iris.reprise_usager', true), '') = 'on' then
    perform public.note_citizen_known_status(new.id, new.status);
    return null;
  end if;
  if not public.citizen_notices_enabled(new.organization_id) then
    return null;
  end if;

  insert into public.request_citizen_status (request_id, known_status)
  values (new.id, old.status)
  on conflict (request_id) do nothing;

  insert into public.citizen_notices (organization_id, request_id, events, due_at)
  values (new.organization_id, new.id,
          jsonb_build_array(jsonb_build_object('de', old.status, 'vers', new.status, 'a', now())),
          now() + interval '10 minutes')
  on conflict (request_id) where status = 'pending' do update
    set events = public.citizen_notices.events || excluded.events;
  return null;
end;
$fn$;
comment on function public.requests_citizen_notice() is
  'Trigger t41 : enfile un changement de statut pour l''usager (B12). Se tait pour Clara, sous iris.silence_usager, sous iris.reprise_usager (statut connu avancé) et quand l''interrupteur du tenant est éteint.';
revoke execute on function public.requests_citizen_notice() from public, anon, authenticated;

drop trigger if exists t41_requests_citizen_notice on public.requests;
create trigger t41_requests_citizen_notice
  after update of status on public.requests
  for each row execute function public.requests_citizen_notice();

-- ----------------------------------------------------------------------------
-- 6. Le facteur : réclamer, reporter, ouvrir l'échange, régler, renoncer
-- ----------------------------------------------------------------------------

create or replace function public.claim_citizen_notices(p_limit int default 25)
returns table (
  notice_id              uuid,
  notice_org_id          uuid,
  organization_name      text,
  socle_root_org_id      uuid,
  request_id             uuid,
  reference              text,
  status                 text,
  source                 text,
  citizen_visible        boolean,
  closed_at              timestamptz,
  procedure_name         text,
  socle_procedure_id     uuid,
  socle_scope_org_id     uuid,
  socle_contact_id       uuid,
  requester_snapshot     jsonb,
  identity_status        text,
  known_status           text,
  events                 jsonb,
  message_email_ids      uuid[],
  receipt_status         text,
  enabled                boolean,
  guest_email_hash       text,
  guest_tracking_url     text,
  guest_revoked_at       timestamptz,
  guest_notify_email     boolean,
  link_space_active      boolean,
  link_channel_prefs     jsonb,
  link_account_email_hash text,
  link_space_url         text,
  link_request_url_template text,
  email_id               uuid,
  email_to               text,
  email_subject          text,
  email_body             text,
  attempts               int
)
language plpgsql security definer set search_path = '' as $fn$
begin
  return query
  with due as (
    select q.id as nid
      from public.citizen_notices q
     where (q.status = 'pending' and q.due_at <= now()
            and (q.next_attempt_at is null or q.next_attempt_at <= now()))
        or (q.status = 'sending'
            and q.attempted_at is not null
            and q.attempted_at < now() - interval '15 minutes')
     order by q.due_at
     limit greatest(1, least(coalesce(p_limit, 25), 200))
     for update skip locked
  ),
  claimed as (
    update public.citizen_notices q
       set status = 'sending', attempts = q.attempts + 1, attempted_at = now()
     where q.id in (select d.nid from due d)
    returning q.id as nid, q.request_id as rid, q.organization_id as oid, q.events as ev,
              q.message_email_ids as mids, q.email_id as eid, q.attempts as n
  )
  select c.nid, c.oid, o.name, o.socle_org_id, r.id, r.reference, r.status, r.source,
         r.citizen_visible, r.closed_at,
         nullif(btrim(coalesce(r.procedure_snapshot ->> 'name', '')), ''),
         r.socle_procedure_id::uuid, r.socle_scope_org_id, r.socle_contact_id,
         r.requester_snapshot, r.identity_status,
         ks.known_status, c.ev, c.mids, rr.status,
         public.citizen_notices_enabled(c.oid),
         a.email_hash, a.tracking_url, a.revoked_at, a.notify_email,
         l.space_active, l.channel_prefs, l.account_email_hash,
         s.citizen_space_url, s.citizen_request_url_template,
         c.eid, e.to_email, e.subject, e.body, c.n
    from claimed c
    join public.requests r on r.id = c.rid
    join public.organizations o on o.id = c.oid
    left join public.request_citizen_status ks on ks.request_id = r.id
    left join public.request_receipts rr on rr.request_id = r.id
    left join public.request_access_codes a on a.request_id = r.id
    left join public.citizen_space_links l
           on l.organization_id = r.organization_id and l.socle_contact_id = r.socle_contact_id
    left join public.integration_sources s on s.id = l.integration_source_id
    left join public.request_emails e on e.id = c.eid;
end;
$fn$;
comment on function public.claim_citizen_notices(int) is
  'Réclame les avis dus (due_at passé) et les marque ''sending'' atomiquement (for update skip locked) ; récupère les lignes figées depuis 15 min. Rend tout ce que la règle de décision lit. service_role uniquement.';
revoke execute on function public.claim_citizen_notices(int) from public, anon, authenticated;
grant execute on function public.claim_citizen_notices(int) to service_role;

-- L'accusé passe d'abord : report d'une minute, SANS consommer de tentative.
create or replace function public.defer_citizen_notice(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.citizen_notices
     set status = 'pending', attempts = greatest(attempts - 1, 0),
         next_attempt_at = now() + interval '1 minute'
   where id = p_id and status = 'sending';
$$;
revoke execute on function public.defer_citizen_notice(uuid) from public, anon, authenticated;
grant execute on function public.defer_citizen_notice(uuid) to service_role;

-- Ouvre (une fois) l'échange de l'avis : `nature = 'avis'`, sans agent.
create or replace function public.start_citizen_notice_email(
  p_id uuid, p_to_email text, p_subject text, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare
  v_request uuid;
  v_id      uuid;
begin
  select q.request_id, q.email_id into v_request, v_id from public.citizen_notices q where q.id = p_id;
  if v_request is null then
    raise exception 'Avis à l''usager introuvable.';
  end if;
  if v_id is not null then
    return v_id;
  end if;
  v_id := public.start_request_email(v_request, null, p_to_email, p_subject, p_body);
  update public.request_emails set nature = 'avis' where id = v_id;
  update public.citizen_notices set email_id = v_id where id = p_id;
  return v_id;
end;
$fn$;
revoke execute on function public.start_citizen_notice_email(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.start_citizen_notice_email(uuid, text, text, text) to service_role;

-- Succès : la ligne, l'échange ET le statut connu. Échec : temporisation, puis abandon.
create or replace function public.settle_citizen_notice(
  p_id uuid, p_ok boolean, p_error text default null,
  p_event text default null, p_target text default null, p_known_status text default null)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  v_attempts int;
  v_email    uuid;
  v_request  uuid;
  v_error    text := left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'inconnue'), 500);
begin
  select q.attempts, q.email_id, q.request_id into v_attempts, v_email, v_request
    from public.citizen_notices q where q.id = p_id;
  if v_attempts is null then return; end if;

  if p_ok then
    update public.citizen_notices
       set status = 'sent', settled_at = now(), next_attempt_at = null, error = null,
           event_sent = p_event, target = p_target
     where id = p_id;
    if v_email is not null then
      perform public.settle_request_email(v_email, true, null);
    end if;
    perform public.note_citizen_known_status(v_request, p_known_status);
    return;
  end if;

  if v_attempts >= public.notification_email_max_attempts() then
    update public.citizen_notices
       set status = 'failed', settled_at = now(), next_attempt_at = null, error = v_error,
           event_sent = p_event, target = p_target
     where id = p_id;
    if v_email is not null then
      perform public.settle_request_email(v_email, false, v_error);
    end if;
  else
    update public.citizen_notices
       set status = 'pending', error = v_error,
           next_attempt_at = now() + (interval '1 minute' * power(2, v_attempts))
     where id = p_id;
  end if;
end;
$fn$;
revoke execute on function public.settle_citizen_notice(uuid, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.settle_citizen_notice(uuid, boolean, text, text, text, text) to service_role;

-- Renoncer, avec la raison — écrite sur la ligne, lisible par l'agent.
create or replace function public.skip_citizen_notice(
  p_id uuid, p_reason text, p_event text default null, p_target text default null)
returns void language sql security definer set search_path = '' as $$
  update public.citizen_notices
     set status = 'skipped', settled_at = now(), next_attempt_at = null,
         reason = p_reason, event_sent = p_event, target = p_target
   where id = p_id;
$$;
revoke execute on function public.skip_citizen_notice(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.skip_citizen_notice(uuid, text, text, text) to service_role;
