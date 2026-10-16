-- ============================================================================
-- Demandes liées — recherche des demandes approchantes (lot L2 de
-- docs/demandes-liees.md).
--
-- Plusieurs milliers de demandes ouvertes : le navigateur n'en rapatrie
-- AUCUNE. La recherche vit ici, en SECURITY INVOKER — donc bornée par le RLS de
-- `requests` : un agent ne se voit proposer que ce qu'il peut déjà lire.
--
--   · find_similar_requests(...)       — à partir d'un BROUILLON (guichet) :
--     démarche, point ou adresse, texte. Rien n'est écrit.
--   · find_similar_requests_for(id)    — à partir d'une demande existante
--     (fiche), qui fournit elle-même démarche, lieu (request_locations) et texte.
--
-- Préfiltre (cheap, indexé par requests_org_procedure_idx) : même tenant,
-- démarche MUTUALISABLE, reçue dans la fenêtre de la démarche source, ouverte ou
-- résolue depuis moins de 30 jours (un trou déjà rebouché se lie et se résout
-- avec le même texte), hors du groupe de la demande source.
-- Signaux (sur le seul jeu préfiltré) : distance en mètres (haversine), même
-- adresse normalisée (trigrammes), texte objet + description (trigrammes).
-- La fonction REND LES SIGNAUX BRUTS ; le score et son explication sont
-- calculés par `src/features/linking/similaires.ts` (pur, testé). L'ordre SQL
-- n'est qu'un tri grossier qui sert la limite.
--
-- Et : la policy de lecture de `request_locations` passe de
-- `can_consult_request(request_id)` (une fonction DEFINER par ligne — coûteuse
-- sur un balayage de milliers de lignes) à `EXISTS` demande visible, le motif
-- de `request_links` / `request_events` : le RLS de `requests` y est évalué une
-- fois (sous-requête hachée). Le groupe garde `can_consult_request` : un
-- intervenant, qui lit la demande sur laquelle il est sollicité, n'a pas à
-- voir à quoi elle est liée — et un groupe est petit.
-- ============================================================================

drop policy if exists request_locations_select on public.request_locations;
create policy request_locations_select on public.request_locations
  for select to authenticated using (exists (
    select 1 from public.requests r where r.id = request_locations.request_id));

-- Distance en mètres entre deux points WGS84 (haversine, rayon terrestre moyen).
create or replace function public.haversine_m(p_lat1 double precision, p_lon1 double precision,
                                              p_lat2 double precision, p_lon2 double precision)
returns double precision language sql immutable parallel safe set search_path = '' as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lon2 - p_lon1) / 2), 2))));
$$;
revoke execute on function public.haversine_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.haversine_m(double precision, double precision, double precision, double precision) to authenticated, service_role;

create or replace function public.find_similar_requests(
  p_org_id             uuid,
  p_procedure_id       uuid,
  p_lat                double precision default null,
  p_lon                double precision default null,
  p_address            text default null,
  p_text               text default null,
  p_exclude_request_id uuid default null,
  p_limit              integer default 30)
returns table (
  request_id         uuid,
  reference          text,
  subject            text,
  status             text,
  received_at        timestamptz,
  closed_at          timestamptz,
  socle_procedure_id uuid,
  procedure_label    text,
  organisme          text,
  group_id           uuid,
  distance_m         double precision,
  address_similarity real,
  text_similarity    real,
  same_procedure     boolean,
  radius_m           integer)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_radius integer;
  v_window integer;
  v_addr   text := public.normalize_address(p_address);
  v_text   text := public.normalize_address(p_text);
  v_group  uuid;
  v_point  boolean := p_lat is not null and p_lon is not null;
