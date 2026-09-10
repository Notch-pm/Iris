-- ============================================================================
-- Interventions — solliciter un INTERVENANT pendant l'instruction d'une demande
-- (demande PO du 2026-09-14).
--
-- Le besoin : un agent qui instruit une demande demande à un intervenant
-- (service technique, prestataire rattaché au tenant…) d'agir sur le terrain,
-- avec un commentaire et une date souhaitée ; l'intervenant est prévenu par
-- e-mail, ne voit QUE les demandes sur lesquelles on l'a sollicité, et déclare
-- l'intervention réalisée avec un commentaire et une date de finalisation.
--
-- Ce que ce lot pose, et pourquoi :
--
--   1. `permission_profiles.is_intervenant` — un ATTRIBUT de profil, comme
--      l'administration (`is_admin`), pas un cinquième droit de la matrice.
--      Il n'accorde par lui-même AUCUN droit sur les demandes : il dit
--      seulement « cette personne peut être sollicitée », sur le PÉRIMÈTRE du
--      profil (sous-arbre implicite, comme tout le reste). Un profil
--      « Intervenant » sans aucun droit de consultation est donc valide —
--      même règle de forme que pour un profil d'administration pure.
--
--   2. `request_interventions` — une ligne par sollicitation. C'est la
--      SOLLICITATION qui ouvre la visibilité : `requests_select` accepte
--      désormais aussi « je suis l'intervenant d'une intervention de cette
--      demande ». Les satellites qui suivent la demande par un EXISTS direct
--      (journal, pièces, liens, affectations) s'ouvrent avec elle ; les NOTES
--      INTERNES et les ÉCHANGES avec l'usager, non : ce sont le matériau de
--      l'instruction, et l'intervenant n'instruit pas — `can_consult_request`
--      (consultation par couple, sans la sollicitation) garde ces deux tables.
--      ⚠️ La visibilité ouverte par une sollicitation SURVIT à sa réalisation :
--      l'intervenant doit pouvoir relire ce qu'il a déclaré.
--
--   3. Deux RPC, SEULES portes d'écriture (aucune policy cliente d'écriture,
--      motif `transfer_request`) : `request_intervention` (exige l'instruction
--      sur le couple ET le statut « en cours d'instruction », garde serveur —
--      jamais UI seulement) et `complete_request_intervention` (réservée à
--      l'intervenant sollicité).
--
--   4. Deux motifs de notification, produits par ces RPC : `intervention_
--      requested` (à l'intervenant — c'est l'e-mail demandé, au gabarit AGENT,
--      via la boîte d'envoi de `notifications-mailer`) et `intervention_
--      completed` (à l'agent qui a sollicité, et à l'affectataire s'il est
--      quelqu'un d'autre). Comme partout : jamais pour son propre geste.
--
-- ⚠️ Piège DEFINER/current_user (CLAUDE.md) : aucune de ces fonctions ne teste
-- `is_service_context()`. Les contrôles sont réécrits DANS chaque RPC.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Attribut de profil
-- ----------------------------------------------------------------------------
alter table public.permission_profiles
  add column if not exists is_intervenant boolean not null default false;
comment on column public.permission_profiles.is_intervenant is
  'Intervenant : les titulaires peuvent être SOLLICITÉS pour une intervention sur les demandes du périmètre du profil. Attribut, pas un droit : n''ouvre aucune demande par lui-même — c''est la sollicitation (request_interventions) qui ouvre.';

-- Forme d'un profil : au moins une organisation ; au moins un droit de
-- consultation SAUF profil d'administration OU d'intervenant pur.
create or replace function public.validate_permission_profile_shape(p_profile_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_is_admin       boolean;
  v_is_intervenant boolean;
  v_default_view   boolean;
  v_has_org        boolean;
  v_has_right      boolean;
begin
  select is_admin, is_intervenant, default_view
    into v_is_admin, v_is_intervenant, v_default_view
    from public.permission_profiles where id = p_profile_id;
  if v_is_admin is null then
    return;
  end if;

  select exists(select 1 from public.permission_profile_organizations where profile_id = p_profile_id)
    into v_has_org;
  if not v_has_org then
    raise exception 'Sélectionnez au moins une organisation.';
  end if;

  select v_default_view or exists (
    select 1 from public.permission_profile_procedures pp
     where pp.profile_id = p_profile_id and pp.right_view
  ) into v_has_right;
  if not v_is_admin and not v_is_intervenant and not v_has_right then
    raise exception 'Ce profil n''accorderait aucun droit.';
  end if;
end;
$$;
revoke execute on function public.validate_permission_profile_shape(uuid) from public, anon, authenticated;

-- Qui peut être sollicité sur une organisation porteuse : un membre du tenant
-- détenant une attribution ACTIVE à un profil `is_intervenant` dont le
-- périmètre (expansé, sous-arbre) contient l'organisation. Interne.
create or replace function public.is_intervenant_for(
  p_user_id uuid, p_org_id uuid, p_socle_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.permission_profile_assignments a
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_intervenant
     where a.user_id = p_user_id
       and a.organization_id = p_org_id
       and p_socle_org_id in (select s.socle_org_id from public.permission_profile_scope(p.id) s)
  );
$$;
comment on function public.is_intervenant_for(uuid, uuid, uuid) is
  'Vrai si l''utilisateur peut être sollicité comme intervenant sur cette organisation porteuse (profil actif is_intervenant, périmètre en sous-arbre). Interne : aucune EXECUTE cliente.';
revoke execute on function public.is_intervenant_for(uuid, uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Table
-- ----------------------------------------------------------------------------
create table if not exists public.request_interventions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete restrict,
  request_id         uuid not null references public.requests(id) on delete cascade,
  intervenant_id     uuid not null references public.users(id) on delete cascade,
  requested_by       uuid references public.users(id) on delete set null,
  requested_at       timestamptz not null default now(),
  -- Date d'intervention SOUHAITÉE par l'agent (jour, sans heure).
  requested_for      date not null,
  request_comment    text not null check (btrim(request_comment) <> ''),
  status             text not null default 'demandee' check (status in ('demandee', 'realisee')),
  completed_at       timestamptz,
  -- Date de finalisation DÉCLARÉE par l'intervenant (jour) — proposée au jour
  -- courant, modifiable : une intervention se déclare souvent après coup.
  completed_on       date,
  completion_comment text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint request_interventions_completion_consistent check (
    (status = 'demandee' and completed_at is null and completed_on is null)
    or (status = 'realisee' and completed_at is not null and completed_on is not null)
  )
);
comment on table public.request_interventions is
  'Sollicitations d''intervenants sur une demande. Écrite UNIQUEMENT par request_intervention / complete_request_intervention (aucune policy cliente d''écriture). La ligne OUVRE la demande à son intervenant (requests_select).';

create index if not exists request_interventions_request_idx
  on public.request_interventions (request_id, created_at);
-- « Mes interventions » et la policy de requests : par intervenant.
create index if not exists request_interventions_intervenant_idx
  on public.request_interventions (intervenant_id, organization_id, status);

drop trigger if exists t01_request_interventions_org on public.request_interventions;
create trigger t01_request_interventions_org
  before insert or update on public.request_interventions
  for each row execute function public.satellite_check_request_org();

drop trigger if exists t02_request_interventions_updated_at on public.request_interventions;
create trigger t02_request_interventions_updated_at
  before update on public.request_interventions
  for each row execute function public.set_updated_at();

alter table public.request_interventions enable row level security;

-- ----------------------------------------------------------------------------
-- 3. Visibilité
-- ----------------------------------------------------------------------------

-- Demandes ouvertes à l'utilisateur COURANT par une sollicitation. DEFINER :
-- lue hors RLS, donc aucune récursion requests → request_interventions →
-- requests. Sous-requête NON corrélée dans la policy (hashed SubPlan, même
-- motif que my_permission_pairs).
create or replace function public.my_intervention_request_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct i.request_id
    from public.request_interventions i
   where i.intervenant_id = auth.uid();
$$;
comment on function public.my_intervention_request_ids() is
  'Demandes sur lesquelles l''utilisateur courant a été sollicité comme intervenant (toutes, réalisées comprises). Utilisée par requests_select.';
revoke execute on function public.my_intervention_request_ids() from public, anon;
grant  execute on function public.my_intervention_request_ids() to authenticated;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests
  for select to authenticated
  using (
    (select public.is_platform_admin())
    or (organization_id, socle_scope_org_id, coalesce(socle_procedure_id, public.nil_procedure()))
       in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
             from public.my_permission_pairs('consultation') s)
    or id in (select public.my_intervention_request_ids())
  );

-- Consultation PAR COUPLE, sans la sollicitation : garde des notes internes et
-- des échanges. C'est l'ancienne définition de can_read_request, renommée.
create or replace function public.can_consult_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select public.is_platform_admin()) or exists (
    select 1 from public.requests r
     where r.id = p_request_id
       and (r.organization_id, r.socle_scope_org_id,
            coalesce(r.socle_procedure_id, public.nil_procedure()))
           in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                 from public.my_permission_pairs('consultation') s)
  );
$$;
comment on function public.can_consult_request(uuid) is
  'Droit de CONSULTATION par couple (organisation porteuse, démarche) sur une demande — SANS la visibilité ouverte par une sollicitation d''intervenant. Garde des notes internes et des échanges.';
revoke execute on function public.can_consult_request(uuid) from public, anon;
grant  execute on function public.can_consult_request(uuid) to authenticated;

-- can_read_request : consultation OU sollicitation. Sert aux policies storage
-- (URL signée d'une pièce) et aux RPC de lecture (eligible_assignees,
-- mentionable_users…) : ce qu'ouvre la fiche, la pièce l'ouvre aussi.
create or replace function public.can_read_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_consult_request(p_request_id)
      or exists (select 1 from public.request_interventions i
                  where i.request_id = p_request_id and i.intervenant_id = auth.uid());
$$;
comment on function public.can_read_request(uuid) is
  'Lecture d''une demande : consultation par couple OU sollicitation comme intervenant. Enveloppe des policies storage et des RPC de lecture.';
revoke execute on function public.can_read_request(uuid) from public, anon;
grant  execute on function public.can_read_request(uuid) to authenticated;

-- Notes internes et échanges : instruction seulement, pas l'intervenant.
drop policy if exists request_messages_select on public.request_messages;
create policy request_messages_select on public.request_messages
  for select to authenticated
  using (public.can_consult_request(request_messages.request_id));

drop policy if exists request_emails_select on public.request_emails;
create policy request_emails_select on public.request_emails
  for select to authenticated
  using (public.can_consult_request(request_emails.request_id));

-- request_interventions : lisible par qui lit la demande (l'intervenant est
-- couvert par requests_select) ; AUCUNE écriture cliente.
drop policy if exists request_interventions_select on public.request_interventions;
create policy request_interventions_select on public.request_interventions
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_interventions.request_id));

drop policy if exists request_interventions_service on public.request_interventions;
create policy request_interventions_service on public.request_interventions
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 4. Motifs de notification
-- ----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned','unassigned','status_changed','note_added',
                  'new_request_in_scope','mentioned','transferred_in',
                  'intervention_requested','intervention_completed'));

alter table public.notification_preferences drop constraint if exists notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('*','assigned','unassigned','status_changed','note_added',
                  'new_request_in_scope','mentioned','transferred_in',
                  'intervention_requested','intervention_completed'));

-- ----------------------------------------------------------------------------
-- 5. RPC
-- ----------------------------------------------------------------------------

-- Jour courant vu de France : les dates saisies le sont par un agent en France,
-- le serveur tourne en UTC.
create or replace function public.paris_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Paris')::date;
$$;
revoke execute on function public.paris_today() from public, anon, authenticated;

-- Intervenants sollicitables sur une demande : profil actif `is_intervenant`
-- couvrant l'organisation porteuse. Exige de pouvoir lire la demande.
create or replace function public.eligible_intervenants(p_request_id uuid)
returns table (user_id uuid, display_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_scope uuid;
begin
  if not public.can_read_request(p_request_id) then
    raise exception 'Demande introuvable.';
  end if;
  select r.organization_id, r.socle_scope_org_id into v_org, v_scope
    from public.requests r where r.id = p_request_id;

  return query
    select m.user_id, public.user_display_name(u.id), u.email
      from public.organization_members m
      join public.users u on u.id = m.user_id
     where m.organization_id = v_org
       and public.is_intervenant_for(m.user_id, v_org, v_scope)
     order by 2;
end;
$$;
comment on function public.eligible_intervenants(uuid) is
  'Membres du tenant sollicitables comme intervenant sur la demande (profil actif is_intervenant dont le périmètre couvre l''organisation porteuse). Alimente le sélecteur de sollicitation.';
revoke execute on function public.eligible_intervenants(uuid) from public, anon;
grant  execute on function public.eligible_intervenants(uuid) to authenticated;

-- Solliciter. Gardes SERVEUR : instruction sur le couple, statut
-- « en_instruction », intervenant éligible, date non passée, commentaire
-- non vide, pas de doublon en attente pour le même intervenant.
create or replace function public.request_intervention(
  p_request_id uuid, p_intervenant_id uuid, p_requested_for date, p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  r         public.requests%rowtype;
  v_id      uuid;
  v_comment text := btrim(coalesce(p_comment, ''));
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select * into r from public.requests where id = p_request_id;
  if not found then
    raise exception 'Demande introuvable.';
  end if;

  if not public.request_right_for(v_uid, r.organization_id, r.socle_organization_id,
                                  r.socle_procedure_id, 'instruction') then
    raise exception 'Solliciter un intervenant exige le droit d''instruction sur cette démarche pour ce service.';
  end if;

  if r.status <> 'en_instruction' then
    raise exception 'Une intervention ne se sollicite que sur une demande en cours d''instruction.';
  end if;

  if p_intervenant_id is null then
    raise exception 'Sollicitation : intervenant obligatoire.';
  end if;
  if not public.is_intervenant_for(p_intervenant_id, r.organization_id, r.socle_scope_org_id) then
    raise exception 'Cette personne n''est pas intervenant sur l''organisme de la demande.';
  end if;

  if p_requested_for is null then
    raise exception 'Sollicitation : date d''intervention demandée obligatoire.';
  end if;
  if p_requested_for < public.paris_today() then
    raise exception 'La date d''intervention demandée ne peut pas être passée.';
  end if;

  if v_comment = '' then
    raise exception 'Sollicitation : indiquez à l''intervenant ce qui est attendu.';
  end if;

  if exists (select 1 from public.request_interventions i
              where i.request_id = p_request_id
                and i.intervenant_id = p_intervenant_id
                and i.status = 'demandee') then
    raise exception 'Cet intervenant a déjà une intervention en attente sur cette demande.';
  end if;

  insert into public.request_interventions
    (organization_id, request_id, intervenant_id, requested_by, requested_for, request_comment)
  values (r.organization_id, p_request_id, p_intervenant_id, v_uid, p_requested_for, v_comment)
  returning id into v_id;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (r.organization_id, p_request_id, 'intervention_requested',
          jsonb_build_object(
            'intervention_id', v_id,
            'intervenant', p_intervenant_id,
            'intervenant_name', public.user_display_name(p_intervenant_id),
            'requested_for', p_requested_for),
          v_uid);

  -- L'e-mail demandé : gabarit agent, boîte d'envoi drainée par le cron.
  -- Le commentaire y figure : il est écrit POUR l'intervenant, c'est la
  -- consigne. Le demandeur, lui, n'y figure pas (règle commune des e-mails).
  perform public.push_notification(
    p_intervenant_id, v_uid, r.organization_id, p_request_id, 'intervention_requested',
    r.reference, r.subject,
    jsonb_build_object(
      'status', r.status,
      'procedure', r.socle_procedure_label,
      'destinataire', r.socle_organization_label,
      'intervention_id', v_id,
      'requested_for', p_requested_for,
      'comment', v_comment));

  return jsonb_build_object('id', v_id);
end;
$$;
comment on function public.request_intervention(uuid, uuid, date, text) is
  'Sollicite un intervenant sur une demande EN COURS D''INSTRUCTION (garde serveur). Exige l''instruction sur le couple. Journalise (intervention_requested) et notifie l''intervenant (volet + e-mail). Unique porte d''écriture avec complete_request_intervention.';
revoke execute on function public.request_intervention(uuid, uuid, date, text) from public, anon;
grant  execute on function public.request_intervention(uuid, uuid, date, text) to authenticated;

-- Déclarer réalisée. Réservée à l'INTERVENANT sollicité (admin plateforme
-- compris, RM-24). Date de finalisation non future ; commentaire facultatif.
create or replace function public.complete_request_intervention(
  p_intervention_id uuid, p_completed_on date, p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  i         public.request_interventions%rowtype;
  r         public.requests%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_name    text;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select * into i from public.request_interventions where id = p_intervention_id;
  if not found then
    raise exception 'Intervention introuvable.';
  end if;
  if i.intervenant_id <> v_uid and not public.is_platform_admin() then
    raise exception 'Seul l''intervenant sollicité peut déclarer cette intervention réalisée.';
  end if;
  if i.status <> 'demandee' then
    raise exception 'Cette intervention est déjà déclarée réalisée.';
  end if;

  if p_completed_on is null then
    raise exception 'Date de finalisation obligatoire.';
  end if;
  if p_completed_on > public.paris_today() then
    raise exception 'La date de finalisation ne peut pas être future.';
  end if;

  update public.request_interventions
     set status = 'realisee', completed_at = now(),
         completed_on = p_completed_on, completion_comment = v_comment
   where id = p_intervention_id;

  select * into r from public.requests where id = i.request_id;
  v_name := public.user_display_name(i.intervenant_id);

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (r.organization_id, r.id, 'intervention_completed',
          jsonb_build_object(
            'intervention_id', i.id,
            'intervenant', i.intervenant_id,
            'intervenant_name', v_name,
            'completed_on', p_completed_on),
          v_uid);

  -- À qui a sollicité, et à l'affectataire si c'est quelqu'un d'autre.
  -- push_notification se tait pour l'auteur du geste et pour un NULL.
  perform public.push_notification(
    i.requested_by, v_uid, r.organization_id, r.id, 'intervention_completed',
    r.reference, r.subject,
    jsonb_build_object(
      'status', r.status,
      'procedure', r.socle_procedure_label,
      'destinataire', r.socle_organization_label,
      'intervention_id', i.id,
      'intervenant_name', v_name,
      'completed_on', p_completed_on,
      'comment', v_comment));
  if r.assigned_to is distinct from i.requested_by then
    perform public.push_notification(
      r.assigned_to, v_uid, r.organization_id, r.id, 'intervention_completed',
      r.reference, r.subject,
      jsonb_build_object(
        'status', r.status,
        'procedure', r.socle_procedure_label,
        'destinataire', r.socle_organization_label,
        'intervention_id', i.id,
        'intervenant_name', v_name,
        'completed_on', p_completed_on,
        'comment', v_comment));
  end if;

  return jsonb_build_object('id', i.id, 'completed_on', p_completed_on);
end;
$$;
comment on function public.complete_request_intervention(uuid, date, text) is
  'L''intervenant sollicité déclare son intervention réalisée (date de finalisation, commentaire facultatif). Journalise (intervention_completed) et notifie l''agent qui a sollicité et l''affectataire.';
revoke execute on function public.complete_request_intervention(uuid, date, text) from public, anon;
grant  execute on function public.complete_request_intervention(uuid, date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. my_rights — expose l'attribut (par profil, et « quelque part » en tête)
-- ----------------------------------------------------------------------------
create or replace function public.my_rights(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'Ressource introuvable.';
  end if;
  select jsonb_build_object(
    'organization_id', p_org_id,
    'is_platform_admin', public.is_platform_admin(),
    'is_admin', public.is_org_admin_anywhere(p_org_id),
    'is_intervenant', exists (
      select 1 from public.permission_profile_assignments a
        join public.permission_profiles p
          on p.id = a.profile_id and p.status = 'active' and p.is_intervenant
       where a.user_id = auth.uid() and a.organization_id = p_org_id),
    'no_procedure_id', public.nil_procedure(),
    'profiles', coalesce(jsonb_agg(x.profile order by x.name), '[]'::jsonb)
  ) into v
  from (
    select p.name, jsonb_build_object(
      'id', p.id, 'name', p.name, 'status', p.status, 'is_admin', p.is_admin,
      'is_intervenant', p.is_intervenant,
      'scope_organization_ids', (
        select coalesce(jsonb_agg(distinct t.socle_org_id), '[]'::jsonb)
          from public.permission_profile_scope(p.id) t),
      'procedures', (
        select coalesce(jsonb_object_agg(pp.socle_procedure_id, public.rights_array(
                 pp.right_view, pp.right_create, pp.right_process, pp.right_close)), '{}'::jsonb)
          from public.permission_profile_procedures pp where pp.profile_id = p.id),
      'default', public.rights_array(p.default_view, p.default_create,
                                     p.default_process, p.default_close)
    ) as profile
    from public.permission_profiles p
    join public.permission_profile_assignments a on a.profile_id = p.id and a.user_id = auth.uid()
   where p.organization_id = p_org_id
  ) x;
  return v;
end;
$$;
revoke execute on function public.my_rights(uuid) from public, anon;
grant  execute on function public.my_rights(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. save_permission_profile — accepte `is_intervenant` (payload, colonne,
--    journal). Corps identique à 20260822100400 hors ces lignes.
-- ----------------------------------------------------------------------------
create or replace function public.save_permission_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id               uuid := nullif(p ->> 'profile_id', '')::uuid;
  v_org              uuid := (p ->> 'organization_id')::uuid;
  v_name             text := btrim(coalesce(p ->> 'name', ''));
  v_description      text := nullif(p ->> 'description', '');
  v_is_admin         boolean := coalesce((p ->> 'is_admin')::boolean, false);
  v_is_intervenant   boolean := coalesce((p ->> 'is_intervenant')::boolean, false);
  v_default_rights   text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'default_rights', '[]'::jsonb))), '{}');
  v_organizations    uuid[] := coalesce(array(select (jsonb_array_elements_text(coalesce(p -> 'organizations', '[]'::jsonb)))::uuid), '{}');
  v_procedures       jsonb  := coalesce(p -> 'procedures', '[]'::jsonb);
  v_expected_version int    := nullif(p ->> 'expected_version', '')::int;
  v_current_version  int;
  v_default_view boolean; v_default_create boolean; v_default_process boolean; v_default_close boolean;
  v_has_right   boolean;
  v_before jsonb; v_after jsonb; v_action text;
  v_item jsonb; v_rights text[]; v_view boolean; v_create boolean; v_process boolean; v_close boolean;
  v_socle_org uuid; v_right text;
  v_pre text[] := array(
    select r.code || '|' || y.organization_id || '|' || y.socle_org_id || '|' || y.socle_procedure_id
      from unnest(array['consultation','creation','instruction','cloture']) r(code),
      lateral public.my_permission_pairs(r.code) y
  );
begin
  if v_org is null then
    raise exception 'organization_id manquant.';
  end if;
  if v_name = '' then
    raise exception 'Le nom du profil est obligatoire.';
  end if;
  if array_length(v_organizations, 1) is null or array_length(v_organizations, 1) = 0 then
    raise exception 'Sélectionnez au moins une organisation.';
  end if;

  if not public.is_org_admin_anywhere(v_org) then
    raise exception 'Accès réservé aux administrateurs.';
  end if;
  foreach v_socle_org in array v_organizations loop
    if not public.has_admin_scope(v_org, v_socle_org) then
      raise exception 'Votre périmètre d''administration ne couvre pas l''organisation %.',
        coalesce((select m.name from public.socle_organizations m
                   where m.organization_id = v_org and m.socle_id = v_socle_org),
                 v_socle_org::text);
    end if;
  end loop;

  v_default_view    := coalesce(array_length(v_default_rights, 1), 0) > 0;
  v_default_create  := 'creation'    = any(v_default_rights);
  v_default_process := 'instruction' = any(v_default_rights);
  v_default_close   := 'cloture'     = any(v_default_rights);

  select v_default_view or exists (
    select 1 from jsonb_array_elements(v_procedures) e
     where jsonb_array_length(coalesce(e -> 'rights', '[]'::jsonb)) > 0
  ) into v_has_right;
  if not v_is_admin and not v_is_intervenant and not v_has_right then
    raise exception 'Ce profil n''accorderait aucun droit.';
  end if;

  if v_id is not null then
    select version, jsonb_build_object(
             'name', name, 'description', description, 'is_admin', is_admin,
             'is_intervenant', is_intervenant, 'status', status,
             'default_rights', public.rights_array(default_view, default_create, default_process, default_close),
             'organizations', (select coalesce(jsonb_agg(socle_org_id), '[]'::jsonb)
                                  from public.permission_profile_organizations where profile_id = v_id),
             'procedures', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', socle_procedure_id,
                                'rights', public.rights_array(right_view, right_create, right_process, right_close))), '[]'::jsonb)
                               from public.permission_profile_procedures where profile_id = v_id))
      into v_current_version, v_before
      from public.permission_profiles where id = v_id and organization_id = v_org;
    if v_current_version is null then
      raise exception 'Profil de droits introuvable.';
    end if;

    perform public.assert_editor_can_manage_profile(v_org, v_id);

    if v_expected_version is null or v_expected_version <> v_current_version then
      raise exception 'Ce profil a été modifié entre-temps par quelqu''un d''autre ; rechargez avant de réessayer.';
    end if;

    update public.permission_profiles
       set name = v_name, description = v_description, is_admin = v_is_admin,
           is_intervenant = v_is_intervenant,
           default_view = v_default_view, default_create = v_default_create,
           default_process = v_default_process, default_close = v_default_close,
           version = version + 1, updated_at = now(), updated_by = auth.uid()
     where id = v_id
     returning version into v_current_version;

    delete from public.permission_profile_organizations where profile_id = v_id;
    delete from public.permission_profile_procedures where profile_id = v_id;
    v_action := 'profile_updated';
  else
    insert into public.permission_profiles (
      organization_id, name, description, is_admin, is_intervenant,
      default_view, default_create, default_process, default_close,
      created_by, updated_by
    ) values (
      v_org, v_name, v_description, v_is_admin, v_is_intervenant,
      v_default_view, v_default_create, v_default_process, v_default_close,
      auth.uid(), auth.uid()
    ) returning id, version into v_id, v_current_version;
    v_before := null;
    v_action := 'profile_created';
  end if;

  insert into public.permission_profile_organizations (profile_id, socle_org_id)
  select distinct v_id, x from unnest(v_organizations) as x;

  for v_item in select * from jsonb_array_elements(v_procedures) loop
    v_rights  := array(select jsonb_array_elements_text(coalesce(v_item -> 'rights', '[]'::jsonb)));
    v_view    := coalesce(array_length(v_rights, 1), 0) > 0;
    v_create  := 'creation'    = any(v_rights);
    v_process := 'instruction' = any(v_rights);
    v_close   := 'cloture'     = any(v_rights);
    insert into public.permission_profile_procedures
      (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values
      (v_id, (v_item ->> 'id')::uuid, v_view, v_create, v_process, v_close)
    on conflict (profile_id, socle_procedure_id) do update
      set right_view = excluded.right_view, right_create = excluded.right_create,
          right_process = excluded.right_process, right_close = excluded.right_close;
  end loop;

  perform public.validate_permission_profile_shape(v_id);

  if not public.is_platform_admin() then
    foreach v_right in array array['consultation','creation','instruction','cloture'] loop
      if exists (
        select 1 from public.permission_pairs_of(array[v_id], v_right, v_org) x
         where not ((v_right || '|' || x.organization_id || '|' || x.socle_org_id || '|' || x.socle_procedure_id) = any(v_pre))
      ) then
        raise exception 'Ce profil accorderait le droit « % » que vous ne détenez pas vous-même sur tout son périmètre.', v_right;
      end if;
    end loop;
  end if;

  perform public.assert_tenant_keeps_root_admin(v_org);

  v_after := jsonb_build_object(
    'name', v_name, 'description', v_description, 'is_admin', v_is_admin,
    'is_intervenant', v_is_intervenant,
    'default_rights', public.rights_array(v_default_view, v_default_create, v_default_process, v_default_close),
    'organizations', to_jsonb(v_organizations),
    'procedures', v_procedures
  );
  insert into public.permission_audit_log
    (organization_id, actor_id, action, profile_id, profile_name, before, after)
  values (v_org, auth.uid(), v_action, v_id, v_name, v_before, v_after);

  perform public.refresh_member_roles(v_org);

  return jsonb_build_object('id', v_id, 'version', v_current_version);
end;
$$;
revoke execute on function public.save_permission_profile(jsonb) from public, anon;
grant  execute on function public.save_permission_profile(jsonb) to authenticated;
