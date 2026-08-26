-- ============================================================================
-- Mentions dans les notes internes (décision PO 2026-08-24).
--
-- ENCODAGE : la mention vit DANS le corps de la note, `@[Nom affiché](uuid)`.
-- La note reste ainsi auto-portante — la base valide et notifie à partir du
-- seul corps, sans table satellite à tenir synchronisée — et le nom figé suit
-- la philosophie d'instantané du projet. Le motif est le jumeau exact de celui
-- de `src/features/requests/instruction/mentions.ts`.
--
-- RÈGLE : on ne mentionne QUE quelqu'un qui peut CONSULTER la demande. C'est
-- une garde SERVEUR (trigger t03), pas une politesse de l'interface : la liste
-- proposée à l'écran (`mentionable_users`) n'en est que le reflet.
--
-- ⚠️ Le nom figé dans le jeton n'est PAS de confiance — rien n'empêche
-- d'écrire `@[Le Maire](uuid-de-quelqu-un-d-autre)` à la main. L'écran affiche
-- donc toujours le nom VIVANT de l'annuaire, le jeton ne servant que de repli.
-- Normaliser ce nom côté base coûterait une réécriture de chaîne dans un
-- trigger pour un gain nul : traiter le problème à l'affichage suffit.
-- ============================================================================

-- ---------------------------------------------------------------- helpers --

-- Enveloppe GÉNÉRIQUE du moteur de droits pour un utilisateur TIERS, sans la
-- garde anti-sondage de `user_has_request_right` (qui protège un appel RPC
-- client et n'a aucun sens dans un trigger). Remplace `can_process_request_for`,
-- dont elle est la version paramétrée par droit : une seule enveloppe plutôt
-- que deux quasi-identiques.
create or replace function public.request_right_for(
  p_user_id uuid, p_org_id uuid, p_socle_org_id uuid,
  p_socle_procedure_id uuid, p_right text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select u.is_platform_admin from public.users u where u.id = p_user_id), false)
      or exists (
        select 1 from public.permission_pairs_of(
                 array(select a.profile_id
                         from public.permission_profile_assignments a
                         join public.permission_profiles p on p.id = a.profile_id
                        where a.user_id = p_user_id
                          and a.organization_id = p_org_id
                          and p.status = 'active'),
                 p_right, p_org_id) s
         where s.socle_org_id = public.request_scope_org(p_org_id, p_socle_org_id)
           and s.socle_procedure_id = coalesce(p_socle_procedure_id, public.nil_procedure())
      );
$fn$;
comment on function public.request_right_for(uuid, uuid, uuid, uuid, text) is
  'Droit d''un utilisateur TIERS sur le couple d''une demande, MÊME moteur (permission_pairs_of) sans la garde anti-sondage de user_has_request_right. Interne : réservée aux triggers, aucune EXECUTE cliente.';
revoke execute on function public.request_right_for(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- IMMUTABLE : le motif n'accepte que des UUID bien formés, rien de douteux
-- n'en sort.
create or replace function public.message_mentions(p_body text)
returns uuid[] language sql immutable set search_path = '' as $fn$
  select coalesce(array_agg(distinct x.id), '{}'::uuid[])
    from (
      select (m[1])::uuid as id
        from regexp_matches(
               coalesce(p_body, ''),
               '@\[[^\]]*\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)',
               'g') m
    ) x;
$fn$;
comment on function public.message_mentions(text) is
  'UUID mentionnés dans le corps d''une note (@[Nom](uuid)), dédoublonnés. Interne.';
revoke execute on function public.message_mentions(text) from public, anon, authenticated;

-- ------------------------------------------------------- garde de mention --

create or replace function public.request_messages_guard_mentions()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_ids  uuid[] := public.message_mentions(new.body);
  v_id   uuid;
  v_org  uuid; v_dest uuid; v_proc uuid;
begin
  if array_length(v_ids, 1) is null then
    return new;
  end if;

  select r.organization_id, r.socle_organization_id, r.socle_procedure_id
    into v_org, v_dest, v_proc
    from public.requests r where r.id = new.request_id;
  if not found then
    raise exception 'Demande introuvable.';
  end if;

  foreach v_id in array v_ids loop
    if not exists (select 1 from public.organization_members m
                    where m.organization_id = v_org and m.user_id = v_id) then
      raise exception 'Mention impossible : cet utilisateur n''appartient pas à cette collectivité.';
    end if;
    if not public.request_right_for(v_id, v_org, v_dest, v_proc, 'consultation') then
      raise exception 'Mention impossible : cet utilisateur ne peut pas consulter cette demande.';
    end if;
  end loop;
  return new;
end;
$fn$;
revoke execute on function public.request_messages_guard_mentions() from public, anon, authenticated;

drop trigger if exists t03_request_messages_guard_mentions on public.request_messages;
create trigger t03_request_messages_guard_mentions
  before insert or update on public.request_messages
  for each row execute function public.request_messages_guard_mentions();

-- ---------------------------------------------- nouveau motif « mentioned »

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned','unassigned','status_changed','note_added',
                  'new_request_in_scope','mentioned'));

