-- ============================================================================
-- Demandes liées — fondations (lot L1 de docs/demandes-liees.md)
--
-- Plusieurs habitants signalent le même incident : l'agent lie leurs demandes
-- en un GROUPE (« même incident », sans demande principale — décision PO
-- 2026-10-16), puis pourra les résoudre ensemble (lot L3).
--
--   1. procedure_link_settings — les démarches MUTUALISABLES, réglées par un
--      administrateur. Hors d'elles, ni recherche, ni groupe : une carte de
--      déchetterie accordée à l'un n'en accorde pas une à l'autre.
--   2. request_groups / request_group_members — une demande appartient à UN
--      groupe au plus ; lier deux groupes les FUSIONNE. Aucune colonne ajoutée
--      à `requests` : les gardes d'édition de requests_guard_write restent
--      intactes.
--   3. request_locations — le lieu d'intervention RECOPIÉ DU FORMULAIRE (point
--      déclaré du champ `location`, ou adresse de l'ancien bloc), pour que la
--      recherche de demandes approchantes (lot L2) soit indexée côté serveur.
--      ⚠️ Iris ne géocode JAMAIS pour stocker : rien ici n'est calculé, tout
--      est lu dans `form_data`.
--   4. RPC save_procedure_link_settings, link_requests, unlink_request — seules
--      portes d'écriture (aucune policy d'écriture cliente).
--
-- ⚠️ Les RPC sont SECURITY DEFINER : `is_service_context()` y vaudrait toujours
-- vrai (CLAUDE.md, pièges). Les droits y sont revérifiés par `auth.uid()` et
-- `request_right_for`, jamais par le contexte.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Démarches mutualisables
-- ----------------------------------------------------------------------------
create table if not exists public.procedure_link_settings (
  organization_id    uuid not null references public.organizations(id) on delete restrict,
  socle_procedure_id uuid not null,
  enabled            boolean not null default false,
  radius_m           integer not null default 150 check (radius_m between 10 and 5000),
  window_days        integer not null default 60  check (window_days between 1 and 365),
  updated_by         uuid references public.users(id),
  updated_at         timestamptz not null default now(),
  primary key (organization_id, socle_procedure_id)
);

alter table public.procedure_link_settings enable row level security;

drop policy if exists procedure_link_settings_select on public.procedure_link_settings;
create policy procedure_link_settings_select on public.procedure_link_settings
  for select to authenticated using (public.is_org_member(organization_id));

-- La démarche est-elle mutualisable dans ce tenant ? (Lue par les RPC ; INVOKER,
-- la table est de toute façon lisible par tout membre.)
create or replace function public.procedure_linkable(p_org_id uuid, p_procedure_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select s.enabled from public.procedure_link_settings s
     where s.organization_id = p_org_id and s.socle_procedure_id = p_procedure_id
  ), false);
$$;
revoke execute on function public.procedure_linkable(uuid, uuid) from public, anon;
grant execute on function public.procedure_linkable(uuid, uuid) to authenticated, service_role;

create or replace function public.save_procedure_link_settings(
  p_org_id uuid, p_procedure_id uuid, p_enabled boolean,
  p_radius_m integer default 150, p_window_days integer default 60)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_root uuid;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  select o.socle_org_id into v_root from public.organizations o where o.id = p_org_id;
  if v_root is null then
    raise exception 'Tenant introuvable.';
  end if;
  -- Une démarche appartient à la RACINE du référentiel : la rendre mutualisable
  -- est une décision sur toute la collectivité.
  if not public.has_admin_scope(p_org_id, v_root) then
    raise exception 'Régler les demandes liées exige l''administration de l''organisation principale.';
  end if;
  if not exists (select 1 from public.socle_procedure_cache c
                  where c.organization_id = p_org_id and c.socle_id = p_procedure_id) then
    raise exception 'Démarche inconnue du référentiel du tenant.';
  end if;
  if p_enabled is null then
    raise exception 'Demandes liées : état obligatoire.';
  end if;
  if coalesce(p_radius_m, 0) not between 10 and 5000 then
    raise exception 'Demandes liées : le rayon doit être compris entre 10 et 5 000 mètres.';
  end if;
  if coalesce(p_window_days, 0) not between 1 and 365 then
    raise exception 'Demandes liées : la fenêtre doit être comprise entre 1 et 365 jours.';
  end if;

  insert into public.procedure_link_settings as s
    (organization_id, socle_procedure_id, enabled, radius_m, window_days, updated_by, updated_at)
  values (p_org_id, p_procedure_id, p_enabled, p_radius_m, p_window_days, v_uid, now())
  on conflict (organization_id, socle_procedure_id) do update
    set enabled = excluded.enabled, radius_m = excluded.radius_m,
        window_days = excluded.window_days, updated_by = v_uid, updated_at = now();

  return jsonb_build_object('enabled', p_enabled, 'radius_m', p_radius_m, 'window_days', p_window_days);
