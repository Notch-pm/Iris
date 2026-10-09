-- ============================================================================
-- Accusé de réception à l'usager, au dépôt (décision PO 2026-10-09).
--
-- Toute demande DÉPOSÉE — au guichet d'Iris (`create-request-from-procedure`)
-- ou par l'API d'ingestion (`requests-api` : portail Nora, partenaires) —
-- vaut à l'usager un courriel « Nous avons bien reçu votre demande ». SAUF les
-- demandes issues de Clara : elles naissent d'un courrier traité par un agent,
-- pas d'un dépôt de l'usager. Aucune désactivation (décision PO).
--
-- POURQUOI UNE FILE, ET PAS UN ENVOI DANS LE DÉPÔT : un relais SMTP qui tousse
-- ne doit jamais faire échouer un dépôt, ni le faire traîner. Motif
-- `notifications` : une boîte d'envoi (`request_receipts`) que draine
-- `notifications-mailer` sur le cron existant — réclamation atomique,
-- temporisation croissante, abandon franc au bout de 5 tentatives.
--
-- POURQUOI LES EDGE FUNCTIONS ENFILENT, ET PAS UN TRIGGER : l'accusé répond à
-- un DÉPÔT, et seuls les deux points d'entrée savent qu'il y en a eu un. Un
-- trigger sur `requests` écrirait aussi aux usagers des jeux de démonstration
-- et des scripts de test, qui insèrent en base. L'exclusion de Clara, elle, vit
-- ICI (`enqueue_request_receipt`) : une seule règle, que les appelants ne
-- peuvent pas oublier.
--
-- LA TRACE : l'accusé est un échange comme les autres (`request_emails`), lisible
-- dans l'onglet Échanges. Sans agent derrière : `sent_by` devient NULLABLE,
-- NULL = envoi automatique d'Iris.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. request_emails : un envoi peut n'avoir aucun agent derrière
-- ----------------------------------------------------------------------------

alter table public.request_emails alter column sent_by drop not null;

comment on column public.request_emails.sent_by is
  'Agent qui a envoyé l''échange. NULL = envoi AUTOMATIQUE d''Iris (accusé de réception au dépôt, request_receipts).';

-- ----------------------------------------------------------------------------
-- 2. request_receipts — la boîte d'envoi des accusés de réception
-- ----------------------------------------------------------------------------

create table if not exists public.request_receipts (
  request_id      uuid primary key references public.requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts        int not null default 0,
  attempted_at    timestamptz,
  next_attempt_at timestamptz,
  error           text,
  email_id        uuid references public.request_emails(id) on delete set null,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);

comment on table public.request_receipts is
  'Boîte d''envoi des accusés de réception à l''usager : UNE ligne par demande déposée (clé = request_id, donc jamais deux accusés). Écrite par enqueue_request_receipt (edge functions de dépôt), drainée par notifications-mailer. Aucune surface cliente : la trace lisible est la ligne request_emails (email_id).';
comment on column public.request_receipts.status is
  'pending (à envoyer) · sending (réclamée) · sent · skipped (aucune adresse, aucun relais) · failed (abandon après 5 tentatives).';

create index if not exists request_receipts_queue_idx
  on public.request_receipts (next_attempt_at nulls first, created_at)
  where status in ('pending', 'sending');

alter table public.request_receipts enable row level security;

-- AUCUNE policy cliente : ni lecture, ni écriture. L'agent lit l'échange.
drop policy if exists request_receipts_service on public.request_receipts;
create policy request_receipts_service on public.request_receipts
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 3. Enfiler — la règle « pas Clara » vit ici
-- ----------------------------------------------------------------------------

