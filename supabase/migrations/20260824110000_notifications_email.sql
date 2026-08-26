-- ============================================================================
-- Notifications — doublage par e-mail + modèle de préférences par canal.
--
-- DEUX principes, qui expliquent toute la migration :
--
-- 1. **Un événement, une ligne, N canaux.** On ne duplique pas la ligne par
--    canal : `notifications` porte l'état de CHAQUE canal (`in_app`,
--    `email_status`…). La règle « un geste, une notification par personne »
--    reste donc vraie telle quelle, et un futur canal (SMS, push) s'ajoute en
--    colonnes sans toucher aux déclencheurs ni au volet.
--
-- 2. **L'envoi ne part jamais du déclencheur.** Un appel HTTP dans une
--    transaction métier la fait traîner et la fait échouer avec le relais
--    SMTP : la ligne est une BOÎTE D'ENVOI (`email_status = 'pending'`) que
--    draine l'edge function `notifications-mailer` sur cron — réclamation
--    atomique (`for update skip locked`), reprise avec temporisation
--    croissante, abandon franc au bout de 5 tentatives. Même motif que
--    `integration_deliveries`.
--
-- Préférences (chantier UI à venir, modèle posé ici) : `notification_preferences`
-- + `notification_channels_for()`. **Fail OPEN** — l'absence de préférence
-- notifie sur tous les canaux. C'est l'inverse du modèle de droits (fail
-- closed) et c'est délibéré : un droit manquant doit fermer, une préférence
-- manquante ne doit pas faire taire une information.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. État par canal sur la notification
-- ----------------------------------------------------------------------------

alter table public.notifications
  -- false = la ligne n'existe que pour porter l'e-mail (in-app coupé par
  -- préférence). Le volet filtre dessus ; le RLS reste inchangé.
  add column if not exists in_app boolean not null default true,
  add column if not exists email_status text not null default 'pending',
  add column if not exists email_attempts int not null default 0,
  add column if not exists email_attempted_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_next_attempt_at timestamptz,
  add column if not exists email_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_email_status_check') then
    alter table public.notifications add constraint notifications_email_status_check
      check (email_status in ('pending','sending','sent','skipped','failed'));
  end if;
end
$$;

comment on column public.notifications.in_app is
  'false = notification muette dans le volet, conservée uniquement pour porter l''e-mail (préférence utilisateur).';
comment on column public.notifications.email_status is
  'Boîte d''envoi : pending (à envoyer) · sending (réclamée par le mailer) · sent · skipped (canal coupé par préférence, ou destinataire sans adresse) · failed (abandon après 5 tentatives).';

-- File du mailer : index partiel, les lignes à envoyer sont une minorité.
create index if not exists notifications_email_queue_idx
  on public.notifications (email_next_attempt_at nulls first, created_at)
  where email_status in ('pending','sending');

-- Le volet ne montre que les notifications in-app.
create index if not exists notifications_inapp_idx
  on public.notifications (user_id, organization_id, created_at desc)
  where in_app;

-- ----------------------------------------------------------------------------
-- 2. Préférences par canal — modèle du chantier à venir
-- ----------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  user_id         uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Un des cinq motifs, ou '*' = valeur par défaut du compte sur ce tenant.
  kind            text not null,
  in_app          boolean not null default true,
  email           boolean not null default true,
  updated_at      timestamptz not null default now(),
  primary key (user_id, organization_id, kind),
  constraint notification_preferences_kind_check check (kind in (
    '*','assigned','unassigned','status_changed','note_added','new_request_in_scope'))
);

comment on table public.notification_preferences is
  'Préférences de notification par (utilisateur, tenant, motif). Ligne absente = tout activé (fail OPEN : une préférence manquante ne doit jamais faire taire une information). ''*'' porte le défaut du compte, une ligne de motif le surcharge.';

