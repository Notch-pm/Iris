-- ============================================================================
-- B16 — Échéance de traitement CALCULÉE par le serveur, immuable, alertée.
--
-- Décisions PO du 2026-11-06 :
--   · échéance = jour de réception (heure de Paris) + délai de la DÉMARCHE
--     (« durée habituelle d'instruction » du Socle, `user_communication.delays`),
--     à défaut 15 jours calendaires (`organizations.default_due_days`) ;
--   · une démarche en jours ouvrés garde son unité : samedis et dimanches
--     exclus, jours fériés NON retirés ; jour / semaine / mois en calendaire ;
--   · le délai n'est PAS suspendu pendant « En attente d'information » ;
--   · l'échéance NE SE MODIFIE PAS à la main — ni client, ni service ;
--   · alertes « échéance proche » (3 jours ou moins) puis « échéance
--     dépassée », une fois chacune, à l'instructeur, à défaut aux agents qui
--     détiennent l'instruction sur le couple (fan-out de `new_request_in_scope`).
--
-- Le délai vient du CACHE des démarches (rempli par `sync-socle-referentiel`),
-- pas du snapshot : le cache est de confiance et lu pour toutes les sources,
-- le snapshot peut venir d'un insert client (policy `requests_insert`, S1).
-- Une modification du délai au Socle vaut pour les demandes reçues après la
-- synchronisation suivante ; une demande garde l'échéance de son dépôt.
--
-- `due_at` = 23:59:59 (Paris) du jour d'échéance : la demande est « à l'heure »
-- toute la journée — même lecture que la pastille de la fiche (`dueView`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Où vit le délai.
-- ---------------------------------------------------------------------------
alter table public.socle_procedure_cache
  add column if not exists processing_time_value integer
    check (processing_time_value between 1 and 999),
  add column if not exists processing_time_unit text
    check (processing_time_unit in ('jour_ouvre', 'jour', 'semaine', 'mois'));
comment on column public.socle_procedure_cache.processing_time_value is
  'Durée habituelle d''instruction annoncée par la démarche (Socle user_communication.delays) — base de l''échéance. NULL = aucun délai annoncé : défaut de la collectivité.';
comment on column public.socle_procedure_cache.processing_time_unit is
  'Unité du délai : jour_ouvre (hors samedi et dimanche) | jour | semaine | mois. NULL avec une valeur = délai ignoré (jamais déduit).';

alter table public.organizations
  add column if not exists default_due_days integer not null default 15
    check (default_due_days between 1 and 999);
comment on column public.organizations.default_due_days is
  'Délai de traitement par défaut, en jours CALENDAIRES, quand la démarche n''en annonce aucun (B16, PO 2026-11-06 : 15).';

-- ---------------------------------------------------------------------------
-- 2. Le calcul — pur, testable seul.
-- ---------------------------------------------------------------------------
create or replace function public.add_business_days(p_day date, p_days integer)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v_day date := p_day;
  v_n   integer := 0;
begin
  if p_day is null or p_days is null or p_days < 1 then
    return p_day;
  end if;
  while v_n < p_days loop
    v_day := v_day + 1;
    if extract(isodow from v_day) < 6 then  -- 6 = samedi, 7 = dimanche
      v_n := v_n + 1;
    end if;
  end loop;
  return v_day;
end;
$$;
comment on function public.add_business_days(date, integer) is
  'p_day + p_days jours ouvrés (samedis et dimanches exclus, jours fériés NON retirés — décision PO 2026-11-06).';

create or replace function public.request_due_at(
  p_received_at  timestamptz,
  p_value        integer,
  p_unit         text,
  p_default_days integer)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v_day date;
  v_due date;
begin
  if p_received_at is null then
    return null;
  end if;
  v_day := (p_received_at at time zone 'Europe/Paris')::date;
  if p_value between 1 and 999 and p_unit in ('jour_ouvre', 'jour', 'semaine', 'mois') then
    v_due := case p_unit
      when 'jour'       then v_day + p_value
      when 'semaine'    then v_day + 7 * p_value
      when 'mois'       then (v_day + make_interval(months => p_value))::date
      when 'jour_ouvre' then public.add_business_days(v_day, p_value)
    end;
  else
    v_due := v_day + coalesce(case when p_default_days between 1 and 999 then p_default_days end, 15);
  end if;
  return (v_due + time '23:59:59') at time zone 'Europe/Paris';
end;
$$;
comment on function public.request_due_at(timestamptz, integer, text, integer) is
  'Échéance d''une demande (B16) : 23:59:59 à Paris du jour de réception + délai de la démarche, sinon + défaut calendaire de la collectivité.';

-- ---------------------------------------------------------------------------
-- 3. Posée à l'insertion, pour toutes les sources — et toujours ÉCRASÉE :
--    une valeur fournie par l'appelant n'est jamais retenue.
-- ---------------------------------------------------------------------------
create or replace function public.requests_set_due_at()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_value   integer;
  v_unit    text;
  v_default integer;
begin
  select c.processing_time_value, c.processing_time_unit into v_value, v_unit
    from public.socle_procedure_cache c
   where c.socle_id = new.socle_procedure_id and c.organization_id = new.organization_id;
  select o.default_due_days into v_default from public.organizations o where o.id = new.organization_id;
  new.due_at := public.request_due_at(coalesce(new.received_at, now()), v_value, v_unit, v_default);
  return new;
end;
$$;
revoke execute on function public.requests_set_due_at() from public, anon, authenticated;

drop trigger if exists t22_requests_set_due_at on public.requests;
create trigger t22_requests_set_due_at
  before insert on public.requests
  for each row execute function public.requests_set_due_at();

-- ---------------------------------------------------------------------------
-- 4. Immuable ensuite. Définition LIVE reprise à l'identique (2026-11-06),
--    `due_at` ajoutée à la liste des colonnes qui ne changent jamais.
-- ---------------------------------------------------------------------------
create or replace function public.requests_protect_immutable()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_service           boolean := public.is_service_context();
  v_only_scope_refresh boolean;
begin
  if new.id                is distinct from old.id
     or new.reference         is distinct from old.reference
     or new.reference_year is distinct from old.reference_year
     or new.reference_seq  is distinct from old.reference_seq
     or new.organization_id   is distinct from old.organization_id
     or new.socle_root_org_id is distinct from old.socle_root_org_id
     or new.source          is distinct from old.source
     or new.external_ref    is distinct from old.external_ref
     or new.received_at     is distinct from old.received_at
     or new.created_at      is distinct from old.created_at
     or new.requester_snapshot is distinct from old.requester_snapshot
     or new.consents        is distinct from old.consents
     or new.due_at          is distinct from old.due_at then
    raise exception 'Colonne immuable : id, reference, organization_id, socle_root_org_id, source, external_ref, received_at, created_at, requester_snapshot, consents et due_at (échéance calculée au dépôt) ne changent jamais.';
  end if;

  if old.status = 'archivee' then
    v_only_scope_refresh :=
      v_service
      and new.status = 'archivee'
      and new.subject           is not distinct from old.subject
      and new.body              is not distinct from old.body
      and new.form_data         is not distinct from old.form_data
      and new.procedure_snapshot is not distinct from old.procedure_snapshot
      and new.closure_motif     is not distinct from old.closure_motif
      and new.closure_text      is not distinct from old.closure_text
      and new.assigned_to       is not distinct from old.assigned_to
      and new.priority          is not distinct from old.priority
      and new.socle_organization_id is not distinct from old.socle_organization_id
      and new.socle_procedure_id    is not distinct from old.socle_procedure_id
      and new.socle_contact_id      is not distinct from old.socle_contact_id
      and (new.socle_scope_org_id is distinct from old.socle_scope_org_id
           or new.anomalies is distinct from old.anomalies);

    if new.status = 'archivee' and not v_only_scope_refresh then
      raise exception 'Demande archivée : aucune modification possible (désarchiver d''abord).';
    end if;
    if new.status <> 'archivee'
       and (new.subject       is distinct from old.subject
         or new.body       is distinct from old.body
         or new.form_data  is distinct from old.form_data
         or new.procedure_snapshot is distinct from old.procedure_snapshot
         or new.closure_motif is distinct from old.closure_motif
         or new.closure_text  is distinct from old.closure_text
         or new.assigned_to   is distinct from old.assigned_to
         or new.priority      is distinct from old.priority
         or new.anomalies     is distinct from old.anomalies
         or new.socle_organization_id is distinct from old.socle_organization_id
         or new.socle_procedure_id    is distinct from old.socle_procedure_id
         or new.socle_contact_id      is distinct from old.socle_contact_id) then
      raise exception 'Désarchivage : seul le statut peut changer.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_protect_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Alertes d'échéance : deux motifs de notification de plus.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind = any (array[
  'assigned', 'unassigned', 'status_changed', 'note_added', 'new_request_in_scope', 'mentioned',
  'transferred_in', 'intervention_requested', 'intervention_completed', 'citizen_replied',
  'deadline_soon', 'deadline_overdue']));
alter table public.notification_preferences drop constraint if exists notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind = any (array[
  '*', 'assigned', 'unassigned', 'status_changed', 'note_added', 'new_request_in_scope', 'mentioned',
  'transferred_in', 'intervention_requested', 'intervention_completed', 'citizen_replied',
  'deadline_soon', 'deadline_overdue']));

