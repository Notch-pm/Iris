-- ============================================================================
-- Notifications — troisième canal : le PUSH sur appareil (Web Push / VAPID).
--
-- Le PO veut qu'une notification in-app soit doublée d'une notification sur le
-- téléphone, application fermée comprise (2026-09-10). Trois principes :
--
-- 1. **Le push SUIT le canal in-app.** Aucun réglage par événement : ce qui
--    apparaît dans la cloche part sur les appareils inscrits. Le seul réglage
--    est PAR APPAREIL — un abonnement existe ou n'existe pas.
--
-- 2. **Un événement, une ligne, N canaux** (motif de `20260824110000`) : le
--    push s'ajoute en colonnes `push_*` sur `notifications`, en miroir des
--    colonnes `email_*`. Sa valeur initiale est décidée par un trigger BEFORE
--    INSERT, et non par chaque producteur : huit sites d'insertion (RPC
--    `push_notification`, fan-outs set-based, mentions, interventions) et une
--    seule règle — `pending` si la ligne est in-app ET que le destinataire a au
--    moins un appareil actif, `skipped` sinon.
--
-- 3. **L'envoi ne part jamais du déclencheur** : boîte d'envoi drainée sur cron
--    par l'edge function `notifications-push`, réclamation atomique, reprise
--    avec temporisation croissante, abandon franc au bout de 5 tentatives.
--
-- L'abonnement (`push_subscriptions`) est l'adresse d'un APPAREIL, pas d'un
-- compte : sur un poste partagé, le navigateur rend le même endpoint au
-- titulaire suivant. C'est pourquoi l'enregistrement passe par une RPC qui
-- REPREND la ligne (`on conflict (endpoint) do update set user_id = auth.uid()`)
-- — un `insert` client borné à `user_id = auth.uid()` ne le pourrait pas, et
-- une clé (user_id, endpoint) ferait recevoir à l'appareil les notifications
-- de l'ancien titulaire. Lecture, `last_seen_at` et suppression restent en
-- écriture directe sous RLS, comme `notification_preferences`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Abonnements : un par appareil (endpoint du service de push du navigateur)
-- ----------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  -- URL rendue par le navigateur (FCM, Mozilla, Apple…) : identifie l'appareil.
  endpoint        text not null unique,
  -- Clé publique ECDH et sel d'authentification de l'abonnement (RFC 8291).
  -- Publics par construction : ils servent à CHIFFRER vers l'appareil.
  p256dh          text not null,
  auth            text not null,
  -- Libellé d'appareil dérivé du User-Agent (« Android · Chrome »), pour
  -- l'affichage seulement.
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  -- Posé par le facteur quand le service de push répond 404/410 : l'appareil
  -- a retiré son abonnement (désinstallation, permission révoquée).
  disabled_at     timestamptz,
  disabled_reason text
);

comment on table public.push_subscriptions is
  'Abonnements Web Push, UN PAR APPAREIL. L''endpoint est l''adresse de l''appareil, pas un secret ; p256dh/auth sont la clé publique et le sel de chiffrement vers cet appareil. Enregistrement par la RPC register_push_subscription (reprise d''un endpoint par son nouveau titulaire) ; lecture, last_seen_at et suppression en direct sous RLS.';
comment on column public.push_subscriptions.disabled_at is
  'Désactivé par le facteur sur 404/410 du service de push (abonnement retiré côté appareil). Une ligne désactivée ne compte plus comme appareil actif ; un nouvel enregistrement la réactive.';

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id) where disabled_at is null;

alter table public.push_subscriptions enable row level security;

-- Ses lignes seulement. Pas de policy INSERT cliente : l'enregistrement passe
-- par la RPC, seule à pouvoir reprendre un endpoint (cf. en-tête).
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_service on public.push_subscriptions;
create policy push_subscriptions_service on public.push_subscriptions
  for all to service_role using (true) with check (true);