alter table public.notification_preferences drop constraint if exists notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('*','assigned','unassigned','status_changed','note_added',
                  'new_request_in_scope','mentioned'));

-- Une mention PRIME sur « une note a été ajoutée » : la personne citée reçoit
-- « mentioned », et pas en plus « note_added » — un geste, une notification par
-- personne (règle déjà tenue pour l'affectation).
create or replace function public.request_messages_notify_insert()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_actor uuid := coalesce(new.author_id, auth.uid());
  v_req   record;
  v_ids   uuid[] := public.message_mentions(new.body);
  v_id    uuid;
begin
  select r.assigned_to, r.reference, r.subject, r.status
    into v_req
    from public.requests r where r.id = new.request_id;
  if not found then
    return null;
  end if;

  if array_length(v_ids, 1) is not null then
    foreach v_id in array v_ids loop
      perform public.push_notification(
        v_id, v_actor, new.organization_id, new.request_id, 'mentioned',
        v_req.reference, v_req.subject, jsonb_build_object('status', v_req.status));
    end loop;
  end if;

  if v_req.assigned_to is null
     or not (v_req.assigned_to = any(coalesce(v_ids, '{}'::uuid[]))) then
    perform public.push_notification(
      v_req.assigned_to, v_actor, new.organization_id, new.request_id, 'note_added',
      v_req.reference, v_req.subject, jsonb_build_object('status', v_req.status));
  end if;
  return null;
end;
$fn$;
revoke execute on function public.request_messages_notify_insert() from public, anon, authenticated;

-- ----------------------------------------- liste proposée par l'interface --

create or replace function public.mentionable_users(p_request_id uuid)
returns table (user_id uuid, display_name text, email text)
language plpgsql stable security definer set search_path = '' as $fn$
declare v_org uuid; v_dest uuid; v_proc uuid;
begin
  if not public.can_read_request(p_request_id) then
    raise exception 'Demande introuvable.';
  end if;
  select r.organization_id, r.socle_organization_id, r.socle_procedure_id
    into v_org, v_dest, v_proc
    from public.requests r where r.id = p_request_id;

  return query
    select m.user_id, public.user_display_name(u.id), u.email
      from public.organization_members m
      join public.users u on u.id = m.user_id
     where m.organization_id = v_org
       and public.request_right_for(m.user_id, v_org, v_dest, v_proc, 'consultation')
     order by 2;
end;
$fn$;
comment on function public.mentionable_users(uuid) is
  'Membres du tenant pouvant CONSULTER la demande : alimente le sélecteur de mentions. Reflet — la garde t03_request_messages_guard_mentions reste l''autorité.';
revoke execute on function public.mentionable_users(uuid) from public, anon;
grant  execute on function public.mentionable_users(uuid) to authenticated;

-- ------------------------ bascule du fan-out sur l'enveloppe générique -----

create or replace function public.requests_notify_insert()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_actor uuid := auth.uid();
begin
  perform public.push_notification(
    new.assigned_to, v_actor, new.organization_id, new.id, 'assigned',
    new.reference, new.subject, jsonb_build_object('status', new.status));

  insert into public.notifications (organization_id, user_id, request_id, kind, actor_id,
                                    payload, in_app, email_status)
  select new.organization_id, m.user_id, new.id, 'new_request_in_scope', v_actor,
         jsonb_build_object(
           'reference', new.reference, 'subject', new.subject,
           'actor_name', public.user_display_name(v_actor),
           'status', new.status, 'source', new.source,
           'procedure', new.socle_procedure_label,
           'destinataire', new.socle_organization_label),
         ch.use_in_app,
         case when ch.use_email then 'pending' else 'skipped' end
    from public.organization_members m
    cross join lateral public.notification_channels_for(m.user_id, 'new_request_in_scope') ch
   where m.organization_id = new.organization_id
     and m.user_id is distinct from v_actor
     and m.user_id is distinct from new.assigned_to
     and (ch.use_in_app or ch.use_email)
     and public.request_right_for(
           m.user_id, new.organization_id, new.socle_organization_id,
           new.socle_procedure_id, 'instruction');
  return null;
end;
$fn$;
revoke execute on function public.requests_notify_insert() from public, anon, authenticated;

drop function if exists public.can_process_request_for(uuid, uuid, uuid, uuid);
