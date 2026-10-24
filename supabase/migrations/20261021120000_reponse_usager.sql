-- ============================================================================
-- L'usager RÉPOND en ligne — depuis son compte ou depuis le suivi sans compte.
--
-- Projet Sceaux (AO 26AS02), lot L4b de l'espace usager (CCTP 4.2 : échanges,
-- demande de complément sans clôture). Jusqu'ici `request_emails` ne gardait
-- que ce qui PART vers l'usager ; rien de ce qu'il dit n'entrait dans Iris.
--
--   · UNE TABLE À PART, pas une colonne `direction` dans `request_emails` :
--     celle-ci exige destinataire et objet, et toute sa chaîne (vue usager,
--     filtre par adresse, statuts d'envoi) suppose un message SORTANT. Un
--     message entrant mêlé à ces lignes serait rendu à l'usager comme reçu.
--   · ÉCRIT PAR LE SERVEUR SEUL : `record_citizen_message` (service_role),
--     appelée par `requests-api` après ses propres contrôles (jeton court,
--     propriété de la demande, version d'accès). Aucune écriture cliente.
--   · UNE TRANSACTION : le message, ses pièces (zone d'attente consommée), le
--     retour `en_attente` → `en_instruction`, le journal et les notifications.
--   · DEMANDE CLOSE : refusée (décision PO du 2026-10-20, choix par défaut de
--     L4) — on ne relance pas un dossier tranché par un message.
--   · NOTIFICATIONS (`citizen_replied`) : l'agent assigné, et à défaut tous
--     ceux qui ont le droit d'instruction sur le couple de la demande. Le
--     corps du message n'est jamais recopié dans une notification.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Les messages
-- ----------------------------------------------------------------------------

create table public.request_citizen_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  request_id       uuid not null references public.requests(id) on delete cascade,
  -- Par où l'usager est passé : son compte (fiche du Socle) ou le code d'accès.
  author_kind      text not null check (author_kind in ('compte', 'invite')),
  socle_contact_id uuid,
  body             text not null check (btrim(body) <> '' and length(body) <= 5000),
  created_at       timestamptz not null default now(),
  constraint request_citizen_messages_author_contact
    check ((author_kind = 'compte') = (socle_contact_id is not null))
);
comment on table public.request_citizen_messages is
  'Messages de l''usager sur SA demande, depuis le portail (compte ou suivi sans compte). Écrits par record_citizen_message (service_role) seulement ; lisibles par qui consulte la demande.';
create index request_citizen_messages_request_idx
  on public.request_citizen_messages (request_id, created_at);

drop trigger if exists t01_request_citizen_messages_check_org on public.request_citizen_messages;
create trigger t01_request_citizen_messages_check_org
  before insert on public.request_citizen_messages
  for each row execute function public.satellite_check_request_org();

-- Une trace : le corps ne se réécrit pas, ne s'efface pas (la purge RGPD
-- passera par la cascade de la demande).
drop trigger if exists t02_request_citizen_messages_immutable on public.request_citizen_messages;
create trigger t02_request_citizen_messages_immutable
  before update on public.request_citizen_messages
  for each row execute function public.forbid_change();

alter table public.request_citizen_messages enable row level security;
revoke all on public.request_citizen_messages from anon;
revoke insert, update, delete on public.request_citizen_messages from authenticated;
grant select on public.request_citizen_messages to authenticated;

create policy request_citizen_messages_select on public.request_citizen_messages
  for select to authenticated
  using (public.can_consult_request(request_citizen_messages.request_id));
create policy request_citizen_messages_service on public.request_citizen_messages
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 2. Les pièces d'un message
--
-- Une colonne, comme `email_id` pour les pièces envoyées : une pièce jointe
-- EST une pièce de la demande, et tout l'existant s'applique (stockage, URL
-- signée, purge). Elle reste DANS l'échange : l'onglet Documents ne la montre
-- pas, la qualification ne la vise pas (même règle que `email_id`).
-- ----------------------------------------------------------------------------

alter table public.request_attachments
  add column citizen_message_id uuid references public.request_citizen_messages(id) on delete cascade;
create index request_attachments_citizen_message_idx
  on public.request_attachments (citizen_message_id) where citizen_message_id is not null;
comment on column public.request_attachments.citizen_message_id is
  'Pièce jointe par l''usager à un message (L4b). Exclusive de email_id.';
alter table public.request_attachments
  add constraint request_attachments_one_exchange check (email_id is null or citizen_message_id is null);

-- ----------------------------------------------------------------------------
-- 3. Le motif de notification
-- ----------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned','unassigned','status_changed','note_added',
                  'new_request_in_scope','mentioned','transferred_in',
                  'intervention_requested','intervention_completed','citizen_replied'));

alter table public.notification_preferences drop constraint if exists notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('*','assigned','unassigned','status_changed','note_added',
                  'new_request_in_scope','mentioned','transferred_in',
                  'intervention_requested','intervention_completed','citizen_replied'));

-- ----------------------------------------------------------------------------
-- 4. Enregistrer — une transaction, service_role seulement
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
  -- (`status_changed`) et la notification de l'assigné suivent par triggers.
  if v_req.status = 'en_attente' then
    update public.requests set status = 'en_instruction' where id = p_request_id;
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
      v_req.reference, v_req.subject, jsonb_build_object('pieces', v_n, 'status', v_req.status));
  else
    insert into public.notifications (organization_id, user_id, request_id, kind, actor_id,
                                      payload, in_app, email_status)
    select p_org, m.user_id, p_request_id, 'citizen_replied', null,
           jsonb_build_object('reference', v_req.reference, 'subject', v_req.subject,
                              'actor_name', null, 'pieces', v_n, 'status', v_req.status),
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
  'Enregistre un message de l''usager (L4b) : message, pièces consommées de la zone d''attente, retour en_attente → en_instruction, journal (message_usager_recu), notifications citizen_replied — en une transaction. Refuse une demande close (P0409). service_role uniquement.';
revoke execute on function public.record_citizen_message(uuid, uuid, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_citizen_message(uuid, uuid, uuid, text, uuid, text, jsonb) to service_role;
