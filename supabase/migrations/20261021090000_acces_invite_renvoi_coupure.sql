-- ============================================================================
-- Accès invité : renvoi du code perdu, coupure et nouveau code par un agent.
--
-- Projet Sceaux (AO 26AS02), lot L4a de l'espace usager (décision PO : L4
-- reçoit « ni renvoi du code perdu, ni coupure d'accès par un agent », point
-- M2 de la relecture du lot L2). Voir 20261019150000_acces_usager_invite.sql.
--
--   · LE CODE NE SE RENVOIE PAS, IL SE REMPLACE : Iris n'en garde que
--     l'empreinte. Un renvoi tire un code NEUF ; l'ancien cesse de valoir.
--   · LA VERSION D'ACCÈS (`access_version`) : chaque nouveau code et chaque
--     coupure l'incrémentent. Le portail la reçoit à l'ouverture d'une session
--     invitée et la porte dans son jeton court ; une lecture d'une version
--     dépassée est refusée — une coupure ferme donc AUSSI les sessions déjà
--     ouvertes, pas seulement les prochaines.
--   · RENVOI PAR L'USAGER (« code perdu ») : adresse + référence. Le nouveau
--     code part à CETTE adresse, et seulement si c'est celle déclarée au dépôt
--     (empreinte). 3 renvois par 24 h et par demande ; rien pour une demande
--     coupée par un agent ou expirée. Une réponse unique dans tous les cas : le
--     portail ne dit jamais si une référence existe.
--   · AGENT (droit d'instruction, vérifié par l'edge function
--     `request-guest-access`) : couper l'accès, ou envoyer un nouveau code à
--     l'adresse déclarée au dépôt (lue dans le snapshot, vérifiée contre
--     l'empreinte) — ce qui rouvre un accès coupé.
--   · L'ENVOI passe par une FILE (`request_access_mails`), drainée par
--     `notifications-mailer` : la réponse au portail ne dépend pas du relais
--     (sa durée trahirait l'existence d'une demande). Le clair (adresse, code)
--     attend dans la file et en est effacé au règlement ; l'échange enregistré
--     (onglet Échanges) ne garde que le masque.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. L'état de l'accès
-- ----------------------------------------------------------------------------

alter table public.request_access_codes
  add column access_version int not null default 1 check (access_version >= 1),
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.users(id) on delete set null,
  add column reissued_at timestamptz,
  add column resend_window_start timestamptz,
  add column resend_count int not null default 0 check (resend_count >= 0);

comment on column public.request_access_codes.access_version is
  'Incrémentée à chaque nouveau code et à chaque coupure : une session invitée ouverte sur une version dépassée ne lit plus rien.';
comment on column public.request_access_codes.revoked_at is
  'Accès coupé par un agent : aucun code ne vaut, aucun renvoi par l''usager. Un nouveau code envoyé par un agent le rouvre.';
comment on column public.request_access_codes.resend_count is
  'Renvois demandés par l''usager dans la fenêtre de 24 h ouverte à resend_window_start (3 au plus).';

-- ----------------------------------------------------------------------------
-- 2. La file des nouveaux codes
-- ----------------------------------------------------------------------------

create table public.request_access_mails (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references public.requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reason          text not null check (reason in ('renvoi_usager', 'agent')),
  requested_by    uuid references public.users(id) on delete set null,
  to_email        text check (to_email is null or btrim(to_email) <> ''),
  access_code     text check (access_code is null or access_code ~ '^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$'),
  email_id        uuid references public.request_emails(id) on delete set null,
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts        int not null default 0,
  attempted_at    timestamptz,
  next_attempt_at timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);
comment on table public.request_access_mails is
  'Nouveaux codes d''accès invité à envoyer (renvoi par l''usager, ou agent). Adresse et code EN CLAIR le temps de l''envoi, effacés au règlement. service_role uniquement — aucune policy.';
create index request_access_mails_due_idx on public.request_access_mails (status, next_attempt_at);
create index request_access_mails_request_idx on public.request_access_mails (request_id);
alter table public.request_access_mails enable row level security;
revoke all on public.request_access_mails from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Vérifier — un accès coupé ne s'ouvre plus (même signature qu'au lot L2)
-- ----------------------------------------------------------------------------