-- Une alerte par demande et par motif, jamais deux : la mémoire du passage quotidien.
create table if not exists public.request_deadline_alerts (
  request_id uuid not null references public.requests (id) on delete cascade,
  kind       text not null check (kind in ('deadline_soon', 'deadline_overdue')),
  created_at timestamptz not null default now(),
  primary key (request_id, kind)
);
alter table public.request_deadline_alerts enable row level security;
-- Aucune policy : seul `notify_request_deadlines` (DEFINER) y écrit et y lit.
comment on table public.request_deadline_alerts is
  'Alertes d''échéance déjà émises (B16) — une par demande et par motif. Sans policy : écrite par notify_request_deadlines seule. Suit la demande (purge RGPD).';

create or replace function public.notify_request_deadlines()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  r       record;
  v_days  integer;
  v_kind  text;
  v_n     integer;
  v_sent  integer := 0;
  v_extra jsonb;
begin
  for r in
    select q.id, q.organization_id, q.reference, q.subject, q.status, q.assigned_to, q.due_at,
           q.socle_organization_id, q.socle_procedure_id, q.socle_organization_label, q.socle_procedure_label
      from public.requests q
     where q.status in ('a_traiter', 'en_instruction', 'en_attente')
       and q.due_at is not null
       and (q.due_at at time zone 'Europe/Paris')::date <= v_today + 3
     order by q.due_at
  loop
    v_days := (r.due_at at time zone 'Europe/Paris')::date - v_today;
    v_kind := case when v_days < 0 then 'deadline_overdue' else 'deadline_soon' end;
    insert into public.request_deadline_alerts (request_id, kind) values (r.id, v_kind)
      on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      continue;  -- déjà prévenu pour ce motif
    end if;

    v_extra := jsonb_build_object(
      'status', r.status, 'due_at', r.due_at, 'days', v_days,
      'procedure', r.socle_procedure_label, 'destinataire', r.socle_organization_label);
    if r.assigned_to is not null then
      perform public.push_notification(
        r.assigned_to, null, r.organization_id, r.id, v_kind, r.reference, r.subject, v_extra);
    else
      -- Sans instructeur : le fan-out de `new_request_in_scope` (instruction sur le couple).
      insert into public.notifications (organization_id, user_id, request_id, kind, actor_id,
                                        payload, in_app, email_status)
      select r.organization_id, m.user_id, r.id, v_kind, null,
             jsonb_build_object('reference', r.reference, 'subject', r.subject, 'actor_name', null) || v_extra,
             ch.use_in_app,
             case when ch.use_email then 'pending' else 'skipped' end
        from public.organization_members m
        cross join lateral public.notification_channels_for(m.user_id, v_kind) ch
       where m.organization_id = r.organization_id
         and (ch.use_in_app or ch.use_email)
         and public.request_right_for(
               m.user_id, r.organization_id, r.socle_organization_id, r.socle_procedure_id, 'instruction');
    end if;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke execute on function public.notify_request_deadlines() from public, anon, authenticated;
comment on function public.notify_request_deadlines() is
  'Passage quotidien (B16) : « échéance proche » (3 jours ou moins) puis « échéance dépassée », une fois chacune, demandes ouvertes seulement. Rend le nombre de demandes alertées.';
