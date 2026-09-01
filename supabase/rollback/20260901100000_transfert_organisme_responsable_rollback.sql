-- Rollback du transfert d'organisme responsable (migration 20260901100000).
-- ⚠️ Jamais via `apply_migration` (ce n'est pas une migration).
--
-- À jouer si le transfert doit être refermé — par exemple si le miroir des
-- activations s'avère faux et bloque des transferts légitimes (t12), ou si le
-- retrait automatique d'affectation (t08) surprend un service.
--
-- Ce que le rollback NE défait PAS, volontairement :
--   · les notifications `transferred_in` déjà produites (les contraintes de
--     `kind` restent élargies : les rétrécir ferait échouer la validation sur
--     des lignes existantes, et une notification déjà lue n'a pas à disparaître) ;
--   · les événements `transferred` du journal, qui est immuable par construction.
-- L'écran, lui, redevient inoffensif : sans t08 le libellé soumis par le
-- navigateur ferait autorité, donc RETIRER AUSSI le menu « Organisme
-- responsable » du rail (`PriseEnChargeCard`) si ce rollback doit durer.

-- La RPC d'abord : sans elle, l'ecran n'a plus de porte du tout (un UPDATE nu
-- est refuse par le RLS des que la cible sort du perimetre de l'auteur).
drop function if exists public.transfer_request(uuid, uuid);

drop trigger if exists t12_requests_transfer_procedure_active on public.requests;
drop function if exists public.requests_transfer_procedure_active();

drop trigger if exists t08_requests_apply_transfer on public.requests;
drop function if exists public.requests_apply_transfer();

-- Journal et notifications reviennent à leur forme d'avant le transfert.
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

create or replace function public.requests_notify_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.assigned_to is distinct from old.assigned_to then
    perform public.push_notification(
      new.assigned_to, v_actor, new.organization_id, new.id, 'assigned',
      new.reference, new.subject, jsonb_build_object('status', new.status));
    perform public.push_notification(
      old.assigned_to, v_actor, new.organization_id, new.id, 'unassigned',
      new.reference, new.subject,
      jsonb_build_object('status', new.status, 'reassigned', new.assigned_to is not null));
  elsif new.status is distinct from old.status then
    perform public.push_notification(
      new.assigned_to, v_actor, new.organization_id, new.id, 'status_changed',
      new.reference, new.subject,
      jsonb_build_object('from', old.status, 'to', new.status, 'motif', new.closure_motif));
  end if;
  return null;
end;
$$;
revoke execute on function public.requests_notify_update() from public, anon, authenticated;