drop trigger if exists t02_notification_preferences_updated_at on public.notification_preferences;
create trigger t02_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- Résolveur — le SEUL endroit qui connaît la sémantique « motif précis, sinon
-- défaut du compte, sinon tout activé ».
--
-- ⚠️ Noms de sortie DISTINCTS des colonnes de la table (`use_in_app` /
-- `use_email`) : dans un RETURNS TABLE, les paramètres OUT sont visibles dans
-- le corps et masqueraient `in_app` / `email` (piège déjà rencontré sur
-- contact_request_counts, docs/data-model.md).
create or replace function public.notification_channels_for(
  p_user_id uuid, p_org_id uuid, p_kind text)
returns table (use_in_app boolean, use_email boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.notification_preferences%rowtype;
begin
  select * into v_row from public.notification_preferences p
   where p.user_id = p_user_id and p.organization_id = p_org_id and p.kind = p_kind;
  if not found then
    select * into v_row from public.notification_preferences p
     where p.user_id = p_user_id and p.organization_id = p_org_id and p.kind = '*';
  end if;
  if not found then
    use_in_app := true; use_email := true;           -- fail open
  else
    use_in_app := v_row.in_app; use_email := v_row.email;
  end if;
  return next;
end;
$$;
comment on function public.notification_channels_for(uuid, uuid, text) is
  'Canaux à servir pour (utilisateur, tenant, motif) : ligne du motif, sinon ligne ''*'', sinon tout activé (fail open). Unique porteuse de cette sémantique.';
revoke execute on function public.notification_channels_for(uuid, uuid, text) from public, anon, authenticated;

alter table public.notification_preferences enable row level security;

-- Contrairement à `notifications` (aucune écriture cliente : ce n'est pas un
-- geste d'utilisateur), une PRÉFÉRENCE est le geste de son titulaire — il la
-- lit et l'écrit lui-même, sur les seuls tenants dont il est membre.
drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notification_preferences_insert on public.notification_preferences;
create policy notification_preferences_insert on public.notification_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

drop policy if exists notification_preferences_update on public.notification_preferences;
create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

drop policy if exists notification_preferences_delete on public.notification_preferences;
create policy notification_preferences_delete on public.notification_preferences
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists notification_preferences_service on public.notification_preferences;
create policy notification_preferences_service on public.notification_preferences
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 3. Production : les déclencheurs consultent les préférences
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
    from public.notification_channels_for(p_user_id, p_org_id, p_kind) c;
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
comment on function public.push_notification(uuid, uuid, uuid, uuid, text, text, text, jsonb) is
  'Insertion unitaire d''une notification. Porte la règle « jamais pour son propre geste » (p_user_id = p_actor_id → no-op) ET la résolution des canaux (préférences). Interne : aucune EXECUTE cliente.';
revoke execute on function public.push_notification(uuid, uuid, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;

-- Fan-out : mêmes préférences, résolues en LATERAL pour rester en une passe.
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
    cross join lateral public.notification_channels_for(
                 m.user_id, new.organization_id, 'new_request_in_scope') ch
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

-- ----------------------------------------------------------------------------
-- 4. Boîte d'envoi : réclamation atomique et règlement
-- ----------------------------------------------------------------------------

/** Tentatives avant abandon franc. */
create or replace function public.notification_email_max_attempts()
returns int language sql immutable set search_path = '' as $$ select 5 $$;
revoke execute on function public.notification_email_max_attempts() from public, anon, authenticated;

-- Réclame un lot et le marque 'sending' DANS LA MÊME instruction : deux
-- exécutions concurrentes du cron ne peuvent pas expédier deux fois le même
-- message (`for update skip locked`). Récupère aussi les lignes restées
-- 'sending' depuis plus de 15 min — une fonction morte en vol ne bloque rien.
create or replace function public.claim_notification_emails(p_limit int default 25)
returns table (
  notification_id   uuid,
  organization_id   uuid,
  organization_name text,
  kind              text,
  payload           jsonb,
  request_id        uuid,
  recipient_email   text,
  recipient_name    text,
  attempts          int
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select n.id from public.notifications n
     where (n.email_status = 'pending'
            and (n.email_next_attempt_at is null or n.email_next_attempt_at <= now()))
        or (n.email_status = 'sending'
            and n.email_attempted_at is not null
            and n.email_attempted_at < now() - interval '15 minutes')
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 25), 200))
     for update skip locked
  ),
  claimed as (
    update public.notifications n
       set email_status = 'sending',
           email_attempts = n.email_attempts + 1,
           email_attempted_at = now()
     where n.id in (select id from due)
    returning n.id, n.organization_id, n.kind, n.payload, n.request_id,
              n.user_id, n.email_attempts
  )
  select c.id, c.organization_id, o.name, c.kind, c.payload, c.request_id,
         u.email, public.user_display_name(u.id), c.email_attempts
    from claimed c
    join public.users u on u.id = c.user_id
    join public.organizations o on o.id = c.organization_id;