create or replace function public.enqueue_request_receipt(p_request_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare
  v_org    uuid;
  v_source text;
begin
  select r.organization_id, r.source into v_org, v_source
    from public.requests r where r.id = p_request_id;
  if v_org is null then
    raise exception 'Accusé de réception : demande introuvable.';
  end if;

  -- Une demande issue de Clara naît d'un courrier, pas d'un dépôt de l'usager.
  if v_source = 'clara' then
    return false;
  end if;

  insert into public.request_receipts (request_id, organization_id)
  values (p_request_id, v_org)
  on conflict (request_id) do nothing;
  return found;
end;
$fn$;
comment on function public.enqueue_request_receipt(uuid) is
  'Enfile l''accusé de réception d''une demande déposée. Idempotent (un rejeu n''enfile rien). Rend false pour une demande issue de Clara (décision PO 2026-10-09) ou déjà enfilée. service_role uniquement.';
revoke execute on function public.enqueue_request_receipt(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_request_receipt(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Réclamer un lot (motif claim_notification_emails)
--
-- Rend tout ce qu'il faut pour résoudre le destinataire et composer le message,
-- et — sur une reprise — l'échange déjà ouvert : on renvoie ALORS le texte
-- enregistré, pas un texte recomposé, pour que la trace dise ce qui est parti.
-- ----------------------------------------------------------------------------

create or replace function public.claim_request_receipts(p_limit int default 25)
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
  attempts            int
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
    returning q.request_id as rid, q.email_id as eid, q.attempts as n
  )
  select r.id, r.organization_id, o.name, o.socle_org_id, r.socle_scope_org_id,
         r.socle_contact_id, r.requester_snapshot, r.identity_status, r.reference,
         r.subject, r.socle_organization_label, r.received_at,
         c.eid, e.to_email, e.subject, e.body, c.n
    from claimed c
    join public.requests r on r.id = c.rid
    join public.organizations o on o.id = r.organization_id
    left join public.request_emails e on e.id = c.eid;
end;
$fn$;
comment on function public.claim_request_receipts(int) is
  'Réclame un lot d''accusés de réception et le marque ''sending'' atomiquement (for update skip locked). Récupère les lignes figées depuis 15 min. service_role uniquement.';
revoke execute on function public.claim_request_receipts(int) from public, anon, authenticated;
grant execute on function public.claim_request_receipts(int) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Ouvrir l'échange — une fois, rattaché à la file dans la même transaction
--
-- Sans cette atomicité, une fonction morte entre l'insertion de l'échange et le
-- rattachement laisserait la reprise en ouvrir un second.
-- ----------------------------------------------------------------------------

create or replace function public.start_request_receipt_email(
  p_request_id uuid, p_to_email text, p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_id uuid;
begin
  select q.email_id into v_id from public.request_receipts q where q.request_id = p_request_id;
  if v_id is not null then
    return v_id;
  end if;
  v_id := public.start_request_email(p_request_id, null, p_to_email, p_subject, p_body);
  update public.request_receipts set email_id = v_id where request_id = p_request_id;
  return v_id;
end;
$fn$;
comment on function public.start_request_receipt_email(uuid, text, text, text) is
  'Ouvre (une seule fois) l''échange request_emails de l''accusé de réception, sans agent (sent_by NULL), et le rattache à la file. service_role uniquement.';
revoke execute on function public.start_request_receipt_email(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.start_request_receipt_email(uuid, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 6. Régler — la file ET l'échange
--
-- Pendant les reprises, l'échange reste « en_cours » : l'onglet n'affiche
-- « Non envoyé » que lorsqu'on a renoncé.
-- ----------------------------------------------------------------------------

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
       set status = 'sent', settled_at = now(), next_attempt_at = null, error = null
     where request_id = p_request_id;
    if v_email is not null then
      perform public.settle_request_email(v_email, true, null);
    end if;
    return;
  end if;

  if v_attempts >= public.notification_email_max_attempts() then
    update public.request_receipts
       set status = 'failed', settled_at = now(), next_attempt_at = null, error = v_error
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
  'Règle un accusé : succès → sent + échange envoye ; échec → reprise avec temporisation (2, 4, 8, 16 min), puis failed + échange echec au-delà de 5 tentatives. service_role uniquement.';
revoke execute on function public.settle_request_receipt(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.settle_request_receipt(uuid, boolean, text) to service_role;

create or replace function public.skip_request_receipt(p_request_id uuid, p_reason text)
returns void
language sql security definer set search_path = '' as $fn$
  update public.request_receipts
     set status = 'skipped', settled_at = now(), next_attempt_at = null,
         error = left(coalesce(p_reason, ''), 500)
   where request_id = p_request_id;
$fn$;
comment on function public.skip_request_receipt(uuid, text) is
  'Renonce à l''accusé (aucune adresse de courriel, dépôt anonyme, aucun relais d''envoi). Rien n''apparaît dans l''onglet Échanges : aucun message n''est parti. service_role uniquement.';
revoke execute on function public.skip_request_receipt(uuid, text) from public, anon, authenticated;
grant execute on function public.skip_request_receipt(uuid, text) to service_role;