create or replace function public.check_request_access(
  p_organization_id uuid, p_source text, p_reference text, p_email_hash text, p_code_hash text)
returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_access public.request_access_codes%rowtype;
  v_closed timestamptz;
begin
  select a.* into v_access
    from public.request_access_codes a
    join public.requests r on r.id = a.request_id
   where r.organization_id = p_organization_id
     and r.source = p_source
     and r.reference = upper(btrim(p_reference))
   for update of a;
  if not found then return null; end if;

  if v_access.revoked_at is not null then
    return null;
  end if;

  if v_access.locked_until is not null and v_access.locked_until > now() then
    return null;
  end if;

  select r.closed_at into v_closed from public.requests r where r.id = v_access.request_id;
  if v_closed is not null and v_closed < now() - interval '90 days' then
    return null;
  end if;

  -- Une adresse fausse ne compte pas comme un essai (voir 20261019150000).
  if v_access.email_hash <> p_email_hash then
    return null;
  end if;

  if v_access.code_hash = p_code_hash then
    update public.request_access_codes
       set failed_attempts = 0, locked_until = null, last_used_at = now()
     where request_id = v_access.request_id;
    return v_access.request_id;
  end if;

  if v_access.failed_attempts + 1 >= 5 then
    update public.request_access_codes
       set failed_attempts = 0, locked_until = now() + interval '1 hour'
     where request_id = v_access.request_id;
  else
    update public.request_access_codes
       set failed_attempts = v_access.failed_attempts + 1
     where request_id = v_access.request_id;
  end if;
  return null;
end;
$fn$;
comment on function public.check_request_access(uuid, text, text, text, text) is
  'Vérifie courriel + référence + code d''accès (empreintes) et rend la demande, sinon NULL — sans distinguer inconnue, coupée, verrouillée, expirée ou fausse. 5 mauvais codes avec la bonne adresse = 1 h de verrou ; une adresse fausse ne compte pas. service_role uniquement.';

-- ----------------------------------------------------------------------------
-- 4. Remplacer le code — cœur commun du renvoi et de l'agent (interne)
-- ----------------------------------------------------------------------------

create or replace function public.rotate_request_access(
  p_request_id uuid, p_code_hash text, p_code text, p_to_email text, p_reason text, p_by uuid)
returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare
  v_org uuid;
begin
  update public.request_access_codes
     set code_hash = p_code_hash,
         access_version = access_version + 1,
         revoked_at = null,
         revoked_by = null,
         failed_attempts = 0,
         locked_until = null,
         reissued_at = now()
   where request_id = p_request_id
  returning organization_id into v_org;
  if v_org is null then return false; end if;

  -- Un code plus ancien ne doit jamais partir après le nouveau.
  -- (Un échange déjà ouvert par une tentative échouée est clos « non envoyé ».)
  perform public.settle_request_email(m.email_id, false, 'remplacé par un code plus récent')
     from public.request_access_mails m
    where m.request_id = p_request_id and m.status = 'pending' and m.email_id is not null;
  update public.request_access_mails
     set status = 'skipped', settled_at = now(), error = 'remplacé par un code plus récent',
         to_email = null, access_code = null, next_attempt_at = null
   where request_id = p_request_id and status = 'pending';
  -- L'accusé de réception encore en attente portera le code en vigueur.
  update public.request_receipts
     set access_code = p_code
   where request_id = p_request_id and status = 'pending' and access_code is not null;

  insert into public.request_access_mails (request_id, organization_id, reason, requested_by, to_email, access_code)
  values (p_request_id, v_org, p_reason, p_by, btrim(p_to_email), p_code);
  return true;
end;
$fn$;
comment on function public.rotate_request_access(uuid, text, text, text, text, uuid) is
  'Remplace le code d''accès invité (nouvelle empreinte, version +1, accès rouvert, verrou levé) et enfile son envoi. Interne : appelée par request_access_resend et par l''edge function request-guest-access. service_role uniquement.';
