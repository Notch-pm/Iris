-- ============================================================================
-- Courrier de réponse VALIDÉ DANS CLARA (2026-11-12).
--
-- Le Socle porte, par démarche, `communication_config.replyLetters.claraOutbound`
-- (contrat 1.46.0) : quand il est actif ET que la collectivité est abonnée à
-- Clara, l'agent Iris ne résout plus une demande « en instruction » d'un geste.
-- Il rédige le courrier de réponse, qui est déposé dans Clara comme COURRIER
-- SORTANT lié à la demande ; la demande reste `en_instruction`, dans le
-- SOUS-ÉTAT « Réponse en validation » (`reply_validation_state`).
-- Quand Clara signale l'envoi, Iris applique l'issue choisie par l'agent
-- (`reply_pending_outcome`) ; quand Clara signale l'abandon, la demande revient
-- à l'instruction simple.
--
-- ⚠️ PAS de 8ᵉ statut (invariant PO du workflow à 7 statuts) : le sous-état
-- n'existe qu'en `en_instruction` (CHECK) et se garde en base.
-- ⚠️ Iris reste seule source de vérité du statut : Clara transmet un FAIT
-- (courrier envoyé / abandonné), l'issue a été décidée par l'agent Iris.
--
-- Portes : quatre RPC de SERVICE (SECURITY DEFINER, EXECUTE révoqué de
-- anon/authenticated), appelées par l'edge `submit-reply-to-clara` (dépôt) et
-- par `requests-api` (avis de Clara). Aucune écriture cliente des colonnes
-- `reply_*` / `clara_*` (trigger `t11_requests_guard_clara_reply`).
--
-- Rejouable : IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS partout.
-- ============================================================================

-- 1. Le réglage de la démarche, miroité depuis le Socle ---------------------------
alter table public.socle_procedure_cache
  add column if not exists reply_via_clara boolean not null default false;

comment on column public.socle_procedure_cache.reply_via_clara is
  'Socle communication_config.replyLetters.claraOutbound (contrat 1.46.0) : le courrier de réponse passe par le circuit du courrier sortant de Clara. Valeur BRUTE : effet seulement si la source clara du tenant est active (request_reply_via_clara).';

-- 2. Le sous-état et le lien vers le courrier Clara -------------------------------
alter table public.requests
  add column if not exists reply_validation_state     text,
  add column if not exists reply_pending_outcome      text,
  add column if not exists reply_pending_motif        text,
  add column if not exists reply_pending_closure_text text,
  add column if not exists reply_submitted_by         uuid references public.users(id) on delete set null,
  add column if not exists reply_submitted_at         timestamptz,
  add column if not exists reply_submission_id        uuid,
  add column if not exists clara_courier_id           uuid,
  add column if not exists clara_courier_reference    text,
  add column if not exists clara_courier_url          text;

alter table public.requests drop constraint if exists requests_reply_validation_state_check;
alter table public.requests add constraint requests_reply_validation_state_check
  check (reply_validation_state is null or reply_validation_state in ('depot_en_cours', 'en_validation'));

-- ⚠️ Le sous-état n'existe qu'en instruction : c'est ce qui en fait un
-- sous-état et non un 8ᵉ statut.
alter table public.requests drop constraint if exists requests_reply_validation_in_instruction;
alter table public.requests add constraint requests_reply_validation_in_instruction
  check (reply_validation_state is null or status = 'en_instruction');

alter table public.requests drop constraint if exists requests_reply_pending_outcome_check;
alter table public.requests add constraint requests_reply_pending_outcome_check
  check (reply_pending_outcome is null or reply_pending_outcome in ('resolue_positive', 'resolue_negative'));

alter table public.requests drop constraint if exists requests_reply_validation_complete;
alter table public.requests add constraint requests_reply_validation_complete
  check (reply_validation_state is null
         or (reply_pending_outcome is not null and reply_submission_id is not null
             and reply_submitted_at is not null));

alter table public.requests drop constraint if exists requests_reply_validation_courier;
alter table public.requests add constraint requests_reply_validation_courier
  check (reply_validation_state is distinct from 'en_validation' or clara_courier_id is not null);

alter table public.requests drop constraint if exists requests_clara_courier_url_check;
alter table public.requests add constraint requests_clara_courier_url_check
  check (clara_courier_url is null or (clara_courier_url ~ '^https://' and length(clara_courier_url) <= 500));

create unique index if not exists requests_reply_submission_uniq
  on public.requests (reply_submission_id) where reply_submission_id is not null;
create index if not exists requests_clara_courier_idx
  on public.requests (clara_courier_id) where clara_courier_id is not null;

