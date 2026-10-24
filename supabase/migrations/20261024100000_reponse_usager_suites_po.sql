-- ============================================================================
-- Réponse de l'usager en ligne (L4b) — suites des décisions PO du 2026-10-24
-- ============================================================================
--
-- B11 — UNE notification pour un geste de l'usager. Quand l'usager répond sur
--   une demande `en_attente`, `record_citizen_message` la remet
--   `en_instruction` : l'affectataire recevait `status_changed` (par le trigger
--   t40) PUIS `citizen_replied`. Décision PO : on supprime celle du statut. La
--   reprise n'est pas perdue — `citizen_replied` porte désormais `reprise`, et
--   les textes (cloche, e-mail, push) la disent.
--   Mécanisme : un drapeau LOCAL À LA TRANSACTION (`iris.reprise_usager`),
--   posé par la RPC autour de son seul UPDATE et relu par
--   `requests_notify_update`. Un drapeau plutôt qu'une suppression après coup :
--   rien n'est écrit puis retiré, et l'e-mail ne risque pas de partir entre les
--   deux. Le journal (`request_events`) n'est pas touché : le retour en
--   instruction y reste écrit, c'est un fait du dossier.
--
-- B10 — « Verser au dossier » une pièce reçue en réponse (décision PO : oui,
--   geste explicite de l'agent, jamais automatique). La pièce de l'échange
--   RESTE dans l'échange ; le versement crée une LIGNE de plus, pas un fichier
--   de plus — même `storage_path`, `source_attachment_id` vers l'original,
--   `citizen_message_id` NULL — exactement le motif inverse de « joindre un
--   document du dossier à un e-mail ». Tous les filtres existants classent
--   déjà les deux lignes : la copie est une pièce du dossier (qualifiable,
--   comptée par t17), l'original reste une pièce d'échange, et la fiche usager
--   ne montre que l'original (`source_attachment_id is null`).
--   « La plus récente fait foi » s'applique comme pour `attach_request_piece`.
--
-- Avant ce CREATE OR REPLACE, les deux définitions live ont été comparées aux
-- miroirs : `record_citizen_message` (md5 de prosrc identique au miroir
-- 20261021120000) et `requests_notify_update` (relue par pg_get_functiondef).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Le trigger de notification se tait sur le retour en instruction de B11
-- ----------------------------------------------------------------------------

create or replace function public.requests_notify_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if new.socle_organization_id is distinct from old.socle_organization_id then
    insert into public.notifications (organization_id, user_id, request_id, kind, actor_id,
                                      payload, in_app, email_status)
    select new.organization_id, m.user_id, new.id, 'transferred_in', v_actor,
           jsonb_build_object(
             'reference', new.reference, 'subject', new.subject,
             'actor_name', public.user_display_name(v_actor),
             'status', new.status,
             'procedure', new.socle_procedure_label,
             'destinataire', new.socle_organization_label,
             'from_destinataire', old.socle_organization_label,
             'received_at', new.received_at),
           ch.use_in_app,
           case when ch.use_email then 'pending' else 'skipped' end
      from public.organization_members m
      cross join lateral public.notification_channels_for(m.user_id, 'transferred_in') ch
     where m.organization_id = new.organization_id
       and m.user_id is distinct from v_actor
       and (ch.use_in_app or ch.use_email)
       and public.request_right_for(
             m.user_id, new.organization_id, new.socle_organization_id,
             new.socle_procedure_id, 'instruction');
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform public.push_notification(
      new.assigned_to, v_actor, new.organization_id, new.id, 'assigned',
      new.reference, new.subject, jsonb_build_object('status', new.status));
    perform public.push_notification(
      old.assigned_to, v_actor, new.organization_id, new.id, 'unassigned',
      new.reference, new.subject,
      jsonb_build_object('status', new.status, 'reassigned', new.assigned_to is not null));
  elsif new.status is distinct from old.status
        -- B11 : la réponse de l'usager porte elle-même la reprise (`citizen_replied`).
        and coalesce(current_setting('iris.reprise_usager', true), '') <> 'on' then
    perform public.push_notification(
      new.assigned_to, v_actor, new.organization_id, new.id, 'status_changed',
      new.reference, new.subject,
      jsonb_build_object('from', old.status, 'to', new.status, 'motif', new.closure_motif));
  end if;
  return null;
end;
$function$;
revoke execute on function public.requests_notify_update() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. record_citizen_message : drapeau autour du retour, `reprise` au payload
-- ----------------------------------------------------------------------------

create or replace function public.record_citizen_message(
  p_request_id  uuid,
  p_org         uuid,
  p_source      uuid,
  p_author_kind text,
  p_contact_id  uuid,
  p_body        text,
  p_items       jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_req     public.requests%rowtype;
  v_msg     uuid;
  item      jsonb;
  v_up      public.attachment_uploads%rowtype;
  v_att     uuid;
  v_n       integer := 0;
  v_resumed boolean := false;
begin
  if p_source is null then
    raise exception 'record_citizen_message : source d''intégration requise.';
  end if;
  select * into v_req from public.requests r
   where r.id = p_request_id and r.organization_id = p_org
   for update;
  if not found then
    raise exception 'record_citizen_message : demande introuvable dans ce tenant.';
  end if;
  if v_req.status in ('resolue_positive', 'resolue_negative', 'annulee', 'archivee') then
    raise exception 'Demande close : elle ne reçoit plus de message.' using errcode = 'P0409';
  end if;

  insert into public.request_citizen_messages (organization_id, request_id, author_kind, socle_contact_id, body)
  values (p_org, p_request_id, p_author_kind, p_contact_id, btrim(p_body))
  returning id into v_msg;

  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_up := public.consume_attachment_upload((item ->> 'upload_id')::uuid, p_org, p_request_id, null, p_source);
    insert into public.request_attachments (
      organization_id, request_id, storage_path, file_name, mime_type, file_size,
      checksum, copy_status, uploaded_by, kind, citizen_message_id
    ) values (
      p_org, p_request_id, v_up.storage_path, v_up.file_name, v_up.mime_type, v_up.file_size,
      v_up.checksum, 'copied', null, 'demande', v_msg
    ) returning id into v_att;
    update public.attachment_uploads set request_attachment_id = v_att where id = v_up.id;
    v_n := v_n + 1;
  end loop;

  -- La réponse attendue est arrivée : le dossier revient à l'instruction. La
  -- garde des transitions laisse passer le contexte service ; le journal
  -- (`status_changed`) suit par trigger. La NOTIFICATION de statut, elle, se
  -- tait (B11, décision PO 2026-10-24) : `citizen_replied` dit la reprise.
  -- Le drapeau est local à la transaction et retiré aussitôt l'UPDATE fait
  -- (les triggers AFTER ROW jouent à la fin de l'instruction, avant le retour).
  if v_req.status = 'en_attente' then
    perform set_config('iris.reprise_usager', 'on', true);
    update public.requests set status = 'en_instruction' where id = p_request_id;
    perform set_config('iris.reprise_usager', '', true);
    v_resumed := true;
  end if;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (p_org, p_request_id, 'message_usager_recu',
          jsonb_build_object('message_id', v_msg, 'pieces', v_n, 'canal', p_author_kind, 'reprise', v_resumed),
          null);

  -- L'assigné ; à défaut, qui instruit le couple de la demande. Jamais le corps.
  if v_req.assigned_to is not null then
    perform public.push_notification(
      v_req.assigned_to, null, p_org, p_request_id, 'citizen_replied',
      v_req.reference, v_req.subject,
      jsonb_build_object('pieces', v_n, 'status', v_req.status, 'reprise', v_resumed));
  else
    insert into public.notifications (organization_id, user_id, request_id, kind, actor_id,
                                      payload, in_app, email_status)
    select p_org, m.user_id, p_request_id, 'citizen_replied', null,
           jsonb_build_object('reference', v_req.reference, 'subject', v_req.subject,
                              'actor_name', null, 'pieces', v_n, 'status', v_req.status,
                              'reprise', v_resumed),
           ch.use_in_app,
           case when ch.use_email then 'pending' else 'skipped' end
      from public.organization_members m
      cross join lateral public.notification_channels_for(m.user_id, 'citizen_replied') ch
     where m.organization_id = p_org
       and (ch.use_in_app or ch.use_email)
       and public.request_right_for(
             m.user_id, p_org, v_req.socle_organization_id, v_req.socle_procedure_id, 'instruction');
  end if;

  return v_msg;
end;
$fn$;
comment on function public.record_citizen_message(uuid, uuid, uuid, text, uuid, text, jsonb) is
  'Enregistre un message de l''usager (L4b) : message, pièces consommées de la zone d''attente, retour en_attente → en_instruction (sans notification de statut : citizen_replied porte reprise), journal (message_usager_recu), notifications citizen_replied — en une transaction. Refuse une demande close (P0409). service_role uniquement.';
revoke execute on function public.record_citizen_message(uuid, uuid, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_citizen_message(uuid, uuid, uuid, text, uuid, text, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 3. file_citizen_piece — verser au dossier une pièce reçue en réponse (B10)
-- ----------------------------------------------------------------------------

create or replace function public.file_citizen_piece(
  p_attachment_id  uuid,
  p_form_field_key text default null,
  p_replaces_id    uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_src      public.request_attachments%rowtype;
  v_req      public.requests%rowtype;
  v_uid      uuid := auth.uid();
  v_key      text := nullif(btrim(coalesce(p_form_field_key, '')), '');
  v_id       uuid;
  v_replaced int := 0;
begin
  if v_uid is null then
    raise exception 'Versement au dossier : authentification requise.';
  end if;

  select * into v_src from public.request_attachments a where a.id = p_attachment_id;
  if not found then
    raise exception 'Versement au dossier : pièce introuvable.';
  end if;
  if v_src.citizen_message_id is null then
    raise exception 'Versement au dossier : seule une pièce jointe par l''usager à une réponse en ligne peut être versée.';
  end if;

  select * into v_req from public.requests r where r.id = v_src.request_id for update;
  if v_req.status in ('annulee', 'resolue_positive', 'resolue_negative', 'archivee') then
    raise exception 'Versement au dossier : la demande est close (%).', v_req.status;
  end if;

  -- Piège DEFINER (cf. attach_request_piece) : le droit d'INSTRUCTION est
  -- vérifié ICI, jamais via is_service_context().
  if not (public.is_platform_admin() or public.user_has_request_right(
            v_uid, v_req.organization_id, v_req.socle_organization_id,
            v_req.socle_procedure_id, 'instruction')) then
    raise exception 'Verser une pièce au dossier exige le droit d''instruction sur cette démarche pour ce service.';
  end if;

  if exists (select 1 from public.request_attachments a
              where a.source_attachment_id = v_src.id
                and a.email_id is null and a.citizen_message_id is null) then
    raise exception 'Cette pièce a déjà été versée au dossier.' using errcode = 'P0409';
  end if;

  -- Une ligne de plus, pas un fichier de plus. `uploaded_by` reste NULL : la
  -- pièce vient de l'usager ; l'agent qui la verse est nommé par le journal.
  insert into public.request_attachments (
    organization_id, request_id, storage_path, file_name, mime_type, file_size,
    checksum, form_field_key, copy_status, uploaded_by, kind, source_attachment_id
  ) values (
    v_req.organization_id, v_req.id, v_src.storage_path, v_src.file_name, v_src.mime_type,
    v_src.file_size, v_src.checksum, v_key, 'copied', null, 'demande', v_src.id
  )
  returning id into v_id;

  -- « La plus récente fait foi » — mêmes règles qu'attach_request_piece, bornées
  -- aux pièces du DOSSIER (jamais une pièce d'échange).
  if v_key is not null then
    update public.request_attachments a
       set superseded_by = v_id, superseded_at = now()
     where a.request_id = v_req.id
       and a.form_field_key = v_key
       and a.email_id is null
       and a.citizen_message_id is null
       and a.superseded_by is null
       and a.id <> v_id;
    get diagnostics v_replaced = row_count;
  elsif p_replaces_id is not null then
    update public.request_attachments a
       set superseded_by = v_id, superseded_at = now()
     where a.id = p_replaces_id
       and a.request_id = v_req.id
       and a.email_id is null
       and a.citizen_message_id is null
       and a.superseded_by is null;
    get diagnostics v_replaced = row_count;
  end if;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (v_req.organization_id, v_req.id, 'piece_ajoutee',
          jsonb_build_object(
            'attachment_id',  v_id,
            'file_name',      v_src.file_name,
            'form_field_key', v_key,
            'remplacees',     v_replaced,
            'origine',        'reponse_usager',
            'source_attachment_id', v_src.id),
          v_uid);

  return jsonb_build_object(
    'attachment_id', v_id,
    'request_id',    v_req.id,
    'remplacees',    v_replaced);
end;
$$;
revoke execute on function public.file_citizen_piece(uuid, text, uuid) from public, anon;
grant execute on function public.file_citizen_piece(uuid, text, uuid) to authenticated;
comment on function public.file_citizen_piece(uuid, text, uuid) is
  'Verse au dossier une pièce jointe par l''usager à une réponse en ligne (B10, décision PO 2026-10-24) : copie de ligne (même storage_path, source_attachment_id), rattachée à une exigence, REMPLACE les pièces actives de la même exigence — journal piece_ajoutee origine reponse_usager. Une seule fois par pièce. Exige le droit d''instruction, vérifié ICI.';
