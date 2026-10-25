-- ============================================================================
-- B12, lot L4c-2 — les portes d'écriture des routes 2.10.0 de `requests-api`.
-- Architecture : docs/notifications-usager-architecture.md (§3, ADR-2, ADR-3, ADR-12).
--
-- Nora (propriétaire) pousse à Iris ce que le choix du canal doit savoir :
--   · l'adresse de son espace usager, par collectivité (`integration_sources`) ;
--   · pour une fiche Socle : espace actif, préférences par canal, et l'empreinte
--     de l'adresse du compte — calculée par Iris depuis le jeton, JAMAIS depuis
--     le corps (`citizen_space_links`) ;
--   · la préférence d'un INVITÉ pour sa demande (`request_access_codes.notify_email`),
--     depuis `/suivi` ou depuis le lien de désinscription.
-- Service seul : la garde (clé, jeton, tenant) est dans `requests-api`.
-- ============================================================================

create or replace function public.set_citizen_space(
  p_source_id uuid, p_space_url text, p_request_url_template text)
returns void language sql security definer set search_path = '' as $$
  update public.integration_sources
     set citizen_space_url = p_space_url,
         citizen_request_url_template = p_request_url_template,
         updated_at = now()
   where id = p_source_id;
$$;
comment on function public.set_citizen_space(uuid, text, text) is
  'Adresse de l''espace usager du portail pour cette source (PUT /v1/citizen/space, ADR-3). service_role uniquement.';
revoke execute on function public.set_citizen_space(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_citizen_space(uuid, text, text) to service_role;

create or replace function public.push_citizen_space_link(
  p_org_id uuid, p_contact_id uuid, p_source_id uuid, p_channel_prefs jsonb, p_account_email_hash text)
returns void language sql security definer set search_path = '' as $$
  insert into public.citizen_space_links as l
    (organization_id, socle_contact_id, integration_source_id, space_active, channel_prefs, account_email_hash, pushed_at)
  values (p_org_id, p_contact_id, p_source_id, true, p_channel_prefs, p_account_email_hash, now())
  on conflict (organization_id, socle_contact_id) do update
    set integration_source_id = excluded.integration_source_id,
        space_active = true,
        channel_prefs = excluded.channel_prefs,
        account_email_hash = excluded.account_email_hash,
        pushed_at = now();
$$;
comment on function public.push_citizen_space_link(uuid, uuid, uuid, jsonb, text) is
  'Copie poussée par Nora pour une fiche (PUT …/contacts/{id}/notification-preferences) : écrasée à chaque poussée, idempotente. service_role uniquement.';
revoke execute on function public.push_citizen_space_link(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.push_citizen_space_link(uuid, uuid, uuid, jsonb, text) to service_role;

create or replace function public.close_citizen_space_link(p_org_id uuid, p_contact_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.citizen_space_links
     set space_active = false, pushed_at = now()
   where organization_id = p_org_id and socle_contact_id = p_contact_id;
$$;
comment on function public.close_citizen_space_link(uuid, uuid) is
  'Espace fermé ou compte supprimé (DELETE …/notification-preferences) : plus d''avis par le canal compte. service_role uniquement.';
revoke execute on function public.close_citizen_space_link(uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_citizen_space_link(uuid, uuid) to service_role;

create or replace function public.set_guest_notify_email(p_request_id uuid, p_org_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  update public.request_access_codes
     set notify_email = p_enabled,
         notify_changed_at = case when notify_email is distinct from p_enabled then now() else notify_changed_at end
   where request_id = p_request_id and organization_id = p_org_id;
  return found;
end;
$fn$;
comment on function public.set_guest_notify_email(uuid, uuid, boolean) is
  'Préférence de l''invité pour CETTE demande seule (/suivi ou lien de désinscription). Rend false si la demande n''a pas d''accès invité. service_role uniquement.';
revoke execute on function public.set_guest_notify_email(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_guest_notify_email(uuid, uuid, boolean) to service_role;