comment on column public.requests.reply_validation_state is
  'Sous-état de en_instruction : depot_en_cours (dépôt dans Clara en cours) ou en_validation (« Réponse en validation » : courrier sortant Clara en attente d''envoi). NULL = aucun. Écrit par les seules RPC *_clara_reply.';
comment on column public.requests.reply_pending_outcome is
  'Issue choisie par l''agent Iris à la rédaction du courrier, appliquée quand Clara signale l''envoi.';

-- 3. Le circuit s'applique-t-il à cette demande ? ---------------------------------
-- Réglage de la démarche ET source clara active pour le tenant (le réglage
-- gouverne l'usage : sans abonnement Clara, la valeur du Socle est sans effet).
-- Ne révèle qu'un booléen de paramétrage : exécutable par `authenticated`,
-- l'écran s'en sert pour proposer le bon geste.
create or replace function public.request_reply_via_clara(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.requests r
      join public.socle_procedure_cache c
        on c.socle_id = r.socle_procedure_id and c.organization_id = r.organization_id
      join public.integration_sources s
        on s.organization_id = r.organization_id and s.code = 'clara' and s.status = 'active'
     where r.id = p_request_id
       and c.reply_via_clara
  );
$$;
revoke all on function public.request_reply_via_clara(uuid) from public, anon;
grant execute on function public.request_reply_via_clara(uuid) to authenticated, service_role;

-- 4. La garde ----------------------------------------------------------------------
-- SECURITY INVOKER (comme requests_guard_write) : `is_service_context()` y dit
-- vrai pour service_role ET pour les RPC DEFINER de cette migration, faux pour
-- un client — y compris derrière les RPC INVOKER de résolution groupée, qui
-- remontent donc le refus demande par demande (ok = false, motif dit).
create or replace function public.requests_guard_clara_reply()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_service boolean := public.is_service_context();
begin
  -- Pendant la validation, la demande ne change ni d'organisme ni de démarche :
  -- le courrier Clara a été adressé au nom de celui-ci, pour celle-là.
  if old.reply_validation_state is not null
     and (new.socle_organization_id is distinct from old.socle_organization_id
          or new.socle_procedure_id is distinct from old.socle_procedure_id) then
    raise exception 'Réponse en validation dans Clara : la demande ne peut être ni transférée ni requalifiée tant que le courrier n''est pas envoyé ou abandonné.'
      using errcode = 'P0430';
  end if;

  if v_service then
    return new;
  end if;

  if (new.reply_validation_state, new.reply_pending_outcome, new.reply_pending_motif,
      new.reply_pending_closure_text, new.reply_submitted_by, new.reply_submitted_at,
      new.reply_submission_id, new.clara_courier_id, new.clara_courier_reference,
      new.clara_courier_url)
     is distinct from
     (old.reply_validation_state, old.reply_pending_outcome, old.reply_pending_motif,
      old.reply_pending_closure_text, old.reply_submitted_by, old.reply_submitted_at,
      old.reply_submission_id, old.clara_courier_id, old.clara_courier_reference,
      old.clara_courier_url) then
    raise exception 'Le circuit de réponse Clara ne se modifie que par le serveur.'
      using errcode = '42501';
  end if;

  if old.reply_validation_state is not null
     and (new.status is distinct from old.status
          or new.closure_motif is distinct from old.closure_motif
          or new.closure_text is distinct from old.closure_text) then
    raise exception 'Réponse en validation dans Clara : la demande sera close quand Clara signalera l''envoi du courrier.'
      using errcode = 'P0430';
  end if;

  if new.status is distinct from old.status
     and old.status = 'en_instruction'
     and new.status in ('resolue_positive', 'resolue_negative')
     and public.request_reply_via_clara(old.id) then
    raise exception 'Cette démarche fait valider le courrier de réponse dans Clara : préparez le courrier de réponse au lieu de résoudre directement.'
      using errcode = 'P0431';
  end if;

  return new;
end;
$$;
revoke all on function public.requests_guard_clara_reply() from public, anon, authenticated;

drop trigger if exists t11_requests_guard_clara_reply on public.requests;
create trigger t11_requests_guard_clara_reply
  before update on public.requests
  for each row execute function public.requests_guard_clara_reply();

-- 5. t17 : la finalisation par Clara n'est pas rejugée sur les pièces --------------
-- Les pièces obligatoires ont été vérifiées conformes AU DÉPÔT (reserve) ; le
-- courrier est parti quand Clara le signale : refuser alors la clôture
-- figerait une demande dont la réponse a déjà été envoyée.
create or replace function public.requests_require_pieces_conformes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocking text[];
begin
  if new.status = 'resolue_positive' and old.status = 'en_instruction'
     and coalesce(current_setting('iris.clara_reply_finalize', true), '') <> 'on' then
    v_blocking := public.request_pieces_blocking(
      new.id, new.procedure_snapshot -> 'form_schema', new.form_data);
    if array_length(v_blocking, 1) > 0 then
      raise exception 'Résolution positive : pièce(s) obligatoire(s) à qualifier comme conformes — %.',
        array_to_string(v_blocking, ', ');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.requests_require_pieces_conformes() from public, anon, authenticated;

-- 6. Statistiques : la résolution revient à l'agent qui a rédigé le courrier ------
-- (auth.uid() est NULL quand Clara signale l'envoi par requests-api).
create or replace function public.requests_stats_upsert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_instr       timestamptz;
  v_outcome     text;
  v_resolved_by uuid;
  v_actor       uuid;
begin
  if tg_op = 'UPDATE' then
    if new.status             is not distinct from old.status
       and new.socle_scope_org_id is not distinct from old.socle_scope_org_id
       and new.socle_procedure_id is not distinct from old.socle_procedure_id
       and new.closed_at          is not distinct from old.closed_at then
      return null;
    end if;
    select s.instruction_started_at, s.outcome, s.resolved_by
      into v_instr, v_outcome, v_resolved_by
      from public.request_stats s
     where s.request_id = new.id;
  end if;

  v_actor := coalesce(auth.uid(),
                      case when tg_op = 'UPDATE' and old.reply_validation_state is not null
                           then new.reply_submitted_by end);

  if new.status = 'en_instruction' and v_instr is null then
    v_instr := case when tg_op = 'INSERT' then new.created_at else now() end;
  end if;

  if new.status in ('annulee', 'resolue_positive', 'resolue_negative') then
    if tg_op = 'INSERT' then
      v_outcome     := new.status;
      v_resolved_by := case when new.status like 'resolue_%' then v_actor end;
    elsif old.status is distinct from new.status and old.status <> 'archivee' then
      v_outcome     := new.status;
      v_resolved_by := case when new.status like 'resolue_%' then v_actor end;
    end if;
  elsif new.status = 'archivee' then
    null;
  else
    v_outcome     := null;
    v_resolved_by := null;
  end if;

  insert into public.request_stats (
    request_id, organization_id, socle_root_org_id, socle_scope_org_id, socle_procedure_id,
    source, channel, received_at, created_at, current_status,
    instruction_started_at, resolved_at, outcome, resolved_by, updated_at)
  values (
    new.id, new.organization_id, new.socle_root_org_id, new.socle_scope_org_id, new.socle_procedure_id,
    new.source, new.channel, new.received_at, new.created_at, new.status,
    v_instr, new.closed_at, v_outcome, v_resolved_by, now())
  on conflict (request_id) do update set
    organization_id        = excluded.organization_id,
    socle_root_org_id      = excluded.socle_root_org_id,
    socle_scope_org_id     = excluded.socle_scope_org_id,
    socle_procedure_id     = excluded.socle_procedure_id,
    source                 = excluded.source,
    channel                = excluded.channel,
    received_at            = excluded.received_at,
    created_at             = excluded.created_at,
    current_status         = excluded.current_status,
    instruction_started_at = excluded.instruction_started_at,
    resolved_at            = excluded.resolved_at,
    outcome                = excluded.outcome,
    resolved_by            = excluded.resolved_by,
    updated_at             = excluded.updated_at;
  return null;
end;
$function$;
revoke all on function public.requests_stats_upsert() from public, anon, authenticated;

-- 7. Les quatre portes de service --------------------------------------------------

-- 7a. Réserver le dépôt (avant l'appel à Clara). Idempotent sur la même
--     soumission ; vérifie tout ce qui ne pourra plus l'être à l'envoi.
create or replace function public.reserve_clara_reply(
  p_uid           uuid,
  p_request_id    uuid,
  p_submission_id uuid,
  p_outcome       text,
  p_motif         text default null,
  p_closure_text  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.requests%rowtype;
  v_blocking text[];
begin
  if p_uid is null or p_submission_id is null then
    raise exception 'Agent et soumission obligatoires.' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('resolue_positive', 'resolue_negative') then
    raise exception 'Issue attendue : resolue_positive ou resolue_negative.' using errcode = '22023';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'Demande introuvable.' using errcode = 'P0002';
  end if;

  -- Rejeu de la même soumission : rien à refaire.
  if r.reply_validation_state is not null and r.reply_submission_id = p_submission_id then
    return;
  end if;
  if r.reply_validation_state is not null then
    raise exception 'Un courrier de réponse est déjà en validation dans Clara pour cette demande.'
      using errcode = 'P0430';
  end if;
  if r.status <> 'en_instruction' then
    raise exception 'Le courrier de réponse se prépare sur une demande en instruction.'
      using errcode = 'P0432';
  end if;
  if not public.request_reply_via_clara(r.id) then
    raise exception 'Cette démarche ne fait pas valider ses courriers de réponse dans Clara.'
      using errcode = 'P0432';
  end if;
  if not public.user_has_request_right(p_uid, r.organization_id, r.socle_organization_id,
                                       r.socle_procedure_id, 'cloture') then
    raise exception 'Préparer le courrier de réponse exige le droit de clôture sur cette démarche pour ce service.'
      using errcode = '42501';
  end if;
  if r.socle_contact_id is null then
    raise exception 'Le demandeur n''est rattaché à aucune fiche du Socle : Clara ne peut pas lui adresser de courrier.'
      using errcode = 'P0433';
  end if;
  if p_outcome = 'resolue_positive' then
    v_blocking := public.request_pieces_blocking(
      r.id, r.procedure_snapshot -> 'form_schema', r.form_data);
    if array_length(v_blocking, 1) > 0 then
      raise exception 'Résolution positive : pièce(s) obligatoire(s) à qualifier comme conformes — %.',
        array_to_string(v_blocking, ', ');
    end if;
  end if;

  update public.requests set
    reply_validation_state     = 'depot_en_cours',
    reply_pending_outcome      = p_outcome,
    reply_pending_motif        = nullif(btrim(coalesce(p_motif, '')), ''),
    reply_pending_closure_text = nullif(btrim(coalesce(p_closure_text, '')), ''),
    reply_submitted_by         = p_uid,
    reply_submitted_at         = now(),
    reply_submission_id        = p_submission_id,
    clara_courier_id           = null,
    clara_courier_reference    = null,
    clara_courier_url          = null
  where id = r.id;
end;
$$;

-- 7b. Libérer une réservation dont le dépôt a échoué (Clara injoignable, refus).
create or replace function public.release_clara_reply(p_request_id uuid, p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.requests set
    reply_validation_state     = null,
    reply_pending_outcome      = null,
    reply_pending_motif        = null,
    reply_pending_closure_text = null,
    reply_submitted_by         = null,
    reply_submitted_at         = null,
    reply_submission_id        = null
  where id = p_request_id
    and reply_validation_state = 'depot_en_cours'
    and reply_submission_id = p_submission_id;
end;
$$;

-- 7c. Confirmer le dépôt : Clara a créé le courrier sortant.
create or replace function public.confirm_clara_reply(
  p_request_id    uuid,
  p_submission_id uuid,
  p_courier_id    uuid,
  p_reference     text,
  p_url           text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.requests%rowtype;
begin
  if p_courier_id is null then
    raise exception 'Identifiant du courrier Clara obligatoire.' using errcode = '22023';
  end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.reply_submission_id is distinct from p_submission_id then
    raise exception 'Aucun dépôt en cours pour cette soumission.' using errcode = 'P0002';
  end if;
  if r.reply_validation_state = 'en_validation' and r.clara_courier_id = p_courier_id then
    return;  -- rejeu
  end if;
  if r.reply_validation_state is distinct from 'depot_en_cours' then
    raise exception 'Aucun dépôt en cours pour cette soumission.' using errcode = 'P0002';
  end if;

  update public.requests set
    reply_validation_state  = 'en_validation',
    clara_courier_id        = p_courier_id,
    clara_courier_reference = nullif(btrim(coalesce(p_reference, '')), ''),
    clara_courier_url       = case when p_url ~ '^https://' then left(p_url, 500) end
  where id = r.id;

  insert into public.request_links (organization_id, request_id, link_type, external_type,
                                    external_id, external_url, created_by)
  values (r.organization_id, r.id, 'externe', 'clara_courier', p_courier_id::text,
          case when p_url ~ '^https://' then left(p_url, 500) end, r.reply_submitted_by);

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (r.organization_id, r.id, 'clara_reply_submitted',
          jsonb_build_object('courier_id', p_courier_id,
                             'courier_reference', nullif(btrim(coalesce(p_reference, '')), ''),
                             'outcome', r.reply_pending_outcome),
          r.reply_submitted_by);
end;
$$;

-- 7d. Avis de Clara : courrier ENVOYÉ → la demande prend l'issue réservée.
--     Retour : 'finalized' | 'already'. Le tenant est celui de la clé appelante.
create or replace function public.finalize_clara_reply(
  p_organization_id uuid,
  p_request_id      uuid,
  p_courier_id      uuid,
  p_sent_at         timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.requests%rowtype;
begin
  select * into r from public.requests
   where id = p_request_id and organization_id = p_organization_id
   for update;
  if r.id is null then
    raise exception 'Demande introuvable.' using errcode = 'P0002';
  end if;
  if r.clara_courier_id is distinct from p_courier_id then
    raise exception 'Ce courrier n''est pas le courrier de réponse en attente de cette demande.'
      using errcode = 'P0434';
  end if;
  if r.reply_validation_state is null and r.status = r.reply_pending_outcome then
    return 'already';
  end if;
  if r.reply_validation_state is distinct from 'en_validation' then
    raise exception 'Aucun courrier de réponse en validation pour cette demande.'
      using errcode = 'P0434';
  end if;

  perform set_config('iris.clara_reply_finalize', 'on', true);
  update public.requests set
    status                 = r.reply_pending_outcome,
    closure_motif          = r.reply_pending_motif,
    closure_text           = r.reply_pending_closure_text,
    closed_at              = least(coalesce(p_sent_at, now()), now()),
    reply_validation_state = null
  where id = r.id;
  perform set_config('iris.clara_reply_finalize', 'off', true);

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (r.organization_id, r.id, 'clara_reply_sent',
          jsonb_build_object('courier_id', p_courier_id,
                             'courier_reference', r.clara_courier_reference,
                             'outcome', r.reply_pending_outcome,
                             'sent_at', coalesce(p_sent_at, now())),
          null);
  return 'finalized';
end;
$$;

-- 7e. Avis de Clara : courrier ABANDONNÉ → retour à l'instruction simple.
--     Retour : 'cancelled' | 'already'.
create or replace function public.cancel_clara_reply(
  p_organization_id uuid,
  p_request_id      uuid,
  p_courier_id      uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.requests%rowtype;
begin
  select * into r from public.requests
   where id = p_request_id and organization_id = p_organization_id
   for update;
  if r.id is null then
    raise exception 'Demande introuvable.' using errcode = 'P0002';
  end if;
  if r.reply_validation_state is distinct from 'en_validation'
     or r.clara_courier_id is distinct from p_courier_id then
    -- Déjà annulé (rejeu) : le lien externe garde la trace du courrier.
    if exists (select 1 from public.request_events e
                where e.request_id = r.id and e.event_type = 'clara_reply_cancelled'
                  and e.payload ->> 'courier_id' = p_courier_id::text) then
      return 'already';
    end if;
    raise exception 'Ce courrier n''est pas le courrier de réponse en attente de cette demande.'
      using errcode = 'P0434';
  end if;

  update public.requests set
    reply_validation_state     = null,
    reply_pending_outcome      = null,
    reply_pending_motif        = null,
    reply_pending_closure_text = null,
    clara_courier_id           = null,
    clara_courier_reference    = null,
    clara_courier_url          = null
  where id = r.id;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (r.organization_id, r.id, 'clara_reply_cancelled',
          jsonb_build_object('courier_id', p_courier_id,
                             'courier_reference', r.clara_courier_reference),
          null);
  return 'cancelled';
end;
$$;

revoke all on function public.reserve_clara_reply(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.release_clara_reply(uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_clara_reply(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finalize_clara_reply(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_clara_reply(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_clara_reply(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.release_clara_reply(uuid, uuid) to service_role;
grant execute on function public.confirm_clara_reply(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.finalize_clara_reply(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.cancel_clara_reply(uuid, uuid, uuid) to service_role;

-- 8. Le scope de l'avis de Clara ---------------------------------------------------
-- `requests:reply_letter` : `POST /v1/requests/{id}/reply-letter/events`
-- (Clara signale l'envoi ou l'abandon du courrier). Accordé aux clés NON
-- révoquées de la source `clara` ; une clé Clara émise plus tard devra le
-- recevoir à son émission.
alter table public.integration_credentials
  drop constraint if exists integration_credentials_scopes_check;
alter table public.integration_credentials
  add constraint integration_credentials_scopes_check
  check (
    scopes <@ array['requests:write', 'requests:read', 'requests:read_tenant', 'requests:citizen',
                    'requests:reply_letter']::text[]
    and array_length(scopes, 1) >= 1
  );

update public.integration_credentials c
set scopes = array_append(c.scopes, 'requests:reply_letter')
from public.integration_sources s
where s.id = c.integration_source_id
  and s.code = 'clara'
  and c.revoked_at is null
  and not ('requests:reply_letter' = any(c.scopes));
