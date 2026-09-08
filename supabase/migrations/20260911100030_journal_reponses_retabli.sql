-- ============================================================================
-- Rétablit le journal des réponses modifiées (`form_data_updated`).
--
-- RÉGRESSION constatée le 2026-09-08 en rejouant pieces-remplacees.test.sql :
-- la migration du transfert d'organisme (20260901100000) a réémis
-- `requests_log_update` à partir de sa forme de 20260820100200 — sans la
-- branche `form_data_updated` ajoutée le 2026-08-28 (20260828110000). Depuis
-- le 1er septembre, corriger une réponse de formulaire ne laissait donc plus
-- aucune trace, alors que l'écran l'annonce et que le test l'exige.
--
-- Cette version porte les QUATRE branches : statut, transfert, affectation,
-- réponses. Toute réémission future doit repartir d'ICI.
--
-- ⚠️ CREATE OR REPLACE re-accorde EXECUTE à PUBLIC : la révocation est rejouée.
-- ============================================================================
create or replace function public.requests_log_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[];
begin
  if new.status is distinct from old.status then
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status,
                               'motif', new.closure_motif, 'version', new.version),
            auth.uid());
  end if;
  if new.socle_organization_id is distinct from old.socle_organization_id then
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'transferred',
            jsonb_build_object(
              'from', old.socle_organization_id, 'to', new.socle_organization_id,
              'from_label', old.socle_organization_label,
              'to_label', new.socle_organization_label,
              'unassigned', old.assigned_to is not null and new.assigned_to is null),
            auth.uid());
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.request_assignments (organization_id, request_id, assigned_to, assigned_by)
    values (new.organization_id, new.id, new.assigned_to, auth.uid());
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'assigned',
            jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to), auth.uid());
  end if;
  -- Les CLÉS touchées, jamais les valeurs (données personnelles, journal immuable).
  if new.form_data is distinct from old.form_data then
    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_keys
      from jsonb_object_keys(
             coalesce(old.form_data, '{}'::jsonb) || coalesce(new.form_data, '{}'::jsonb)) as k
     where (coalesce(old.form_data, '{}'::jsonb) -> k)
           is distinct from (coalesce(new.form_data, '{}'::jsonb) -> k);
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'form_data_updated',
            jsonb_build_object('keys', to_jsonb(v_keys),
                               'count', coalesce(array_length(v_keys, 1), 0)),
            auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_log_update() from public, anon, authenticated;