begin
  select s.radius_m, s.window_days into v_radius, v_window
    from public.procedure_link_settings s
   where s.organization_id = p_org_id and s.socle_procedure_id = p_procedure_id and s.enabled;
  if v_radius is null then
    return;  -- démarche non mutualisable : rien à proposer, ce n'est pas une erreur
  end if;
  if p_exclude_request_id is not null then
    select m.group_id into v_group from public.request_group_members m
     where m.request_id = p_exclude_request_id;
  end if;

  return query
  with base as (
    select r.id, r.reference, r.subject, r.body, r.status, r.received_at, r.closed_at,
           r.socle_procedure_id, r.socle_procedure_label, r.socle_organization_label,
           l.lat, l.lon, l.address_norm, m.group_id as gid
      from public.requests r
      join public.procedure_link_settings k
        on k.organization_id = r.organization_id and k.socle_procedure_id = r.socle_procedure_id and k.enabled
      left join public.request_locations l on l.request_id = r.id
      left join public.request_group_members m on m.request_id = r.id
     where r.organization_id = p_org_id
       and r.received_at >= now() - make_interval(days => v_window)
       and (r.status in ('a_traiter', 'en_instruction', 'en_attente')
            or (r.status in ('resolue_positive', 'resolue_negative')
                and r.closed_at >= now() - interval '30 days'))
       and (p_exclude_request_id is null or r.id <> p_exclude_request_id)
       and (v_group is null or m.group_id is distinct from v_group)
  ), signals as (
    select b.*,
           case when v_point and b.lat is not null
                then public.haversine_m(p_lat, p_lon, b.lat, b.lon) end as dist,
           case when v_addr is not null and b.address_norm is not null
                then extensions.similarity(v_addr, b.address_norm) end as asim,
           case when v_text is not null
                then extensions.similarity(v_text, public.normalize_address(
                       coalesce(b.subject, '') || ' ' || coalesce(b.body, ''))) end as tsim
      from base b
  )
  select s.id, s.reference, s.subject, s.status, s.received_at, s.closed_at,
         s.socle_procedure_id, s.socle_procedure_label, s.socle_organization_label, s.gid,
         s.dist, s.asim, s.tsim, s.socle_procedure_id = p_procedure_id, v_radius
    from signals s
   where (s.dist is not null and s.dist <= v_radius)
      or coalesce(s.asim, 0) >= 0.5
      or coalesce(s.tsim, 0) >= 0.3
   order by greatest(
              case when s.dist is not null and s.dist <= v_radius then 1 - s.dist / v_radius else 0 end,
              coalesce(s.asim, 0), coalesce(s.tsim, 0)) desc,
            s.received_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 50);
end;
$$;
revoke execute on function public.find_similar_requests(uuid, uuid, double precision, double precision, text, text, uuid, integer)
  from public, anon;
grant execute on function public.find_similar_requests(uuid, uuid, double precision, double precision, text, text, uuid, integer)
  to authenticated, service_role;

-- La même recherche, depuis une demande existante. Une demande illisible (RLS)
-- ne produit rien — elle n'est pas « introuvable », elle est absente.
create or replace function public.find_similar_requests_for(p_request_id uuid, p_limit integer default 30)
returns table (
  request_id         uuid,
  reference          text,
  subject            text,
  status             text,
  received_at        timestamptz,
  closed_at          timestamptz,
  socle_procedure_id uuid,
  procedure_label    text,
  organisme          text,
  group_id           uuid,
  distance_m         double precision,
  address_similarity real,
  text_similarity    real,
  same_procedure     boolean,
  radius_m           integer)
language sql stable security invoker set search_path = '' as $$
  select f.*
    from public.requests r
    left join public.request_locations l on l.request_id = r.id
   cross join lateral public.find_similar_requests(
           r.organization_id, r.socle_procedure_id, l.lat, l.lon, l.address_norm,
           coalesce(r.subject, '') || ' ' || coalesce(r.body, ''), r.id, p_limit) f
   where r.id = p_request_id and r.socle_procedure_id is not null;
$$;
revoke execute on function public.find_similar_requests_for(uuid, integer) from public, anon;
grant execute on function public.find_similar_requests_for(uuid, integer) to authenticated, service_role;
