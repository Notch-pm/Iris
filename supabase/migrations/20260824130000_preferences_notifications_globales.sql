-- ============================================================================
-- Préférences de notification : GLOBALES au compte (décision PO 2026-08-24,
-- remplace le découpage par tenant posé le matin même).
--
-- Motif : « je ne veux pas de courriel pour les notes internes » est une
-- décision sur SOI, pas sur une organisation. Un agent rattaché à deux
-- collectivités n'a aucune envie de régler deux fois la même chose, ni de
-- découvrir qu'il reçoit encore des messages parce qu'il a oublié le second
-- tenant. La photo de profil suit déjà cette logique (`public.users`,
-- hors tenant) : les préférences la rejoignent.
--
-- Conséquence : la clé passe de (user_id, organization_id, kind) à
-- (user_id, kind), et `notification_channels_for` perd son paramètre
-- d'organisation. On ne GARDE PAS la colonne « au cas où » : un paramètre qui
-- ne sert à rien est un piège pour la prochaine lecture.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Repli des lignes existantes.
--
-- Un même (utilisateur, motif) a pu être réglé différemment selon le tenant.
-- On retient l'union (`bool_or`) : entre « recevoir » et « ne pas recevoir »,
-- on garde le canal ouvert — cohérent avec le *fail open* de tout le
-- mécanisme, et une préférence perdue doit se traduire par du bruit, jamais
-- par un silence.
-- ----------------------------------------------------------------------------

create temporary table _prefs_repli on commit drop as
select user_id, kind, bool_or(in_app) as in_app, bool_or(email) as email, max(updated_at) as updated_at
  from public.notification_preferences
 group by user_id, kind;

delete from public.notification_preferences;

-- ⚠️ Les policies posées le matin même référencent `organization_id`
-- (`is_org_member(organization_id)` sur l'écriture) : PostgreSQL refuse de
-- retirer une colonne dont dépend une policy. On les dépose d'abord, on les
-- repose en §3 dans leur nouvelle forme.
drop policy if exists notification_preferences_select on public.notification_preferences;
drop policy if exists notification_preferences_insert on public.notification_preferences;
drop policy if exists notification_preferences_update on public.notification_preferences;
drop policy if exists notification_preferences_delete on public.notification_preferences;
drop policy if exists notification_preferences_service on public.notification_preferences;

alter table public.notification_preferences
  drop constraint if exists notification_preferences_pkey;
alter table public.notification_preferences
  drop column if exists organization_id;
alter table public.notification_preferences
  add primary key (user_id, kind);

insert into public.notification_preferences (user_id, kind, in_app, email, updated_at)
select user_id, kind, in_app, email, updated_at from _prefs_repli;

comment on table public.notification_preferences is
  'Préférences de notification par (utilisateur, motif), GLOBALES à tous les tenants du compte. Ligne absente = tout activé (fail OPEN : une préférence manquante ne doit jamais faire taire une information). ''*'' porte le défaut du compte, une ligne de motif le surcharge.';

-- ----------------------------------------------------------------------------
-- 2. Résolveur — sans organisation.
-- ----------------------------------------------------------------------------

drop function if exists public.notification_channels_for(uuid, uuid, text);

create or replace function public.notification_channels_for(p_user_id uuid, p_kind text)
returns table (use_in_app boolean, use_email boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.notification_preferences%rowtype;
begin
  select * into v_row from public.notification_preferences p
   where p.user_id = p_user_id and p.kind = p_kind;
  if not found then
    select * into v_row from public.notification_preferences p
     where p.user_id = p_user_id and p.kind = '*';
  end if;
  if not found then
    use_in_app := true; use_email := true;           -- fail open
  else
    use_in_app := v_row.in_app; use_email := v_row.email;
  end if;
  return next;
end;
$$;
comment on function public.notification_channels_for(uuid, text) is
  'Canaux à servir pour (utilisateur, motif), tous tenants confondus : ligne du motif, sinon ligne ''*'', sinon tout activé (fail open). Unique porteuse de cette sémantique.';
revoke execute on function public.notification_channels_for(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Policies — l'appartenance à un tenant n'a plus de sens ici : une
--    préférence est un attribut du COMPTE, pas d'un rattachement.
-- ----------------------------------------------------------------------------

drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notification_preferences_insert on public.notification_preferences;
create policy notification_preferences_insert on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists notification_preferences_update on public.notification_preferences;
create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists notification_preferences_delete on public.notification_preferences;
create policy notification_preferences_delete on public.notification_preferences
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists notification_preferences_service on public.notification_preferences;
create policy notification_preferences_service on public.notification_preferences
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 4. Producteurs — mêmes fonctions, un argument de moins.
-- ----------------------------------------------------------------------------

create or replace function public.push_notification(
  p_user_id uuid, p_actor_id uuid, p_org_id uuid, p_request_id uuid,
  p_kind text, p_reference text, p_subject text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_in_app boolean;
  v_email  boolean;
begin
  if p_user_id is null or p_user_id is not distinct from p_actor_id then
    return;   -- pas de destinataire, ou l'acteur lui-même : rien à annoncer
  end if;

  select c.use_in_app, c.use_email into v_in_app, v_email
    from public.notification_channels_for(p_user_id, p_kind) c;
  if not v_in_app and not v_email then
    return;   -- tout coupé : ni ligne, ni e-mail
  end if;

  insert into public.notifications (organization_id, user_id, request_id, kind, actor_id,
                                    payload, in_app, email_status)
  values (p_org_id, p_user_id, p_request_id, p_kind, p_actor_id,
          jsonb_build_object(
            'reference', p_reference,
            'subject',   p_subject,
            'actor_name', public.user_display_name(p_actor_id)
          ) || coalesce(p_extra, '{}'::jsonb),
          v_in_app,
          case when v_email then 'pending' else 'skipped' end);
end;
$$;
revoke execute on function public.push_notification(uuid, uuid, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.requests_notify_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
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
     and public.can_process_request_for(
           m.user_id, new.organization_id, new.socle_organization_id, new.socle_procedure_id);
  return null;
end;
$$;
revoke execute on function public.requests_notify_insert() from public, anon, authenticated;
