-- Courrier de réponse validé dans Clara : Iris en garde la TRACE (décision PO
-- du 2026-11-13, qui lève « Iris n'en garde pas de copie » du 2026-11-12).
--
-- Quand Clara signale l'envoi (`POST /v1/requests/{id}/reply-letter/events`,
-- contrat 2.13.0), elle transmet la version ENVOYÉE : canal réel, objet, texte
-- final et, pour un envoi papier, le PDF. Iris en fait :
--   · un échange de l'onglet Échanges (`request_emails`), remise `courriel` ou
--     `courrier`, marqué par `clara_courier_id` — un seul par courrier, un rejeu
--     de l'avis ne le double pas ;
--   · pour le papier, un document `courrier` rattaché à cet échange (écrit par
--     l'edge function, par la porte unique des fichiers).

alter table public.request_emails drop constraint request_emails_delivery_check;
alter table public.request_emails add constraint request_emails_delivery_check
  check (delivery = any (array['courriel'::text, 'espace'::text, 'courrier'::text]));

alter table public.request_emails add column if not exists clara_courier_id uuid;
comment on column public.request_emails.clara_courier_id is
  'Courrier sortant de Clara dont cet échange est la trace (courrier de réponse validé dans Clara, 2.13.0). UUID nu, aucune FK hors projet.';
create unique index if not exists request_emails_clara_courier_uidx
  on public.request_emails (clara_courier_id) where clara_courier_id is not null;

-- Enregistre la trace du courrier envoyé. Idempotente : rend l'échange déjà
-- enregistré pour ce courrier. Le courrier doit être celui de la demande.
create or replace function public.record_clara_reply_letter(
  p_organization_id uuid,
  p_request_id      uuid,
  p_courier_id      uuid,
  p_channel         text,
  p_subject         text,
  p_body            text,
  p_recipient       text,
  p_sent_at         timestamptz
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  r       public.requests%rowtype;
  v_id    uuid;
  v_to    text;
begin
  if p_channel not in ('email', 'paper') then
    raise exception 'Canal du courrier : email ou paper.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_subject), '') = '' or coalesce(btrim(p_body), '') = '' then
    raise exception 'Courrier sans objet ou sans texte.' using errcode = '22023';
  end if;

  select * into r from public.requests
   where id = p_request_id and organization_id = p_organization_id;
  if r.id is null then
    raise exception 'Demande introuvable.' using errcode = 'P0002';
  end if;
  if r.clara_courier_id is distinct from p_courier_id then
    raise exception 'Ce courrier n''est pas le courrier de réponse de cette demande.' using errcode = 'P0434';
  end if;

  select e.id into v_id from public.request_emails e where e.clara_courier_id = p_courier_id;
  if v_id is not null then return v_id; end if;

  v_to := nullif(btrim(coalesce(p_recipient, '')), '');
  if v_to is null then
    v_to := case when p_channel = 'paper' then 'Courrier postal' else 'Usager' end;
  end if;

  insert into public.request_emails (
    organization_id, request_id, sent_by, to_email, subject, body,
    status, sent_at, nature, delivery, clara_courier_id
  ) values (
    r.organization_id, r.id, r.reply_submitted_by, left(v_to, 320), left(p_subject, 300), p_body,
    'envoye', least(coalesce(p_sent_at, now()), now()), 'message',
    case when p_channel = 'paper' then 'courrier' else 'courriel' end, p_courier_id
  )
  on conflict (clara_courier_id) where clara_courier_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id from public.request_emails e where e.clara_courier_id = p_courier_id;
  end if;
  return v_id;
end;
$fn$;
revoke execute on function public.record_clara_reply_letter(uuid, uuid, uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_clara_reply_letter(uuid, uuid, uuid, text, text, text, text, timestamptz)
  to service_role;
comment on function public.record_clara_reply_letter(uuid, uuid, uuid, text, text, text, text, timestamptz) is
  'Trace du courrier de réponse envoyé par Clara (2.13.0) : un échange par courrier, idempotent. service_role seul.';
