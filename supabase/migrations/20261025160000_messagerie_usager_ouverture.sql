-- ============================================================================
-- La messagerie de l'usager est FERMÉE par défaut (décision PO du 2026-10-25).
--
-- Jusqu'ici, toute demande non close recevait les messages de son usager
-- (`record_citizen_message`, lot L4b) : rien n'empêchait la relance continue.
-- Désormais l'usager ne peut écrire que lorsqu'on attend quelque chose de lui.
--
--   · OUVERTURE — trois portes, toutes côté serveur :
--       - une pièce déclarée NON CONFORME (`qualify_request_attachment`) :
--         l'agent demande un document, l'usager doit pouvoir le renvoyer ;
--       - un message de l'agent envoyé avec « Attendre une réponse de
--         l'usager » (`send-request-email`, mode libre) ;
--       - le bouton « Ouvrir la messagerie » de l'onglet Échanges
--         (`set_citizen_replies_open`, droit d'instruction).
--   · FERMETURE :
--       - à la RÉPONSE de l'usager : une ouverture = une réponse (jusqu'à cinq
--         pièces). L'agent rouvre s'il lui faut autre chose ;
--       - par l'agent (même bouton) ;
--       - à la clôture de la demande (trigger t42) — une réouverture de la
--         demande ne rouvre PAS la messagerie.
--   · UNE TABLE À PART, une ligne par demande, ABSENTE = FERMÉE : rien ne
--     touche `requests` (ni sa garde d'écriture, ni `updated_at`, ni les
--     triggers de statistiques et de notification). Aucune écriture cliente :
--     les RPC ci-dessous sont les seules portes.
--   · REPRISE : les demandes « En attente d'information » au déploiement
--     restent ouvertes (une réponse y est attendue) ; toutes les autres se
--     ferment.
--
-- Avant les CREATE OR REPLACE, les définitions live de
-- `qualify_request_attachment` et `record_citizen_message` ont été comparées
-- aux miroirs (20260828100000 et 20261024100000 : identiques).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. L'état de la messagerie
-- ----------------------------------------------------------------------------

create table public.request_citizen_reply_state (
  request_id      uuid primary key references public.requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  is_open         boolean not null,
  opened_at       timestamptz,
  -- NULL : ouverture sans agent (reprise au déploiement).
  opened_by       uuid,
  opened_reason   text check (opened_reason in ('non_conformite', 'message', 'agent', 'reprise')),
  closed_at       timestamptz,
  -- NULL : fermeture sans agent (réponse de l'usager, clôture de la demande).
  closed_by       uuid,
  closed_reason   text check (closed_reason in ('reponse_usager', 'agent', 'demande_close')),
  constraint request_citizen_reply_state_open_reason
    check (not is_open or opened_reason is not null)
);
comment on table public.request_citizen_reply_state is
  'Messagerie de l''usager sur SA demande : ouverte (l''usager peut écrire une fois) ou fermée. Absence de ligne = fermée. Écrite par set_citizen_replies seulement (RPC et triggers) ; lisible par qui consulte la demande.';

drop trigger if exists t01_request_citizen_reply_state_check_org on public.request_citizen_reply_state;
create trigger t01_request_citizen_reply_state_check_org
  before insert on public.request_citizen_reply_state
  for each row execute function public.satellite_check_request_org();

alter table public.request_citizen_reply_state enable row level security;
revoke all on public.request_citizen_reply_state from anon;
revoke insert, update, delete on public.request_citizen_reply_state from authenticated;
grant select on public.request_citizen_reply_state to authenticated;

create policy request_citizen_reply_state_select on public.request_citizen_reply_state
  for select to authenticated
  using (public.can_consult_request(request_citizen_reply_state.request_id));
create policy request_citizen_reply_state_service on public.request_citizen_reply_state
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 2. La porte interne : ouvrir ou fermer, journaliser
--
-- Rend vrai quand l'état a CHANGÉ (ouvrir une messagerie ouverte ne fait rien,
-- et ne journalise rien). Journal : chaque ouverture, et la fermeture par un
-- agent — la réponse de l'usager a déjà son événement (`message_usager_recu`),
-- la clôture le sien (`status_changed`).
-- ----------------------------------------------------------------------------

create or replace function public.set_citizen_replies(
  p_request_id uuid,
  p_open       boolean,
  p_actor      uuid,
  p_reason     text
) returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare
  v_org uuid;
  v_was boolean;
begin
  select r.organization_id into v_org from public.requests r where r.id = p_request_id;
  if v_org is null then
    raise exception 'Messagerie : demande introuvable.';
  end if;
  select s.is_open into v_was from public.request_citizen_reply_state s
   where s.request_id = p_request_id for update;
  if coalesce(v_was, false) = p_open then
    return false;
  end if;

  if p_open then
    insert into public.request_citizen_reply_state (
      request_id, organization_id, is_open, opened_at, opened_by, opened_reason)
    values (p_request_id, v_org, true, now(), p_actor, p_reason)
    on conflict (request_id) do update
      set is_open = true, opened_at = now(), opened_by = p_actor, opened_reason = p_reason,
          closed_at = null, closed_by = null, closed_reason = null;
  else
    update public.request_citizen_reply_state
       set is_open = false, closed_at = now(), closed_by = p_actor, closed_reason = p_reason
     where request_id = p_request_id;
  end if;

  if p_open or p_reason = 'agent' then
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (v_org, p_request_id,
            case when p_open then 'messagerie_usager_ouverte' else 'messagerie_usager_fermee' end,
            jsonb_build_object('motif', p_reason),
            p_actor);
  end if;
  return true;