end;
$$;
comment on function public.claim_notification_emails(int) is
  'Réclame un lot d''e-mails à expédier et le marque ''sending'' atomiquement (for update skip locked) — deux mailers concurrents n''expédient jamais deux fois. Récupère les lignes ''sending'' figées depuis 15 min. service_role uniquement.';
revoke execute on function public.claim_notification_emails(int) from public, anon, authenticated;

-- Règlement d'un envoi. Échec → temporisation croissante (2, 4, 8, 16 min) et
-- retour en file ; au-delà du plafond, abandon franc en 'failed' — on ne
-- réessaie pas indéfiniment un relais qui refuse.
create or replace function public.settle_notification_email(
  p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_attempts int;
begin
  if p_ok then
    update public.notifications
       set email_status = 'sent', email_sent_at = now(),
           email_next_attempt_at = null, email_error = null
     where id = p_id;
    return;
  end if;

  select email_attempts into v_attempts from public.notifications where id = p_id;
  if v_attempts is null then return; end if;

  if v_attempts >= public.notification_email_max_attempts() then
    update public.notifications
       set email_status = 'failed', email_error = left(coalesce(p_error, 'inconnue'), 500),
           email_next_attempt_at = null
     where id = p_id;
  else
    update public.notifications
       set email_status = 'pending', email_error = left(coalesce(p_error, 'inconnue'), 500),
           email_next_attempt_at = now() + (interval '1 minute' * power(2, v_attempts))
     where id = p_id;
  end if;
end;
$$;
comment on function public.settle_notification_email(uuid, boolean, text) is
  'Règle un envoi : succès → ''sent'' ; échec → retour en file avec temporisation croissante, puis ''failed'' au-delà de 5 tentatives. service_role uniquement.';
revoke execute on function public.settle_notification_email(uuid, boolean, text) from public, anon, authenticated;

-- Destinataire sans adresse exploitable : on ne réessaiera jamais avec succès.
create or replace function public.skip_notification_email(p_id uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.notifications
     set email_status = 'skipped', email_error = left(coalesce(p_reason, ''), 500),
         email_next_attempt_at = null
   where id = p_id;
$$;
comment on function public.skip_notification_email(uuid, text) is
  'Renonce définitivement à l''e-mail d''une notification (destinataire sans adresse, tenant sans relais). service_role uniquement.';
revoke execute on function public.skip_notification_email(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Cron — drainage de la file toutes les minutes.
-- Même motif que sync-socle-referentiel : le secret est lu dans le Vault à
-- l'exécution. Tant que l'entrée n'existe pas, l'appel part sans secret et la
-- fonction répond 401 — le job est inoffensif à vide.
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('notifications-mailer')
 where exists (select 1 from cron.job where jobname = 'notifications-mailer');

select cron.schedule(
  'notifications-mailer',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/notifications-mailer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_iris'), '')
    ),
    body := '{}'::jsonb
  );
  $job$
);