end;
$$;
revoke execute on function public.save_procedure_link_settings(uuid, uuid, boolean, integer, integer)
  from public, anon;
grant execute on function public.save_procedure_link_settings(uuid, uuid, boolean, integer, integer)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Groupes de demandes liées
-- ----------------------------------------------------------------------------
create table if not exists public.request_groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now()
);

create table if not exists public.request_group_members (
  group_id        uuid not null references public.request_groups(id) on delete cascade,
  -- CASCADE : la purge RGPD (service_role) reste possible ; aucune policy DELETE
  -- n'existe sur `requests`, l'invariant « aucune suppression » est ailleurs.
  request_id      uuid not null unique references public.requests(id) on delete cascade,
  organization_id uuid not null,
  added_by        uuid references public.users(id),
  added_at        timestamptz not null default now(),
  primary key (group_id, request_id)
);
create index if not exists request_group_members_org_idx on public.request_group_members (organization_id);

alter table public.request_groups enable row level security;
alter table public.request_group_members enable row level security;

-- Un agent ne voit d'un groupe QUE les membres qu'il peut consulter : aucun
-- compteur de demandes invisibles (ce serait une fuite).
drop policy if exists request_group_members_select on public.request_group_members;
create policy request_group_members_select on public.request_group_members
  for select to authenticated using (public.can_consult_request(request_id));

drop policy if exists request_groups_select on public.request_groups;
create policy request_groups_select on public.request_groups
  for select to authenticated using (exists (
    select 1 from public.request_group_members m
     where m.group_id = request_groups.id and public.can_consult_request(m.request_id)));

-- ----------------------------------------------------------------------------
-- 3. Lieu d'intervention recopié du formulaire
-- ----------------------------------------------------------------------------
create table if not exists public.request_locations (
  request_id      uuid primary key references public.requests(id) on delete cascade,
  organization_id uuid not null,
  lat             double precision,
  lon             double precision,
  address_norm    text,
  updated_at      timestamptz not null default now(),
  check ((lat is null) = (lon is null)),
  check (lat is null or (lat between -90 and 90 and lon between -180 and 180)),
  check (lat is not null or address_norm is not null)
);
create index if not exists request_locations_point_idx
  on public.request_locations (organization_id, lat, lon) where lat is not null;
create index if not exists request_locations_address_trgm_idx
  on public.request_locations using gin (address_norm extensions.gin_trgm_ops)
  where address_norm is not null;

alter table public.request_locations enable row level security;
drop policy if exists request_locations_select on public.request_locations;
create policy request_locations_select on public.request_locations
  for select to authenticated using (public.can_consult_request(request_id));

-- Normalisation d'une adresse pour la comparaison (minuscules, sans accents,
-- espaces réduits). Même normalisation que la recherche globale.
create or replace function public.normalize_address(p_text text)
returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(public.immutable_unaccent(lower(coalesce(p_text, ''))),
                                     '[^a-z0-9]+', ' ', 'g')), '');
$$;
revoke execute on function public.normalize_address(text) from public, anon;
grant execute on function public.normalize_address(text) to authenticated, service_role;

