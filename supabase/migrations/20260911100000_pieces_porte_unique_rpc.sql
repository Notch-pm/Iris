-- ============================================================================
-- Porte unique des pièces — les RPC métier consomment la zone d'attente
-- (lot 2a du chantier documents, 2026-09-08).
--
-- AVANT : le navigateur écrivait lui-même dans le bucket (policy storage sur
-- le chemin), puis passait le CHEMIN à une RPC (`attach_request_piece`,
-- `create_request_from_procedure`, `start_request_email`) qui le revérifiait
-- par préfixe. Rien ne vérifiait le contenu du fichier, et un chemin déclaré
-- directement dans `request_attachments` (policy INSERT cliente) pouvait
-- désigner n'importe quel objet du bucket — que `send-request-email`
-- téléchargeait ensuite en service_role.
--
-- APRÈS : le navigateur envoie le fichier à l'edge function
-- `request-attachments` (porte unique : type réel, taille, sha256), qui
-- l'inscrit dans `attachment_uploads`. Les RPC ne reçoivent plus qu'un
-- `upload_id` et RELISENT tout le reste — chemin, nom, type, taille,
-- empreinte — dans la ligne d'attente, via `consume_attachment_upload`.
-- Aucune valeur de pièce ne vient plus du client.
--
-- ⚠️ ORDRE DE DÉPLOIEMENT (2a) : cette migration change les SIGNATURES. Les
-- edge functions et le front qui les appellent se déploient avec elle, dans
-- la même fenêtre. La fermeture de l'ancien chemin (policies) est la
-- migration SUIVANTE (2b), à n'appliquer qu'une fois tout déployé.
--
-- ⚠️ `SECURITY DEFINER` + `CREATE OR REPLACE` regrante PUBLIC : chaque
-- fonction re-révoque après sa définition (piège vécu chez Clara).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. create_request_from_procedure v3 — pièces par upload_id
--    (corps identique à la v2 de 20260826140000, hors la boucle des pièces).
-- ----------------------------------------------------------------------------
create or replace function public.create_request_from_procedure(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id   uuid;
  v_ref  text;
  a      jsonb;
  v_up   public.attachment_uploads%rowtype;
  v_att  uuid;
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
    coalesce(p -> 'anomalies', '[]'::jsonb)
  )
  returning id, reference into v_id, v_ref;

  -- Les pièces : `{ upload_id, form_field_key }`. Tout le reste est RELU dans la
  -- zone d'attente — l'edge function a déjà déplacé l'objet sous la demande,
  -- consume_attachment_upload le vérifie.
  for a in select * from jsonb_array_elements(coalesce(p -> 'attachments', '[]'::jsonb)) loop
    v_up := public.consume_attachment_upload(
      (a ->> 'upload_id')::uuid, (p ->> 'organization_id')::uuid, v_id,
      (p ->> 'agent_id')::uuid, null);
    insert into public.request_attachments (
      organization_id, request_id, storage_path, file_name, mime_type, file_size,
      checksum, form_field_key, copy_status, uploaded_by, kind
    ) values (
      (p ->> 'organization_id')::uuid, v_id, v_up.storage_path, v_up.file_name, v_up.mime_type,
      v_up.file_size, v_up.checksum, nullif(a ->> 'form_field_key', ''), 'copied',
      (p ->> 'agent_id')::uuid, 'demande'
    ) returning id into v_att;
    update public.attachment_uploads set request_attachment_id = v_att where id = v_up.id;
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
revoke execute on function public.create_request_from_procedure(jsonb)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. attach_request_piece v2 — par upload_id. L'ancienne signature (chemin,
--    nom, type, taille fournis par le client) disparaît.
-- ----------------------------------------------------------------------------
drop function if exists public.attach_request_piece(uuid, text, text, text, bigint, text, uuid);

