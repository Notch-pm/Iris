-- ============================================================================
-- Notifications in-app (décision PO 2026-08-24) — cinq motifs, tous portés par
-- des triggers DEFINER : la base est le SEUL producteur, aucune écriture
-- cliente n'est possible (une notification n'est pas un geste d'utilisateur,
-- c'est une CONSÉQUENCE d'un geste, et un client ne doit pas pouvoir en
-- fabriquer pour autrui).
--
--   assigned              — une demande vient de m'être affectée
--   unassigned            — on m'a retiré une demande
--   status_changed        — le statut d'une demande qui m'est affectée a changé
--   note_added            — une note interne a été ajoutée sur une demande
--                           qui m'est affectée
--   new_request_in_scope  — une demande est entrée dans un couple (organisation,
--                           démarche) où je détiens le droit d'INSTRUCTION
--
-- Règle transverse : JAMAIS de notification pour son propre geste. L'acteur
-- est `auth.uid()`, NULL en contexte de service (ingestion Clara/partenaires,
-- automatismes). La comparaison `is [not] distinct from` porte la règle sans
-- cas particulier : destinataire = acteur → on se tait ; acteur NULL → la
-- comparaison est FAUSSE, donc la notification part, ce qui est exactement le
-- comportement voulu pour une demande ingérée (personne n'en est l'auteur).
--
-- Le payload est un INSTANTANÉ (référence, objet, statuts, nom de l'acteur) :
-- le volet se rend sans jointure, et une notification reste lisible même si le
-- périmètre de droits de son destinataire change ensuite. Le CORPS des notes
-- internes n'y figure pas — invariant « les notes internes ne quittent jamais
-- Iris » : on annonce l'existence de la note, on ne la recopie pas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table
-- ----------------------------------------------------------------------------

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,  -- destinataire
  request_id      uuid not null references public.requests(id) on delete cascade,
  kind            text not null check (kind in (
                    'assigned','unassigned','status_changed','note_added','new_request_in_scope')),
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  actor_id        uuid references public.users(id) on delete set null,  -- NULL = système / ingestion
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);

-- Listing du volet : « mes notifications, sur ce tenant, les plus récentes ».
create index if not exists notifications_user_idx
  on public.notifications (user_id, organization_id, created_at desc);
-- Pastille du compteur : index partiel, les non-lues sont une petite minorité.
create index if not exists notifications_unread_idx
  on public.notifications (user_id, organization_id)
  where read_at is null;
create index if not exists notifications_request_idx
  on public.notifications (request_id);

comment on table public.notifications is
  'Notifications in-app. Produites EXCLUSIVEMENT par les triggers DEFINER de requests / request_messages ; aucune écriture cliente. payload = instantané (référence, objet, statuts, acteur) pour un rendu sans jointure. Jamais le corps d''une note interne.';

-- ----------------------------------------------------------------------------
-- Helpers internes
-- ----------------------------------------------------------------------------

-- Nom affichable d'un acteur, figé dans le payload au moment du geste.
create or replace function public.user_display_name(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
           nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
           u.email)
    from public.users u where u.id = p_user_id;
$$;
comment on function public.user_display_name(uuid) is
  'Nom affichable d''un utilisateur. Interne : appelée par les triggers de notification pour figer l''acteur dans le payload.';
revoke execute on function public.user_display_name(uuid) from public, anon, authenticated;

-- Droit d'INSTRUCTION d'un utilisateur tiers sur le couple porté par une
-- demande. Même MOTEUR que partout ailleurs (permission_pairs_of, ADR-04) —
-- ce n'est pas une seconde implémentation de la sémantique « par couple »,
-- seulement une enveloppe SANS la garde anti-sondage de
-- user_has_request_right : cette garde protège un appel RPC CLIENT, elle n'a
-- pas de sens dans un trigger (et elle ferait taire les notifications quand
-- l'auteur du geste n'est pas membre du tenant — cas de l'administrateur de
-- plateforme). Aucune EXECUTE cliente, donc aucune surface de sondage.
create or replace function public.can_process_request_for(
  p_user_id uuid, p_org_id uuid, p_socle_org_id uuid, p_socle_procedure_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_platform_admin from public.users u where u.id = p_user_id), false)
      or exists (
        select 1 from public.permission_pairs_of(
                 array(select a.profile_id
                         from public.permission_profile_assignments a
                         join public.permission_profiles p on p.id = a.profile_id
                        where a.user_id = p_user_id
                          and a.organization_id = p_org_id
                          and p.status = 'active'),
                 'instruction', p_org_id) s
         where s.socle_org_id = public.request_scope_org(p_org_id, p_socle_org_id)
           and s.socle_procedure_id = coalesce(p_socle_procedure_id, public.nil_procedure())
      );
$$;
comment on function public.can_process_request_for(uuid, uuid, uuid, uuid) is
  'Droit d''instruction d''un utilisateur sur le couple d''une demande, MÊME moteur (permission_pairs_of) sans la garde anti-sondage de user_has_request_right. Interne : réservée aux triggers de notification, aucune EXECUTE cliente.';
