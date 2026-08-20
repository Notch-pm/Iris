-- ============================================================================
-- RPC de création guidée d'une demande depuis une démarche Socle — appelée
-- EXCLUSIVEMENT par l'edge function create-request-from-procedure (service
-- role), qui a déjà tout validé (JWT + rôle, démarche rechargée depuis Socle,
-- requester_config, form_schema, conditions, pièces) et construit les
-- snapshots CÔTÉ SERVEUR. Une fonction plpgsql = UNE transaction : demande,
-- pièces et événement s'écrivent tous ou pas du tout (aucune insertion
-- partielle). Les gardes des triggers (t15 source, t16 démarche, numérotation,
-- journal) restent l'ultime filet.
-- ============================================================================

create or replace function public.create_request_from_procedure(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  uuid;
  v_ref text;
  a     jsonb;
begin
  -- Attribution : les triggers de journal (DEFINER, auth.uid()) créditent
  -- l'agent, pas « système ». Portée locale à la transaction.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p ->> 'agent_id', 'role', 'authenticated')::text, true);

  insert into public.requests (
    id, organization_id,
    reference, reference_year, reference_seq, socle_root_org_id, -- posés par triggers
    subject, body, priority, channel,
    socle_organization_id, socle_organization_label,
    socle_procedure_id, socle_contact_id,
    procedure_snapshot, requester_snapshot, identity_status, form_data
  ) values (
    (p ->> 'request_id')::uuid,
    (p ->> 'organization_id')::uuid,
    'en-attente', 0, 0, (p ->> 'organization_id')::uuid,
    p ->> 'subject',
    nullif(p ->> 'body', ''),
    coalesce(p ->> 'priority', 'normale'),
    nullif(p ->> 'channel', ''),
    nullif(p ->> 'socle_organization_id', '')::uuid,
    nullif(p ->> 'socle_organization_label', ''),
    (p ->> 'socle_procedure_id')::uuid,
    nullif(p ->> 'socle_contact_id', '')::uuid,
    p -> 'procedure_snapshot',
    p -> 'requester_snapshot',
    coalesce(p ->> 'identity_status', 'non_rapprochee'),
    coalesce(p -> 'form_data', '{}'::jsonb)
  )
  returning id, reference into v_id, v_ref;

  for a in select * from jsonb_array_elements(coalesce(p -> 'attachments', '[]'::jsonb)) loop
    insert into public.request_attachments (
      organization_id, request_id, storage_path, file_name, mime_type, file_size,
      form_field_key, copy_status, uploaded_by
    ) values (
      (p ->> 'organization_id')::uuid,
      v_id,
      a ->> 'storage_path',
      a ->> 'file_name',
      nullif(a ->> 'mime_type', ''),
      nullif(a ->> 'size_bytes', '')::bigint,
      nullif(a ->> 'form_field_key', ''),
      'copied',
      (p ->> 'agent_id')::uuid
    );
  end loop;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (
    (p ->> 'organization_id')::uuid,
    v_id,
    'request_created_from_procedure',
    jsonb_build_object(
      'socle_procedure_id', p ->> 'socle_procedure_id',
      'socle_contact_id',   p ->> 'socle_contact_id',
      'audience',           p ->> 'audience',
      'attachments',        jsonb_array_length(coalesce(p -> 'attachments', '[]'::jsonb))
    ),
    (p ->> 'agent_id')::uuid
  );

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

-- Règle CLAUDE.md : jamais exécutable par les clients — service uniquement.
revoke execute on function public.create_request_from_procedure(jsonb)
  from public, anon, authenticated;