-- Une valeur de lieu du formulaire → (lat, lon, adresse). Parité avec
-- `parseLocationValue` (procedureForm.ts) : objet {address, lat, lon} — lat et
-- lon ensemble ou pas du tout —, ou chaîne nue élevée en adresse sans point.
create or replace function public.location_value_parts(p_value jsonb,
  out lat double precision, out lon double precision, out address text)
language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(jsonb_typeof(p_value), '') = 'string' then
    address := nullif(btrim(p_value #>> '{}'), '');
    return;
  end if;
  if coalesce(jsonb_typeof(p_value), '') <> 'object' then
    return;
  end if;
  if coalesce(jsonb_typeof(p_value -> 'address'), '') = 'string' then
    address := nullif(btrim(p_value ->> 'address'), '');
  end if;
  if coalesce(jsonb_typeof(p_value -> 'lat'), '') = 'number'
     and coalesce(jsonb_typeof(p_value -> 'lon'), '') = 'number' then
    lat := (p_value ->> 'lat')::double precision;
    lon := (p_value ->> 'lon')::double precision;
    if lat not between -90 and 90 or lon not between -180 and 180 then
      lat := null; lon := null;
    end if;
  end if;
end;
$$;
revoke execute on function public.location_value_parts(jsonb) from public, anon;

-- Le lieu d'intervention d'une demande, LU dans son formulaire, en cascade
-- (parité avec `instruction/lieu.ts` › `fromRawData`, réduite au nécessaire) :
--   1. le premier champ de type `location` du schéma figé (clé par
--      `form_data_key`, reconnu par son TYPE, jamais par sa clé) ;
--   2. la clé par défaut `intervention_lieu` (snapshot dégradé) ;
--   3. les clés de l'ancien bloc « Lieu d'intervention » — adresse sans point.
-- ⚠️ L'ancien bloc à clés vides (`key: ""` du builder Socle, indexé par id) et
-- mappé par libellé n'est PAS reconnu ici : ces demandes n'auront pas de lieu
-- comparable, la recherche se rabattra sur le texte. Sens de dégradation voulu :
-- moins de candidats, jamais un faux lieu.
create or replace function public.request_location_of(p_form_schema jsonb, p_form_data jsonb,
  out lat double precision, out lon double precision, out address text)
language plpgsql immutable set search_path = '' as $$
declare
  v_data    jsonb := case when coalesce(jsonb_typeof(p_form_data), '') = 'object'
                          then p_form_data else '{}'::jsonb end;
  v_content jsonb := coalesce(public.form_schema_content(p_form_schema), '[]'::jsonb);
  n jsonb;
  f jsonb;
  p record;
begin
  for n in select * from jsonb_array_elements(v_content) loop
    for f in
      select * from jsonb_array_elements(
        case when n -> 'kind' = '"section"'::jsonb
              and coalesce(jsonb_typeof(n -> 'fields'), '') = 'array'
             then n -> 'fields'
             else jsonb_build_array(n) end)
    loop
      if f ->> 'type' = 'location' then
        select * into p from public.location_value_parts(v_data -> public.form_data_key(f));
        if p.lat is not null or p.address is not null then
          lat := p.lat; lon := p.lon; address := p.address;
          return;
        end if;
      end if;
    end loop;
  end loop;

  select * into p from public.location_value_parts(v_data -> 'intervention_lieu');
  if p.lat is not null or p.address is not null then
    lat := p.lat; lon := p.lon; address := p.address;
    return;
  end if;

  if nullif(btrim(coalesce(v_data ->> 'intervention_voie', '')), '') is not null then
    address := concat_ws(' ',
      nullif(btrim(coalesce(v_data ->> 'intervention_numero', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'intervention_btq', '')), ''),
      btrim(v_data ->> 'intervention_voie'),
      nullif(btrim(coalesce(v_data ->> 'intervention_code_postal', '')), ''),
      nullif(btrim(coalesce(v_data ->> 'intervention_ville', '')), ''));
  end if;
end;
$$;
revoke execute on function public.request_location_of(jsonb, jsonb) from public, anon;

create or replace function public.requests_location_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p      record;
  v_norm text;
begin
  select * into p from public.request_location_of(new.procedure_snapshot -> 'form_schema', new.form_data);
  v_norm := public.normalize_address(p.address);
  if p.lat is null and v_norm is null then
    delete from public.request_locations where request_id = new.id;
  else
    insert into public.request_locations as l (request_id, organization_id, lat, lon, address_norm, updated_at)
    values (new.id, new.organization_id, p.lat, p.lon, v_norm, now())
    on conflict (request_id) do update
      set lat = excluded.lat, lon = excluded.lon, address_norm = excluded.address_norm,
          organization_id = excluded.organization_id, updated_at = now();
  end if;
  return null;
end;
$$;
revoke execute on function public.requests_location_sync() from public, anon, authenticated;

drop trigger if exists t32_requests_location_sync on public.requests;
create trigger t32_requests_location_sync
  after insert or update of form_data, procedure_snapshot on public.requests
  for each row execute function public.requests_location_sync();

-- Reprise des demandes existantes.
insert into public.request_locations (request_id, organization_id, lat, lon, address_norm)
select r.id, r.organization_id, l.lat, l.lon, public.normalize_address(l.address)
  from public.requests r
  cross join lateral public.request_location_of(r.procedure_snapshot -> 'form_schema', r.form_data) l
 where l.lat is not null or public.normalize_address(l.address) is not null
on conflict (request_id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Liaison
-- ----------------------------------------------------------------------------
-- Taille maximale d'un groupe : au-delà, ce n'est plus « un incident signalé
-- par plusieurs habitants » mais un regroupement de gestion, hors de ce geste.
create or replace function public.request_group_max_size()
returns integer language sql immutable set search_path = '' as $$ select 200 $$;

create or replace function public.link_requests(p_a uuid, p_b uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  a      record;
  b      record;
  v_ga   uuid;
  v_gb   uuid;
  v_g    uuid;
  v_size integer;
  v_merged boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'Lier : deux demandes distinctes sont nécessaires.';
  end if;

  select r.id, r.organization_id, r.socle_organization_id, r.socle_procedure_id, r.reference
    into a from public.requests r where r.id = p_a;
  select r.id, r.organization_id, r.socle_organization_id, r.socle_procedure_id, r.reference
    into b from public.requests r where r.id = p_b;
  if a.id is null or b.id is null then
    raise exception 'Lier : demande introuvable.';
  end if;
  if a.organization_id is distinct from b.organization_id then
    raise exception 'Lier : demande introuvable.';  -- jamais « autre tenant » : l'isolation ne se raconte pas
  end if;

  -- Droit : ÉCRIRE sur l'une, CONSULTER l'autre — miroir de la règle de
  -- request_links. Consulter les deux est exigé dans tous les cas.
  if not (
       (public.request_right_for(v_uid, a.organization_id, a.socle_organization_id, a.socle_procedure_id, 'ecriture')
        and public.request_right_for(v_uid, b.organization_id, b.socle_organization_id, b.socle_procedure_id, 'consultation'))
    or (public.request_right_for(v_uid, b.organization_id, b.socle_organization_id, b.socle_procedure_id, 'ecriture')
        and public.request_right_for(v_uid, a.organization_id, a.socle_organization_id, a.socle_procedure_id, 'consultation'))
  ) then
    raise exception 'Lier ces demandes exige un droit de création ou d''instruction sur l''une et la consultation de l''autre.';
  end if;

  if a.socle_procedure_id is null or b.socle_procedure_id is null
     or not public.procedure_linkable(a.organization_id, a.socle_procedure_id)
     or not public.procedure_linkable(b.organization_id, b.socle_procedure_id) then
    raise exception 'Lier : la démarche de chaque demande doit être déclarée mutualisable.';
  end if;

  -- Un groupe se crée, s'étend ou fusionne : sérialiser par tenant suffit et
  -- évite qu'une demande atterrisse dans deux groupes en course.
  perform pg_advisory_xact_lock(hashtextextended('request_groups:' || a.organization_id::text, 0));

  select m.group_id into v_ga from public.request_group_members m where m.request_id = a.id;
  select m.group_id into v_gb from public.request_group_members m where m.request_id = b.id;

  if v_ga is not null and v_ga = v_gb then
    return jsonb_build_object('group_id', v_ga, 'changed', false);
  end if;

  if v_ga is null and v_gb is null then
    insert into public.request_groups (organization_id, created_by)
      values (a.organization_id, v_uid) returning id into v_g;
    insert into public.request_group_members (group_id, request_id, organization_id, added_by)
      values (v_g, a.id, a.organization_id, v_uid), (v_g, b.id, b.organization_id, v_uid);
  elsif v_ga is not null and v_gb is not null then
    v_g := v_ga;
    select count(*) into v_size from public.request_group_members m where m.group_id in (v_ga, v_gb);
    if v_size > public.request_group_max_size() then
      raise exception 'Lier : un groupe ne peut pas dépasser % demandes.', public.request_group_max_size();
    end if;
    update public.request_group_members set group_id = v_ga where group_id = v_gb;
    delete from public.request_groups where id = v_gb;
    v_merged := true;
  else
    v_g := coalesce(v_ga, v_gb);
    select count(*) into v_size from public.request_group_members m where m.group_id = v_g;
    if v_size + 1 > public.request_group_max_size() then
      raise exception 'Lier : un groupe ne peut pas dépasser % demandes.', public.request_group_max_size();
    end if;
    insert into public.request_group_members (group_id, request_id, organization_id, added_by)
      values (v_g, case when v_ga is null then a.id else b.id end, a.organization_id, v_uid);
  end if;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by) values
    (a.organization_id, a.id, 'request_linked',
     jsonb_build_object('group_id', v_g, 'with_request_id', b.id, 'with_reference', b.reference, 'merged', v_merged), v_uid),
    (b.organization_id, b.id, 'request_linked',
     jsonb_build_object('group_id', v_g, 'with_request_id', a.id, 'with_reference', a.reference, 'merged', v_merged), v_uid);

  return jsonb_build_object('group_id', v_g, 'changed', true, 'merged', v_merged);
end;
$$;
revoke execute on function public.link_requests(uuid, uuid) from public, anon;
grant execute on function public.link_requests(uuid, uuid) to authenticated;

create or replace function public.unlink_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  r       record;
  v_g     uuid;
  v_left  uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  select q.id, q.organization_id, q.socle_organization_id, q.socle_procedure_id
    into r from public.requests q where q.id = p_request_id;
  if r.id is null then
    raise exception 'Délier : demande introuvable.';
  end if;
  if not public.request_right_for(v_uid, r.organization_id, r.socle_organization_id, r.socle_procedure_id, 'ecriture') then
    raise exception 'Délier cette demande exige un droit de création ou d''instruction sur elle.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('request_groups:' || r.organization_id::text, 0));

  select m.group_id into v_g from public.request_group_members m where m.request_id = r.id;
  if v_g is null then
    return jsonb_build_object('changed', false);
  end if;

  delete from public.request_group_members where request_id = r.id;
  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (r.organization_id, r.id, 'request_unlinked', jsonb_build_object('group_id', v_g), v_uid);

  -- Un groupe d'une seule demande n'a plus de sens : il disparaît, et la
  -- dernière demande le dit dans son journal.
  select count(*), min(m.request_id::text)::uuid into v_count, v_left
    from public.request_group_members m where m.group_id = v_g;
  if v_count <= 1 then
    if v_left is not null then
      delete from public.request_group_members where group_id = v_g;
      insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
        values (r.organization_id, v_left, 'request_unlinked',
                jsonb_build_object('group_id', v_g, 'reason', 'groupe_dissous'), v_uid);
    end if;
    delete from public.request_groups where id = v_g;
  end if;

  return jsonb_build_object('changed', true, 'dissolved', v_count <= 1);
end;
$$;
revoke execute on function public.unlink_request(uuid) from public, anon;
grant execute on function public.unlink_request(uuid) to authenticated;

revoke execute on function public.request_group_max_size() from public, anon;
grant execute on function public.request_group_max_size() to authenticated, service_role;
