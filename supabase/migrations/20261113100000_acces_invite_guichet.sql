-- Accès invité aux demandes du GUICHET (décision PO du 2026-11-13).
--
-- Une demande saisie au guichet d'Iris (`requests.source = 'iris'`) reçoit
-- désormais un code d'accès avec son accusé, dès qu'une adresse est connue
-- (`create-request-from-procedure`). Le portail de la collectivité doit pouvoir
-- l'ouvrir : les deux recherches par (tenant, source, référence) acceptent la
-- source du guichet en plus de celle de la clé appelante. Le tenant reste
-- imposé ; rien d'autre ne change (empreintes, verrou, renvois, expiration).
--
-- Corps repris du catalogue LIVE (2026-11-13), seule la clause de source change.

create or replace function public.check_request_access(
  p_organization_id uuid, p_source text, p_reference text, p_email_hash text, p_code_hash text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_access public.request_access_codes%rowtype;
  v_closed timestamptz;
begin
  select a.* into v_access
    from public.request_access_codes a
    join public.requests r on r.id = a.request_id
   where r.organization_id = p_organization_id
     and r.source in (p_source, 'iris')
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
$function$;
revoke execute on function public.check_request_access(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.check_request_access(uuid, text, text, text, text) to service_role;

create or replace function public.request_access_resend(
  p_organization_id uuid, p_source text, p_reference text, p_email_hash text, p_email text,
  p_code_hash text, p_code text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_access public.request_access_codes%rowtype;
  v_closed timestamptz;
  v_count  int;
begin
  select a.* into v_access
    from public.request_access_codes a
    join public.requests r on r.id = a.request_id
   where r.organization_id = p_organization_id
     and r.source in (p_source, 'iris')
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
$function$;
revoke execute on function public.request_access_resend(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.request_access_resend(uuid, text, text, text, text, text, text) to service_role;