create or replace function public.attach_request_piece(
  p_request_id     uuid,
  p_upload_id      uuid,
  p_form_field_key text default null,
  p_replaces_id    uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_req      public.requests%rowtype;
  v_uid      uuid := auth.uid();
  v_key      text := nullif(btrim(coalesce(p_form_field_key, '')), '');
  v_up       public.attachment_uploads%rowtype;
  v_id       uuid;
  v_replaced int := 0;
begin
  if v_uid is null then
    raise exception 'Ajout de pièce : authentification requise.';
  end if;

  select * into v_req from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'Ajout de pièce : demande introuvable.';
  end if;
  if v_req.status in ('annulee', 'resolue_positive', 'resolue_negative', 'archivee') then
    raise exception 'Ajout de pièce : la demande est close (%).', v_req.status;
  end if;

  -- Même piège DEFINER que qualify_request_attachment : le droit d'INSTRUCTION
  -- est vérifié ICI, jamais via is_service_context().
  if not (public.is_platform_admin() or public.user_has_request_right(
            v_uid, v_req.organization_id, v_req.socle_organization_id,
            v_req.socle_procedure_id, 'instruction')) then
    raise exception 'Ajouter une pièce exige le droit d''instruction sur cette démarche pour ce service.';
  end if;

  -- La pièce a été reçue par le serveur POUR cette demande, PAR cet agent :
  -- la porte de consommation le vérifie (portée, déposant, expiration, chemin).
  v_up := public.consume_attachment_upload(p_upload_id, v_req.organization_id, v_req.id, v_uid, null);

  insert into public.request_attachments (
    organization_id, request_id, storage_path, file_name, mime_type, file_size,
    checksum, form_field_key, copy_status, uploaded_by, kind
  ) values (
    v_req.organization_id, v_req.id, v_up.storage_path, v_up.file_name, v_up.mime_type,
    v_up.file_size, v_up.checksum, v_key, 'copied', v_uid, 'demande'
  )
  returning id into v_id;
  update public.attachment_uploads set request_attachment_id = v_id where id = v_up.id;

  -- « La plus récente fait foi » (inchangé).
  if v_key is not null then
    update public.request_attachments a
       set superseded_by = v_id, superseded_at = now()
     where a.request_id = v_req.id
       and a.form_field_key = v_key
       and a.email_id is null
       and a.superseded_by is null
       and a.id <> v_id;
    get diagnostics v_replaced = row_count;
  elsif p_replaces_id is not null then
    update public.request_attachments a
       set superseded_by = v_id, superseded_at = now()
     where a.id = p_replaces_id
       and a.request_id = v_req.id
       and a.email_id is null
       and a.superseded_by is null;
    get diagnostics v_replaced = row_count;
  end if;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (v_req.organization_id, v_req.id, 'piece_ajoutee',
          jsonb_build_object(
            'attachment_id',  v_id,
            'file_name',      v_up.file_name,
            'form_field_key', v_key,
            'remplacees',     v_replaced),
          v_uid);

  return jsonb_build_object(
    'attachment_id', v_id,
    'request_id',    v_req.id,
    'remplacees',    v_replaced);
end;
$$;
revoke execute on function public.attach_request_piece(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.attach_request_piece(uuid, uuid, text, uuid)
  to authenticated;
comment on function public.attach_request_piece(uuid, uuid, text, uuid) is
  'Rattache à une demande une pièce reçue par le serveur (upload_id — chemin, nom, type, empreinte relus dans attachment_uploads), et REMPLACE les pièces actives de la même exigence (« la plus récente fait foi »). Ajout + remplacement + journal en une transaction. Exige le droit d''instruction, vérifié ICI.';

-- ----------------------------------------------------------------------------
-- 3. start_request_email v3 — pièce téléversée = { upload_id } ; document du
--    dossier = { attachment_id } (inchangé). Plus aucune forme dictée.
-- ----------------------------------------------------------------------------
create or replace function public.start_request_email(
  p_request_id    uuid,
  p_sent_by       uuid,
  p_to_email      text,
  p_subject       text,
  p_body          text,
  p_template_id   uuid  default null,
  p_template_name text  default null,
  p_attachments   jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_org uuid;
  v_id  uuid;
  a     jsonb;
  src   public.request_attachments%rowtype;
  v_up  public.attachment_uploads%rowtype;
  v_att uuid;
begin
  select r.organization_id into v_org from public.requests r where r.id = p_request_id;
  if v_org is null then
    raise exception 'Échange : demande introuvable.';
  end if;

  insert into public.request_emails (
    organization_id, request_id, sent_by, to_email, subject, body,
    template_id, template_name
  ) values (
    v_org, p_request_id, p_sent_by, btrim(p_to_email), p_subject, p_body,
    p_template_id, nullif(btrim(coalesce(p_template_name, '')), '')
  )
  returning id into v_id;

  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if nullif(a ->> 'attachment_id', '') is not null then
      -- Document du dossier : la vérité est en base, pas dans le payload.
      select * into src
        from public.request_attachments
       where id = (a ->> 'attachment_id')::uuid
         and request_id = p_request_id;
      if not found then
        raise exception 'Pièce jointe introuvable dans cette demande.';
      end if;
      if src.kind = 'instruction_interne' then
        raise exception 'Un document interne à l''instruction ne peut pas être envoyé à l''usager.'
          using errcode = 'check_violation';
      end if;

      insert into public.request_attachments (
        organization_id, request_id, storage_path, file_name, mime_type, file_size,
        copy_status, uploaded_by, email_id, kind, source_attachment_id,
        template_socle_id, template_label
      ) values (
        v_org, p_request_id, src.storage_path, src.file_name, src.mime_type, src.file_size,
        'copied', p_sent_by, v_id, src.kind, src.id,
        src.template_socle_id, src.template_label
      );
    elsif nullif(a ->> 'upload_id', '') is not null then
      -- Fichier reçu par le serveur POUR cette demande, PAR l'expéditeur.
      v_up := public.consume_attachment_upload((a ->> 'upload_id')::uuid, v_org, p_request_id, p_sent_by, null);
      insert into public.request_attachments (
        organization_id, request_id, storage_path, file_name, mime_type, file_size,
        checksum, copy_status, uploaded_by, email_id
      ) values (
        v_org, p_request_id, v_up.storage_path, v_up.file_name, v_up.mime_type, v_up.file_size,
        v_up.checksum, 'copied', p_sent_by, v_id
      ) returning id into v_att;
      update public.attachment_uploads set request_attachment_id = v_att where id = v_up.id;
    else
      raise exception 'Pièce jointe : attachment_id ou upload_id attendu.';
    end if;
  end loop;

  return v_id;
end;
$fn$;
comment on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb) is
  'Ouvre un échange sortant en statut « en_cours » AVEC ses pièces jointes ({ upload_id } reçu par le serveur, ou { attachment_id } du dossier — tout est relu en base), en une transaction. Interne : appelée par la seule edge function send-request-email.';
revoke execute on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb)
  to service_role;

-- ----------------------------------------------------------------------------
-- 4. request_attachment_paths — le préfixe est la garde. La fonction est
--    SECURITY INVOKER, mais son seul appelant réel est une edge function en
--    service_role : le RLS n'y borne rien. Une ligne dont le chemin ne serait
--    pas sous la demande (héritage d'une policy INSERT trop large) n'est plus
--    rendue, donc jamais téléchargée.
-- ----------------------------------------------------------------------------
create or replace function public.request_attachment_paths(p_request_id uuid, p_ids uuid[])
returns table (attachment_id uuid, path text, name text, mime text, size bigint, nature text)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.storage_path, a.file_name, a.mime_type, a.file_size, a.kind
    from public.request_attachments a
   where a.request_id = p_request_id
     and a.id = any(coalesce(p_ids, '{}'::uuid[]))
     and a.storage_path like a.organization_id::text || '/' || a.request_id::text || '/%';
$$;
comment on function public.request_attachment_paths(uuid, uuid[]) is
  'Chemins des pièces d''une demande, pour l''envoi. Appelée en service_role par send-request-email : la garde est le PRÉFIXE {org}/{demande}/ du chemin, pas le RLS.';
revoke execute on function public.request_attachment_paths(uuid, uuid[]) from public, anon;
grant  execute on function public.request_attachment_paths(uuid, uuid[]) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. discard_attachment_uploads — l'agent retire une pièce avant de l'avoir
--    rattachée (composeur), ou l'edge function nettoie après un échec. Ne
--    touche qu'aux lignes VIVANTES du déposant ; l'objet part avec (edge,
--    puis outbox au lot 4).
-- ----------------------------------------------------------------------------
create or replace function public.discard_attachment_uploads(p_ids uuid[], p_actor uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.attachment_uploads
     set discarded_at = now()
   where id = any(coalesce(p_ids, '{}'::uuid[]))
     and uploaded_by = p_actor
     and consumed_at is null
     and discarded_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
comment on function public.discard_attachment_uploads(uuid[], uuid) is
  'Marque retirées les pièces téléversées (non rattachées) d''un agent. service_role uniquement — appelée par request-attachments et send-request-email.';
revoke execute on function public.discard_attachment_uploads(uuid[], uuid)
  from public, anon, authenticated;