end;
$fn$;
comment on function public.set_citizen_replies(uuid, boolean, uuid, text) is
  'Ouvre ou ferme la messagerie de l''usager d''une demande (porte interne : aucun contrôle de droit — les appelants le font). Rend vrai si l''état a changé. Journalise messagerie_usager_ouverte (toute ouverture) et messagerie_usager_fermee (fermeture par un agent). service_role uniquement.';
revoke execute on function public.set_citizen_replies(uuid, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_citizen_replies(uuid, boolean, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 3. Le geste de l'agent : « Ouvrir / Fermer la messagerie »
-- ----------------------------------------------------------------------------

create or replace function public.set_citizen_replies_open(
  p_request_id uuid,
  p_open       boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_req     public.requests%rowtype;
  v_uid     uuid := auth.uid();
  v_changed boolean;
begin
  if v_uid is null then
    raise exception 'Messagerie : authentification requise.';
  end if;
  if p_open is null then
    raise exception 'Messagerie : ouvrir ou fermer, il faut choisir.';
  end if;
  select * into v_req from public.requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'Messagerie : demande introuvable.';
  end if;

  -- Piège DEFINER (cf. qualify_request_attachment) : le droit d'INSTRUCTION est
  -- vérifié ICI, jamais via is_service_context().
  if not (public.is_platform_admin() or public.user_has_request_right(
            v_uid, v_req.organization_id, v_req.socle_organization_id,
            v_req.socle_procedure_id, 'instruction')) then
    raise exception 'Ouvrir ou fermer la messagerie de l''usager exige le droit d''instruction sur cette démarche pour ce service.';
  end if;
  if p_open and v_req.status in ('resolue_positive', 'resolue_negative', 'annulee', 'archivee') then
    raise exception 'Messagerie : la demande est close, elle ne reçoit plus de message.' using errcode = 'P0409';
  end if;

  v_changed := public.set_citizen_replies(p_request_id, p_open, v_uid, 'agent');
  return jsonb_build_object('request_id', p_request_id, 'open', p_open, 'changed', v_changed);
end;
$fn$;
comment on function public.set_citizen_replies_open(uuid, boolean) is
  'Ouvre ou ferme, par un geste d''agent, la messagerie de l''usager d''une demande. Exige le droit d''instruction, vérifié ICI. Une demande close ne s''ouvre pas (P0409).';
revoke execute on function public.set_citizen_replies_open(uuid, boolean) from public, anon;
grant execute on function public.set_citizen_replies_open(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. La clôture de la demande ferme la messagerie (t42)
-- ----------------------------------------------------------------------------

create or replace function public.requests_close_citizen_replies()
returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status in ('resolue_positive', 'resolue_negative', 'annulee', 'archivee')
     and old.status not in ('resolue_positive', 'resolue_negative', 'annulee', 'archivee') then
    perform public.set_citizen_replies(new.id, false, null, 'demande_close');
  end if;
  return null;
end;
$fn$;
revoke execute on function public.requests_close_citizen_replies() from public, anon, authenticated;

drop trigger if exists t42_requests_close_citizen_replies on public.requests;
create trigger t42_requests_close_citizen_replies
  after update of status on public.requests
  for each row execute function public.requests_close_citizen_replies();

-- ----------------------------------------------------------------------------
-- 5. Une pièce non conforme ouvre la messagerie
--    (définition live = miroir 20260828100000, plus l'ouverture)
-- ----------------------------------------------------------------------------

create or replace function public.qualify_request_attachment(
  p_attachment_id uuid,
  p_compliance    text,
  p_motif         text default null,
  p_note          text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_att    public.request_attachments%rowtype;
  v_req    public.requests%rowtype;
  v_uid    uuid := auth.uid();
  v_motif  text := nullif(btrim(coalesce(p_motif, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_waited boolean := false;
  v_opened boolean := false;
begin
  if v_uid is null then
    raise exception 'Qualification : authentification requise.';
  end if;
  if p_compliance not in ('conforme', 'non_conforme') then
    raise exception 'Qualification : verdict attendu « conforme » ou « non_conforme ».';
  end if;

  select * into v_att from public.request_attachments a where a.id = p_attachment_id;
  if not found then
    raise exception 'Qualification : pièce introuvable.';
  end if;
  if v_att.email_id is not null then
    raise exception 'Qualification : cette pièce est jointe à un échange sortant, pas déposée par l''usager.';
  end if;

  select * into v_req from public.requests r where r.id = v_att.request_id;
  if not found then
    raise exception 'Qualification : demande introuvable.';
  end if;
  if v_req.status in ('annulee', 'resolue_positive', 'resolue_negative', 'archivee') then
    raise exception 'Qualification : la demande est close (%), ses pièces ne se requalifient plus.', v_req.status;
  end if;

  if not (public.is_platform_admin() or public.user_has_request_right(
            v_uid, v_req.organization_id, v_req.socle_organization_id,
            v_req.socle_procedure_id, 'instruction')) then
    raise exception 'Qualifier une pièce exige le droit d''instruction sur cette démarche pour ce service.';
  end if;

  if p_compliance = 'non_conforme' then
    if v_motif is null then
      raise exception 'Qualification : un motif de non-conformité est obligatoire.';
    end if;
    if v_motif not in ('nom_inattendu', 'illisible', 'format_non_pris_en_charge',
                       'incomplete', 'non_a_jour') then
      raise exception 'Qualification : motif de non-conformité inconnu (%).', v_motif;
    end if;
  else
    v_motif := null;   -- une pièce conforme n'a pas de motif ; la précision, elle, reste.
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'Qualification : la précision ne peut pas dépasser 500 caractères.';
  end if;

  update public.request_attachments
     set compliance       = p_compliance,
         compliance_motif = v_motif,
         compliance_note  = v_note,
         compliance_by    = v_uid,
         compliance_at    = now()
   where id = p_attachment_id;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (v_req.organization_id, v_req.id, 'piece_qualifiee',
          jsonb_build_object(
            'attachment_id', v_att.id,
            'file_name',     v_att.file_name,
            'form_field_key', v_att.form_field_key,
            'compliance',    p_compliance,
            'motif',         v_motif),
          v_uid);

  -- Une pièce non conforme met la demande en attente d'information. Depuis
  -- « À traiter », la matrice des transitions l'interdit (a_traiter → en_attente
  -- n'existe pas) : le statut ne bouge pas, la prise en charge reste le geste
  -- attendu. On le DIT à l'appelant plutôt que de le deviner à l'écran.
  if p_compliance = 'non_conforme' and v_req.status = 'en_instruction' then
    update public.requests set status = 'en_attente' where id = v_req.id;
    v_waited := true;
  end if;

  -- L'agent attend une autre pièce : l'usager doit pouvoir la renvoyer en
  -- ligne (décision PO 2026-10-25), quel que soit le statut.
  if p_compliance = 'non_conforme' then
    v_opened := public.set_citizen_replies(v_req.id, true, v_uid, 'non_conformite');
  end if;

  return jsonb_build_object(
    'attachment_id', v_att.id,
    'request_id',    v_req.id,
    'compliance',    p_compliance,
    'motif',         v_motif,
    'status',        case when v_waited then 'en_attente' else v_req.status end,
    'status_changed', v_waited,
    'replies_opened', v_opened);
end;
$$;
revoke execute on function public.qualify_request_attachment(uuid, text, text, text)
  from public, anon;
grant execute on function public.qualify_request_attachment(uuid, text, text, text)
  to authenticated;
comment on function public.qualify_request_attachment(uuid, text, text, text) is
  'Unique porte d''écriture de la qualification d''une pièce. Exige le droit d''instruction (vérifié ICI : le contournement is_service_context() est inévitable dans un DEFINER). Journalise ''piece_qualifiee'', place la demande en attente d''information si la pièce est non conforme et la demande en instruction, et ouvre alors la messagerie de l''usager (replies_opened).';

-- ----------------------------------------------------------------------------
-- 6. L'usager ne répond que messagerie ouverte, et sa réponse la referme
--    (définition live = miroir 20261024100000, plus la garde et la fermeture)
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
  -- Décision PO 2026-10-25 : messagerie fermée par défaut.
  if not coalesce((select s.is_open from public.request_citizen_reply_state s
                    where s.request_id = p_request_id), false) then
    raise exception 'Messagerie fermée : cette demande n''attend pas de réponse.' using errcode = 'P0423';
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

  -- Une ouverture = une réponse : l'agent rouvre s'il lui faut autre chose.
  perform public.set_citizen_replies(p_request_id, false, null, 'reponse_usager');

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
  'Enregistre un message de l''usager (L4b) : refuse une demande close (P0409) et une messagerie fermée (P0423) ; message, pièces consommées de la zone d''attente, fermeture de la messagerie (une ouverture = une réponse), retour en_attente → en_instruction (sans notification de statut : citizen_replied porte reprise), journal (message_usager_recu), notifications citizen_replied — en une transaction. service_role uniquement.';
revoke execute on function public.record_citizen_message(uuid, uuid, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_citizen_message(uuid, uuid, uuid, text, uuid, text, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Reprise : une réponse est attendue des demandes en attente d'information
-- ----------------------------------------------------------------------------

insert into public.request_citizen_reply_state (request_id, organization_id, is_open, opened_at, opened_reason)
select r.id, r.organization_id, true, now(), 'reprise'
  from public.requests r
 where r.status = 'en_attente'
on conflict (request_id) do nothing;