revoke execute on function public.can_process_request_for(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

-- Insertion unitaire — centralise la règle « jamais pour son propre geste »
-- et l'instantané commun (référence, objet, acteur).
create or replace function public.push_notification(
  p_user_id uuid, p_actor_id uuid, p_org_id uuid, p_request_id uuid,
  p_kind text, p_reference text, p_subject text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_user_id is not distinct from p_actor_id then
    return;   -- pas de destinataire, ou l'acteur lui-même : rien à annoncer
  end if;
  insert into public.notifications (organization_id, user_id, request_id, kind, actor_id, payload)
  values (p_org_id, p_user_id, p_request_id, p_kind, p_actor_id,
          jsonb_build_object(
            'reference', p_reference,
            'subject',   p_subject,
            'actor_name', public.user_display_name(p_actor_id)
          ) || coalesce(p_extra, '{}'::jsonb));
end;
$$;
comment on function public.push_notification(uuid, uuid, uuid, uuid, text, text, text, jsonb) is
  'Insertion unitaire d''une notification. Porte la règle « jamais pour son propre geste » (p_user_id = p_actor_id → no-op). Interne : aucune EXECUTE cliente.';
revoke execute on function public.push_notification(uuid, uuid, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Triggers — requests
-- ----------------------------------------------------------------------------

-- t40 (après t30, le journal request_events : l'ordre alphabétique des noms de
-- triggers fait foi).
create or replace function public.requests_notify_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  -- 1. Affectation à la création.
  perform public.push_notification(
    new.assigned_to, v_actor, new.organization_id, new.id, 'assigned',
    new.reference, new.subject, jsonb_build_object('status', new.status));

  -- 2. Entrée dans le périmètre d'instruction des autres membres du tenant.
  --    L'affectataire est exclu : il vient de recevoir « assigned », qui dit
  --    déjà tout — une seule notification par geste et par personne.
  insert into public.notifications (organization_id, user_id, request_id, kind, actor_id, payload)
  select new.organization_id, m.user_id, new.id, 'new_request_in_scope', v_actor,
         jsonb_build_object(
           'reference', new.reference, 'subject', new.subject,
           'actor_name', public.user_display_name(v_actor),
           'status', new.status, 'source', new.source,
           'procedure', new.socle_procedure_label,
           'destinataire', new.socle_organization_label)
    from public.organization_members m
   where m.organization_id = new.organization_id
     and m.user_id is distinct from v_actor
     and m.user_id is distinct from new.assigned_to
     and public.can_process_request_for(
           m.user_id, new.organization_id, new.socle_organization_id, new.socle_procedure_id);
  return null;
end;
$$;
revoke execute on function public.requests_notify_insert() from public, anon, authenticated;

drop trigger if exists t40_requests_notify_insert on public.requests;
create trigger t40_requests_notify_insert
  after insert on public.requests
  for each row execute function public.requests_notify_insert();

create or replace function public.requests_notify_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.assigned_to is distinct from old.assigned_to then
    -- Affectation modifiée : le nouvel affectataire reçoit « assigned » (dont
    -- le payload porte le statut courant), l'ancien « unassigned ». Quand le
    -- statut change dans le MÊME UPDATE (ex. « passage en instruction » qui
    -- exige un affectataire), on n'ajoute pas de « status_changed » par-dessus :
    -- un geste, une notification.
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

drop trigger if exists t40_requests_notify_update on public.requests;
create trigger t40_requests_notify_update
  after update on public.requests
  for each row execute function public.requests_notify_update();

-- ----------------------------------------------------------------------------
-- Trigger — request_messages (note interne)
-- ----------------------------------------------------------------------------

create or replace function public.request_messages_notify_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := coalesce(new.author_id, auth.uid());
  v_req   record;
begin
  select r.assigned_to, r.reference, r.subject, r.status
    into v_req
    from public.requests r where r.id = new.request_id;
  if not found then
    return null;
  end if;
  perform public.push_notification(
    v_req.assigned_to, v_actor, new.organization_id, new.request_id, 'note_added',
    v_req.reference, v_req.subject, jsonb_build_object('status', v_req.status));
  return null;
end;
$$;
revoke execute on function public.request_messages_notify_insert() from public, anon, authenticated;

drop trigger if exists t40_request_messages_notify_insert on public.request_messages;
create trigger t40_request_messages_notify_insert
  after insert on public.request_messages
  for each row execute function public.request_messages_notify_insert();

-- ----------------------------------------------------------------------------
-- RLS — lecture de SES notifications, rien d'autre.
-- ----------------------------------------------------------------------------

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- Aucune policy INSERT/UPDATE/DELETE cliente : les triggers DEFINER sont les
-- seuls producteurs, les RPC ci-dessous la seule porte pour « marquer comme lu ».

drop policy if exists notifications_service on public.notifications;
create policy notifications_service on public.notifications
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- RPC — accusé de lecture (jamais une écriture cliente directe : seul read_at
-- doit pouvoir bouger, et seulement sur SES propres lignes).
-- ----------------------------------------------------------------------------

create or replace function public.mark_notifications_read(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  update public.notifications
     set read_at = now()
   where id = any(coalesce(p_ids, '{}'::uuid[]))
     and user_id = auth.uid()
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.mark_notifications_read(uuid[]) is
  'Marque comme lues des notifications de l''utilisateur COURANT (les autres sont ignorées silencieusement). Unique porte d''écriture cliente sur notifications.';
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant  execute on function public.mark_notifications_read(uuid[]) to authenticated;

create or replace function public.mark_all_notifications_read(p_org_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_org_id is null or organization_id = p_org_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.mark_all_notifications_read(uuid) is
  'Marque comme lues toutes les notifications non lues de l''utilisateur courant, bornées à un tenant (NULL = tous).';
revoke execute on function public.mark_all_notifications_read(uuid) from public, anon;
grant  execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Temps réel — le navigateur s'abonne aux INSERT sur SES lignes. Realtime
-- ré-applique le RLS ci-dessus par abonné : un client ne peut pas s'abonner
-- aux notifications d'autrui.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;