-- Enregistrement (ou reprise) d'un appareil par le compte connecté.
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'register_push_subscription : session absente' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 2048 then
    raise exception 'register_push_subscription : endpoint invalide' using errcode = '22023';
  end if;
  if coalesce(p_p256dh, '') = '' or length(p_p256dh) > 512
     or coalesce(p_auth, '') = '' or length(p_auth) > 512 then
    raise exception 'register_push_subscription : clés d''abonnement invalides' using errcode = '22023';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
     set user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         disabled_at = null,
         disabled_reason = null,
         last_seen_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.register_push_subscription(text, text, text, text) is
  'Enregistre l''abonnement push de CET appareil pour le compte connecté. Un endpoint déjà connu est REPRIS (nouveau titulaire sur un poste partagé) et réactivé. Seule porte d''écriture : la table n''a pas de policy INSERT cliente.';
revoke execute on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. État du canal push sur la notification (miroir des colonnes email_*)
-- ----------------------------------------------------------------------------

alter table public.notifications
  add column if not exists push_status text not null default 'skipped',
  add column if not exists push_attempts int not null default 0,
  add column if not exists push_attempted_at timestamptz,
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_next_attempt_at timestamptz,
  add column if not exists push_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_push_status_check') then
    alter table public.notifications add constraint notifications_push_status_check
      check (push_status in ('pending','sending','sent','skipped','failed'));
  end if;
end
$$;

comment on column public.notifications.push_status is
  'Boîte d''envoi push : pending (à pousser) · sending (réclamée par le facteur) · sent · skipped (in-app coupé, aucun appareil actif, ou lue avant l''envoi) · failed (abandon après 5 tentatives). Valeur initiale décidée par t10_notifications_push_queue, jamais par le producteur.';
comment on table public.notifications is
  'Un événement, une ligne, TROIS canaux : in_app (volet), email_* (boîte d''envoi e-mail), push_* (boîte d''envoi Web Push). La base est le seul producteur (triggers t40_* et RPC) ; aucune policy d''écriture cliente.';

create index if not exists notifications_push_queue_idx
  on public.notifications (push_next_attempt_at nulls first, created_at)
  where push_status in ('pending','sending');

-- ----------------------------------------------------------------------------
-- 3. Décision à l'insertion : une règle, tous les producteurs
-- ----------------------------------------------------------------------------

-- ⚠️ Un producteur qui poserait `push_status` explicitement serait écrasé :
-- c'est voulu, la règle vit ici et nulle part ailleurs.
create or replace function public.notifications_push_queue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.in_app
     and exists (select 1 from public.push_subscriptions s
                  where s.user_id = new.user_id and s.disabled_at is null) then
    new.push_status := 'pending';
  else
    new.push_status := 'skipped';
  end if;
  new.push_next_attempt_at := null;
  return new;
end;
$$;
revoke execute on function public.notifications_push_queue() from public, anon, authenticated;

drop trigger if exists t10_notifications_push_queue on public.notifications;
create trigger t10_notifications_push_queue
  before insert on public.notifications
  for each row execute function public.notifications_push_queue();

-- ----------------------------------------------------------------------------
-- 4. Boîte d'envoi : réclamation atomique, règlement, renoncement
-- ----------------------------------------------------------------------------

create or replace function public.notification_push_max_attempts()
returns int language sql immutable set search_path = '' as $$ select 5 $$;
revoke execute on function public.notification_push_max_attempts() from public, anon, authenticated;

