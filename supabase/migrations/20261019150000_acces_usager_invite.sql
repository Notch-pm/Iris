-- ============================================================================
-- Accès invité de l'usager à SA demande — courriel + référence + code d'accès.
--
-- Projet Sceaux (AO 26AS02), lot L2 de l'espace usager : un usager qui dépose
-- SANS compte sur le portail Nora, et qui l'accepte, peut suivre sa demande en
-- ligne et en lire les échanges. Le portail l'authentifie par trois éléments :
-- son adresse de courriel, la référence (DEM-…) et un CODE D'ACCÈS tiré par
-- Iris au dépôt. (« Code de suivi » désigne déjà la référence dans les modèles
-- de document : d'où « code d'accès ».)
--
--   · Le code : 10 caractères base32 sans ambiguïté (≈ 50 bits), affiché une
--     fois par le portail et envoyé dans l'accusé de réception. Iris n'en garde
--     qu'une empreinte HMAC poivrée (secret IRIS_ACCESS_CODE_PEPPER), comme
--     l'adresse : une fuite de la base ne donne ni l'un ni l'autre.
--   · L'accusé : le code y figure, mais l'échange enregistré (onglet Échanges,
--     lisible des agents) n'en garde qu'un masque. Le clair attend dans la file
--     `request_receipts.access_code` — service_role seul — et en est effacé dès
--     que l'accusé est réglé (envoyé, abandonné ou sans objet).
--   · Les essais : 5 échecs verrouillent la demande une heure. Une réponse
--     unique pour « inconnue », « verrouillée », « expirée » et « faux code » :
--     le portail ne dit jamais si une référence existe.
--   · La durée : l'accès vaut tant que la demande est ouverte, puis 90 jours
--     après sa clôture.
--
-- Le scope `requests:citizen` ouvre ces routes (vue usager, jamais /timeline) ;
-- il est donné aux clés plateforme du portail (`portail-citoyen`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Le scope
-- ----------------------------------------------------------------------------

alter table public.integration_credentials
  drop constraint if exists integration_credentials_scopes_check;

alter table public.integration_credentials
  add constraint integration_credentials_scopes_check
  check (
    scopes <@ array['requests:write', 'requests:read', 'requests:read_tenant', 'requests:citizen']::text[]
    and array_length(scopes, 1) >= 1
  );

update public.integration_credentials c
set scopes = array_append(c.scopes, 'requests:citizen')
from public.integration_sources s
where s.id = c.integration_source_id
  and s.code = 'portail-citoyen'
  and c.revoked_at is null
  and not ('requests:citizen' = any(c.scopes));

-- ----------------------------------------------------------------------------
-- 2. Les accès
-- ----------------------------------------------------------------------------

create table public.request_access_codes (
  request_id      uuid primary key references public.requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code_hash       text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  email_hash      text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  tracking_url    text check (tracking_url is null
                              or (tracking_url ~ '^https://' and length(tracking_url) <= 500)),
  failed_attempts int not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);
comment on table public.request_access_codes is
  'Accès invité de l''usager à SA demande (courriel + référence + code d''accès). Empreintes HMAC poivrées seulement. service_role uniquement — aucune policy.';
comment on column public.request_access_codes.tracking_url is
  'Page de suivi du portail qui a déposé (https://<collectivité>/suivi), citée dans l''accusé.';

alter table public.request_access_codes enable row level security;
revoke all on public.request_access_codes from anon, authenticated;

-- Le clair, le temps d'envoyer l'accusé.
alter table public.request_receipts
  add column access_code text
    check (access_code is null or access_code ~ '^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$');
comment on column public.request_receipts.access_code is
  'Code d''accès EN CLAIR, à inclure dans l''accusé — effacé dès que l''accusé est réglé. service_role uniquement.';

-- ----------------------------------------------------------------------------
-- 3. Ouvrir l'accès — au dépôt, une seule fois
-- ----------------------------------------------------------------------------

create or replace function public.register_request_access(
  p_request_id uuid, p_code_hash text, p_email_hash text, p_tracking_url text, p_code text)
returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare
  v_org uuid;
begin
  select r.organization_id into v_org from public.requests r where r.id = p_request_id;
  if v_org is null then return false; end if;

  insert into public.request_access_codes (request_id, organization_id, code_hash, email_hash, tracking_url)
  values (p_request_id, v_org, p_code_hash, p_email_hash, p_tracking_url)
  on conflict (request_id) do nothing;
  if not found then return false; end if;

  -- L'accusé est enfilé ICI, dans la même transaction que le code : le mailer
  -- (for update skip locked) ne peut pas le réclamer entre les deux et partir
  -- sans le code. `requests-api` appelle donc cette fonction AU LIEU de
  -- `enqueue_request_receipt` quand le suivi en ligne est accepté.
  perform public.enqueue_request_receipt(p_request_id);
  update public.request_receipts
     set access_code = p_code
   where request_id = p_request_id and status in ('pending', 'sending');
  return true;
end;
$fn$;
comment on function public.register_request_access(uuid, text, text, text, text) is
  'Ouvre l''accès invité d''une demande (une seule fois), enfile l''accusé de réception et lui confie le code en clair, dans la même transaction. service_role uniquement.';
revoke execute on function public.register_request_access(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_request_access(uuid, text, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Vérifier — compte les échecs, verrouille, ne dit jamais pourquoi
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

  if v_access.locked_until is not null and v_access.locked_until > now() then
    return null;
  end if;

  select r.closed_at into v_closed from public.requests r where r.id = v_access.request_id;
  if v_closed is not null and v_closed < now() - interval '90 days' then
    return null;
  end if;

  if v_access.code_hash = p_code_hash and v_access.email_hash = p_email_hash then
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
  'Vérifie courriel + référence + code d''accès (empreintes) et rend la demande, sinon NULL — sans distinguer inconnue, verrouillée, expirée ou fausse. 5 échecs = 1 h de verrou. service_role uniquement.';
revoke execute on function public.check_request_access(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.check_request_access(uuid, text, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 5. La file des accusés porte le code — et l'oublie une fois réglée
--
-- `claim_request_receipts` change de forme (deux colonnes) : drop + create.
-- ----------------------------------------------------------------------------

drop function if exists public.claim_request_receipts(int);

create function public.claim_request_receipts(p_limit int default 25)
returns table (
  receipt_request_id  uuid,
  receipt_org_id      uuid,
  organization_name   text,
  socle_root_org_id   uuid,
  socle_scope_org_id  uuid,
  socle_contact_id    uuid,
  requester_snapshot  jsonb,
  identity_status     text,
  reference           text,
  subject             text,
  organisme           text,
  received_at         timestamptz,
  email_id            uuid,
  email_to            text,
  email_subject       text,
  email_body          text,
  attempts            int,
  access_code         text,
  tracking_url        text
)
language plpgsql security definer set search_path = '' as $fn$
begin
  return query
  with due as (
    select q.request_id as rid
      from public.request_receipts q
     where (q.status = 'pending'
            and (q.next_attempt_at is null or q.next_attempt_at <= now()))
        or (q.status = 'sending'
            and q.attempted_at is not null
            and q.attempted_at < now() - interval '15 minutes')
     order by q.created_at
     limit greatest(1, least(coalesce(p_limit, 25), 200))
     for update skip locked
  ),
  claimed as (
    update public.request_receipts q
       set status = 'sending',
           attempts = q.attempts + 1,
           attempted_at = now()
     where q.request_id in (select d.rid from due d)
    returning q.request_id as rid, q.email_id as eid, q.attempts as n, q.access_code as code
  )
  select r.id, r.organization_id, o.name, o.socle_org_id, r.socle_scope_org_id,
         r.socle_contact_id, r.requester_snapshot, r.identity_status, r.reference,
         r.subject, r.socle_organization_label, r.received_at,
         c.eid, e.to_email, e.subject, e.body, c.n,
         c.code, a.tracking_url
    from claimed c
    join public.requests r on r.id = c.rid
    join public.organizations o on o.id = r.organization_id
    left join public.request_emails e on e.id = c.eid
    left join public.request_access_codes a on a.request_id = c.rid;
end;
$fn$;
comment on function public.claim_request_receipts(int) is
  'Réclame un lot d''accusés de réception et le marque ''sending'' atomiquement (for update skip locked). Récupère les lignes figées depuis 15 min. Rend le code d''accès en clair s''il y en a un. service_role uniquement.';
revoke execute on function public.claim_request_receipts(int) from public, anon, authenticated;
grant execute on function public.claim_request_receipts(int) to service_role;

create or replace function public.settle_request_receipt(
  p_request_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_attempts int;
  v_email    uuid;
  v_error    text := left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'inconnue'), 500);
begin
  select q.attempts, q.email_id into v_attempts, v_email
    from public.request_receipts q where q.request_id = p_request_id;
  if v_attempts is null then return; end if;

  if p_ok then
    update public.request_receipts
       set status = 'sent', settled_at = now(), next_attempt_at = null, error = null,
           access_code = null
     where request_id = p_request_id;
    if v_email is not null then
      perform public.settle_request_email(v_email, true, null);
    end if;
    return;
  end if;

  if v_attempts >= public.notification_email_max_attempts() then
    update public.request_receipts
       set status = 'failed', settled_at = now(), next_attempt_at = null, error = v_error,
           access_code = null
     where request_id = p_request_id;
    if v_email is not null then
      perform public.settle_request_email(v_email, false, v_error);
    end if;
  else
    update public.request_receipts
       set status = 'pending', error = v_error,
           next_attempt_at = now() + (interval '1 minute' * power(2, v_attempts))
     where request_id = p_request_id;
  end if;
end;
$fn$;
comment on function public.settle_request_receipt(uuid, boolean, text) is
  'Règle un accusé : succès → sent + échange envoye ; échec → reprise avec temporisation (2, 4, 8, 16 min), puis failed + échange echec au-delà de 5 tentatives. Le code d''accès en clair est effacé dès que l''accusé est réglé. service_role uniquement.';
revoke execute on function public.settle_request_receipt(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.settle_request_receipt(uuid, boolean, text) to service_role;

create or replace function public.skip_request_receipt(p_request_id uuid, p_reason text)
returns void
language sql security definer set search_path = '' as $fn$
  update public.request_receipts
     set status = 'skipped', settled_at = now(), next_attempt_at = null,
         error = left(coalesce(p_reason, ''), 500),
         access_code = null
   where request_id = p_request_id;
$fn$;
comment on function public.skip_request_receipt(uuid, text) is
  'Renonce à l''accusé (aucune adresse de courriel, dépôt anonyme, aucun relais d''envoi) et oublie le code d''accès en clair. Rien n''apparaît dans l''onglet Échanges : aucun message n''est parti. service_role uniquement.';
revoke execute on function public.skip_request_receipt(uuid, text) from public, anon, authenticated;
grant execute on function public.skip_request_receipt(uuid, text) to service_role;