revoke execute on function public.rotate_request_access(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.rotate_request_access(uuid, text, text, text, text, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 5. « Code perdu » — l'usager, par le portail
-- ----------------------------------------------------------------------------

create or replace function public.request_access_resend(
  p_organization_id uuid, p_source text, p_reference text,
  p_email_hash text, p_email text, p_code_hash text, p_code text)
returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_access public.request_access_codes%rowtype;
  v_closed timestamptz;
  v_count  int;
begin
  select a.* into v_access
    from public.request_access_codes a
    join public.requests r on r.id = a.request_id
   where r.organization_id = p_organization_id
     and r.source = p_source
     and r.reference = upper(btrim(p_reference))
   for update of a;
  if not found then return; end if;
  if v_access.revoked_at is not null then return; end if;
  if v_access.email_hash <> p_email_hash then return; end if;

  select r.closed_at into v_closed from public.requests r where r.id = v_access.request_id;
  if v_closed is not null and v_closed < now() - interval '90 days' then return; end if;

  -- 3 renvois par 24 h : au-delà, la boîte de l'usager serait un moyen de nuisance.
  if v_access.resend_window_start is null or v_access.resend_window_start < now() - interval '24 hours' then
    v_count := 1;
    update public.request_access_codes
       set resend_window_start = now(), resend_count = 1
     where request_id = v_access.request_id;
  else
    v_count := v_access.resend_count + 1;
    if v_count > 3 then return; end if;
    update public.request_access_codes set resend_count = v_count where request_id = v_access.request_id;
  end if;

  perform public.rotate_request_access(v_access.request_id, p_code_hash, p_code, p_email, 'renvoi_usager', null);
end;
$fn$;
comment on function public.request_access_resend(uuid, text, text, text, text, text, text) is
  'Renvoi du code perdu : si la référence, la source et l''adresse déclarée concordent, que l''accès n''est ni coupé ni expiré et que la demande n''a pas déjà eu 3 renvois en 24 h, remplace le code et l''enfile vers cette adresse. Ne rend RIEN, quel que soit le cas. service_role uniquement.';
revoke execute on function public.request_access_resend(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.request_access_resend(uuid, text, text, text, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 6. Couper — l'agent (droit vérifié par l'edge function)
-- ----------------------------------------------------------------------------

create or replace function public.revoke_request_access(p_request_id uuid, p_by uuid)
returns boolean
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.request_access_codes
     set revoked_at = now(), revoked_by = p_by, access_version = access_version + 1,
         failed_attempts = 0, locked_until = null
   where request_id = p_request_id and revoked_at is null;
  if not found then return false; end if;
  perform public.settle_request_email(m.email_id, false, 'accès coupé')
     from public.request_access_mails m
    where m.request_id = p_request_id and m.status = 'pending' and m.email_id is not null;
  update public.request_access_mails
     set status = 'skipped', settled_at = now(), error = 'accès coupé',
         to_email = null, access_code = null, next_attempt_at = null
   where request_id = p_request_id and status = 'pending';
  return true;
end;
$fn$;
comment on function public.revoke_request_access(uuid, uuid) is
  'Coupe l''accès invité d''une demande : plus aucun code ne vaut, les sessions ouvertes ne lisent plus rien (version +1), les envois en attente sont abandonnés. service_role uniquement (edge function request-guest-access, droit d''instruction).';
revoke execute on function public.revoke_request_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_request_access(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Le facteur — même discipline que les accusés (20261009100000)
-- ----------------------------------------------------------------------------

create or replace function public.claim_request_access_mails(p_limit int default 25)
returns table (
  mail_id            uuid,
  request_id         uuid,
  organization_id    uuid,
  organization_name  text,
  socle_scope_org_id uuid,
  reference          text,
  subject            text,
  reason             text,
  requested_by       uuid,
  to_email           text,
  access_code        text,
  tracking_url       text,
  email_id           uuid,
  email_subject      text,
  email_body         text,
  attempts           int
)
language plpgsql security definer set search_path = '' as $fn$
begin
  return query
  with due as (
    select m.id as mid
      from public.request_access_mails m
     where (m.status = 'pending' and (m.next_attempt_at is null or m.next_attempt_at <= now()))
        or (m.status = 'sending' and m.attempted_at is not null and m.attempted_at < now() - interval '15 minutes')
     order by m.created_at
     limit greatest(1, least(coalesce(p_limit, 25), 200))
     for update skip locked
  ),
  claimed as (
    update public.request_access_mails m
       set status = 'sending', attempts = m.attempts + 1, attempted_at = now()
     where m.id in (select d.mid from due d)
    returning m.*
  )
  select c.id, c.request_id, c.organization_id, o.name, r.socle_scope_org_id,
         r.reference, r.subject, c.reason, c.requested_by, c.to_email, c.access_code,
         a.tracking_url, c.email_id, e.subject, e.body, c.attempts
    from claimed c
    join public.requests r on r.id = c.request_id
    join public.organizations o on o.id = c.organization_id
    left join public.request_access_codes a on a.request_id = c.request_id
    left join public.request_emails e on e.id = c.email_id;
end;
$fn$;
comment on function public.claim_request_access_mails(int) is
  'Réclame un lot de nouveaux codes à envoyer et le marque ''sending'' atomiquement (for update skip locked). service_role uniquement.';
revoke execute on function public.claim_request_access_mails(int) from public, anon, authenticated;
grant execute on function public.claim_request_access_mails(int) to service_role;

create or replace function public.start_request_access_mail_email(p_mail_id uuid, p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_mail public.request_access_mails%rowtype;
  v_id   uuid;
begin
  select * into v_mail from public.request_access_mails where id = p_mail_id;
  if not found then return null; end if;
  if v_mail.email_id is not null then return v_mail.email_id; end if;
  v_id := public.start_request_email(v_mail.request_id, v_mail.requested_by, v_mail.to_email, p_subject, p_body);
  update public.request_access_mails set email_id = v_id where id = p_mail_id;
  return v_id;
end;
$fn$;
comment on function public.start_request_access_mail_email(uuid, text, text) is
  'Ouvre (une seule fois) l''échange request_emails d''un nouveau code (texte MASQUÉ), rattaché à la file. service_role uniquement.';
revoke execute on function public.start_request_access_mail_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_request_access_mail_email(uuid, text, text) to service_role;

create or replace function public.settle_request_access_mail(p_mail_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_mail  public.request_access_mails%rowtype;
  v_error text := left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'inconnue'), 500);
begin
  select * into v_mail from public.request_access_mails where id = p_mail_id;
  if not found then return; end if;

  if p_ok then
    update public.request_access_mails
       set status = 'sent', settled_at = now(), next_attempt_at = null, error = null,
           to_email = null, access_code = null
     where id = p_mail_id;
    if v_mail.email_id is not null then perform public.settle_request_email(v_mail.email_id, true, null); end if;
    return;
  end if;

  if v_mail.attempts >= public.notification_email_max_attempts() then
    update public.request_access_mails
       set status = 'failed', settled_at = now(), next_attempt_at = null, error = v_error,
           to_email = null, access_code = null
     where id = p_mail_id;
    if v_mail.email_id is not null then perform public.settle_request_email(v_mail.email_id, false, v_error); end if;
  else
    update public.request_access_mails
       set status = 'pending', error = v_error,
           next_attempt_at = now() + (interval '1 minute' * power(2, v_mail.attempts))
     where id = p_mail_id;
  end if;
end;
$fn$;
comment on function public.settle_request_access_mail(uuid, boolean, text) is
  'Règle l''envoi d''un nouveau code : succès → sent ; échec → reprise temporisée, puis failed. Adresse et code en clair effacés au règlement. service_role uniquement.';
revoke execute on function public.settle_request_access_mail(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.settle_request_access_mail(uuid, boolean, text) to service_role;

create or replace function public.skip_request_access_mail(p_mail_id uuid, p_reason text)
returns void
language sql security definer set search_path = '' as $fn$
  update public.request_access_mails
     set status = 'skipped', settled_at = now(), next_attempt_at = null,
         error = left(coalesce(p_reason, ''), 500), to_email = null, access_code = null
   where id = p_mail_id;
$fn$;
comment on function public.skip_request_access_mail(uuid, text) is
  'Renonce à l''envoi d''un nouveau code (aucun relais d''envoi) et oublie le clair. service_role uniquement.';
revoke execute on function public.skip_request_access_mail(uuid, text) from public, anon, authenticated;
grant execute on function public.skip_request_access_mail(uuid, text) to service_role;