-- Avant de réclamer, deux renoncements sans appel réseau :
--   · une ligne déjà LUE dans le volet ne mérite plus un push ;
--   · un destinataire sans appareil actif (désactivés depuis) n'en recevra pas.
-- Puis réclamation atomique (`for update skip locked`) avec reprise des lignes
-- 'sending' figées depuis 15 min, et les abonnements actifs du destinataire
-- agrégés en JSON — le facteur n'a rien d'autre à relire.
create or replace function public.claim_notification_pushes(p_limit int default 50)
returns table (
  notification_id   uuid,
  organization_id   uuid,
  organization_name text,
  kind              text,
  payload           jsonb,
  request_id        uuid,
  attempts          int,
  subscriptions     jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications n
     set push_status = 'skipped', push_error = 'lue avant envoi', push_next_attempt_at = null
   where n.push_status = 'pending' and n.read_at is not null;

  update public.notifications n
     set push_status = 'skipped', push_error = 'aucun appareil actif', push_next_attempt_at = null
   where n.push_status = 'pending'
     and not exists (select 1 from public.push_subscriptions s
                      where s.user_id = n.user_id and s.disabled_at is null);

  return query
  with due as (
    select n.id from public.notifications n
     where (n.push_status = 'pending'
            and (n.push_next_attempt_at is null or n.push_next_attempt_at <= now()))
        or (n.push_status = 'sending'
            and n.push_attempted_at is not null
            and n.push_attempted_at < now() - interval '15 minutes')
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  ),
  claimed as (
    update public.notifications n
       set push_status = 'sending',
           push_attempts = n.push_attempts + 1,
           push_attempted_at = now()
     where n.id in (select id from due)
    returning n.id, n.organization_id, n.kind, n.payload, n.request_id,
              n.user_id, n.push_attempts
  )
  select c.id, c.organization_id, o.name, c.kind, c.payload, c.request_id, c.push_attempts,
         coalesce((select jsonb_agg(jsonb_build_object(
                            'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                     from public.push_subscriptions s
                    where s.user_id = c.user_id and s.disabled_at is null), '[]'::jsonb)
    from claimed c
    join public.organizations o on o.id = c.organization_id;
end;
$$;
comment on function public.claim_notification_pushes(int) is
  'Réclame un lot de notifications à pousser et le marque ''sending'' atomiquement, avec les abonnements actifs du destinataire en JSON. Renonce d''abord aux lignes lues et à celles sans appareil. service_role uniquement.';
revoke execute on function public.claim_notification_pushes(int) from public, anon, authenticated;

create or replace function public.settle_notification_push(
  p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_attempts int;
begin
  if p_ok then
    update public.notifications
       set push_status = 'sent', push_sent_at = now(),
           push_next_attempt_at = null, push_error = null
     where id = p_id;
    return;
  end if;

  select push_attempts into v_attempts from public.notifications where id = p_id;
  if v_attempts is null then return; end if;

  if v_attempts >= public.notification_push_max_attempts() then
    update public.notifications
       set push_status = 'failed', push_error = left(coalesce(p_error, 'inconnue'), 500),
           push_next_attempt_at = null
     where id = p_id;
  else
    update public.notifications
       set push_status = 'pending', push_error = left(coalesce(p_error, 'inconnue'), 500),
           push_next_attempt_at = now() + (interval '1 minute' * power(2, v_attempts))
     where id = p_id;
  end if;
end;
$$;
comment on function public.settle_notification_push(uuid, boolean, text) is
  'Règle un push : succès (au moins un appareil servi) → ''sent'' ; échec → retour en file avec temporisation croissante, puis ''failed'' au-delà de 5 tentatives. service_role uniquement.';
revoke execute on function public.settle_notification_push(uuid, boolean, text) from public, anon, authenticated;

create or replace function public.skip_notification_push(p_id uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.notifications
     set push_status = 'skipped', push_error = left(coalesce(p_reason, ''), 500),
         push_next_attempt_at = null
   where id = p_id;
$$;
comment on function public.skip_notification_push(uuid, text) is
  'Renonce définitivement au push d''une notification. service_role uniquement.';
revoke execute on function public.skip_notification_push(uuid, text) from public, anon, authenticated;

-- Le service de push a répondu 404/410 : l'appareil n'écoute plus.
create or replace function public.disable_push_subscription(p_id uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.push_subscriptions
     set disabled_at = now(), disabled_reason = left(coalesce(p_reason, ''), 200)
   where id = p_id and disabled_at is null;
$$;
comment on function public.disable_push_subscription(uuid, text) is
  'Désactive un abonnement dont le service de push a signifié la disparition (404/410). service_role uniquement.';
revoke execute on function public.disable_push_subscription(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Cron — drainage de la file toutes les minutes (motif notifications-mailer).
-- Tant que la fonction n'est pas déployée, l'appel répond 404 : inoffensif.
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('notifications-push')
 where exists (select 1 from cron.job where jobname = 'notifications-push');

select cron.schedule(
  'notifications-push',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/notifications-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_iris'), '')
    ),
    body := '{}'::jsonb
  );
  $job$
);
