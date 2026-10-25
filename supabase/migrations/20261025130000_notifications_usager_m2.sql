-- ============================================================================
-- B12, lot L4c-3 — M2 : le message de l'agent est PUBLIÉ dans l'espace de
-- l'usager, et un avis avec extrait l'annonce (ADR-10).
--
--   · `citizen_channel_inputs` : ce que la règle du canal lit, pour
--     `send-request-email` (aperçu et envoi) — les mêmes faits que ceux que
--     `claim_citizen_notices` rend au facteur ;
--   · `publish_citizen_message` : DANS UNE SEULE TRANSACTION, le message passe
--     `delivery = 'espace'`, est réglé `envoye` (lisible tout de suite dans
--     l'espace ou sur `/suivi`), et son id s'ajoute à la ligne `pending` de la
--     demande — fusionné avec un éventuel changement de statut de la fenêtre.
-- Service seul.
-- ============================================================================

create or replace function public.citizen_channel_inputs(p_request_id uuid)
returns table (
  enabled                   boolean,
  source                    text,
  citizen_visible           boolean,
  closed_at                 timestamptz,
  guest_email_hash          text,
  guest_tracking_url        text,
  guest_revoked_at          timestamptz,
  guest_notify_email        boolean,
  link_space_active         boolean,
  link_channel_prefs        jsonb,
  link_account_email_hash   text,
  link_space_url            text,
  link_request_url_template text
)
language sql stable security definer set search_path = '' as $$
  select public.citizen_notices_enabled(r.organization_id), r.source, r.citizen_visible, r.closed_at,
         a.email_hash, a.tracking_url, a.revoked_at, a.notify_email,
         l.space_active, l.channel_prefs, l.account_email_hash,
         s.citizen_space_url, s.citizen_request_url_template
    from public.requests r
    left join public.request_access_codes a on a.request_id = r.id
    left join public.citizen_space_links l
           on l.organization_id = r.organization_id and l.socle_contact_id = r.socle_contact_id
    left join public.integration_sources s on s.id = l.integration_source_id
   where r.id = p_request_id;
$$;
comment on function public.citizen_channel_inputs(uuid) is
  'Faits lus par la règle du canal (ADR-4) pour une demande : interrupteur, visibilité, accès invité, lien d''espace. service_role uniquement.';
revoke execute on function public.citizen_channel_inputs(uuid) from public, anon, authenticated;
grant execute on function public.citizen_channel_inputs(uuid) to service_role;

create or replace function public.publish_citizen_message(p_email_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  v_request uuid;
  v_org     uuid;
  v_status  text;
begin
  select e.request_id, e.organization_id, e.status into v_request, v_org, v_status
    from public.request_emails e where e.id = p_email_id for update;
  if v_request is null then
    raise exception 'Message introuvable.';
  end if;
  if v_status <> 'en_cours' then
    raise exception 'Message déjà réglé : il ne se publie pas deux fois.';
  end if;

  update public.request_emails set delivery = 'espace' where id = p_email_id;
  perform public.settle_request_email(p_email_id, true, null);

  insert into public.citizen_notices (organization_id, request_id, message_email_ids, due_at)
  values (v_org, v_request, array[p_email_id], now() + interval '10 minutes')
  on conflict (request_id) where status = 'pending' do update
    set message_email_ids = public.citizen_notices.message_email_ids || excluded.message_email_ids;
end;
$fn$;
comment on function public.publish_citizen_message(uuid) is
  'M2 : publie un message dans l''espace usager (delivery espace, réglé envoye) et enfile son avis sur la ligne pending de la demande, dans la même transaction. service_role uniquement.';
revoke execute on function public.publish_citizen_message(uuid) from public, anon, authenticated;
grant execute on function public.publish_citizen_message(uuid) to service_role;
