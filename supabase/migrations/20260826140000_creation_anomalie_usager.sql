-- Création guidée : porter les ANOMALIES jusqu'à la demande.
--
-- Décision PO du 2026-08-26 : une identité sans correspondance est une nouvelle
-- personne, qu'on CRÉE dans le Socle. « Poursuivre sans rapprochement » ne
-- subsiste que comme sortie de secours, sur une panne AVÉRÉE du référentiel —
-- on ne renvoie pas chez lui un usager présent au guichet. La demande doit
-- alors dire d'elle-même qu'il reste un geste à faire : c'est l'anomalie
-- `usager_a_creer_dans_socle`, à régulariser plus tard.
--
-- `create_request_from_procedure` n'écrivait pas `anomalies` (la colonne
-- retombait sur son défaut `[]`). On l'ajoute — sans rien changer d'autre au
-- corps de la fonction.
--
-- ⚠️ FORME DES ANOMALIES : un TABLEAU D'OBJETS `{"code": "..."}`, jamais de
-- chaînes nues. C'est la forme qu'impose `requests_set_scope_org`, qui filtre
-- par `a ->> 'code'` : une chaîne nue y donne NULL et se fait silencieusement
-- effacer au premier recalcul de périmètre. `requests-api` poussait justement
-- des chaînes — aligné dans la même livraison.
--
-- ⚠️ `SECURITY DEFINER` + `CREATE OR REPLACE` : le replace REGRANTE PUBLIC
-- (piège vécu chez Clara). Les révocations ci-dessous ne sont pas décoratives.

create or replace function public.create_request_from_procedure(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id  uuid;
  v_ref text;
  a     jsonb;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p ->> 'agent_id', 'role', 'authenticated')::text, true);

  insert into public.requests (
    id, organization_id,
    reference, reference_year, reference_seq, socle_root_org_id,
    subject, body, priority, channel,
    socle_organization_id, socle_organization_label,
    socle_procedure_id, socle_contact_id,
    procedure_snapshot, requester_snapshot, identity_status, form_data,
    anomalies
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
    coalesce(p -> 'form_data', '{}'::jsonb),
    -- Le trigger t21 repart de `new.anomalies` à l'INSERT : ce qu'on pose ici
    -- est conservé, et `destinataire_inconnu` s'y ajoute le cas échéant.
    coalesce(p -> 'anomalies', '[]'::jsonb)
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
$function$;

revoke execute on function public.create_request_from_procedure(jsonb) from public, anon, authenticated;
grant  execute on function public.create_request_from_procedure(jsonb) to service_role;
