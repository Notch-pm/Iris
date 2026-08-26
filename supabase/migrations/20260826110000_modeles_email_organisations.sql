-- ============================================================================
-- Modèles d'e-mail — activation organisation par organisation (vague 2,
-- décision PO 2026-08-26).
--
-- Un modèle appartient au TENANT ; il n'est utilisable que dans les
-- organisations Socle où on l'a explicitement activé. **Par défaut, un nouveau
-- modèle n'est activé nulle part** : rien à désactiver après coup, l'ouverture
-- est un geste.
--
-- Comme prévu au plan de la vague 1, `email_templates` n'est pas modifiée : une
-- table satellite suffit, au motif exact de `permission_profile_organizations`.
--
-- QUI PEUT ACTIVER : `has_admin_scope(tenant, socle_org)` — l'administration
-- effective sur CETTE organisation, remontée d'ascendance comprise. Ce n'est
-- pas `is_org_admin_anywhere` (qui gouverne l'écriture du modèle lui-même,
-- objet de tenant) : ouvrir un modèle à la Voirie est une décision sur la
-- Voirie, et un administrateur borné au CCAS n'a pas à la prendre.
-- ============================================================================

create table if not exists public.email_template_organizations (
  template_id  uuid not null references public.email_templates(id) on delete cascade,
  -- UUID Socle NU, sans FK : aucune FK ne franchit une frontière de projet.
  -- La cohérence de tenant est tenue par le trigger t01 ci-dessous.
  socle_org_id uuid not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  primary key (template_id, socle_org_id)
);

comment on table public.email_template_organizations is
  'Organisations Socle où un modèle d''e-mail est activé. Absence de ligne = modèle inactif pour cette organisation (défaut d''un nouveau modèle : aucune). Contrairement au périmètre d''un profil de droits, il n''y a PAS de descendance implicite : chaque organisation est activée nommément.';

create index if not exists email_template_organizations_org_idx
  on public.email_template_organizations (socle_org_id);

-- ----------------------------------------------------------------------------
-- Cohérence de tenant — motif `permission_check_tenant_scope`.
-- On n'active un modèle que sur une organisation du miroir Socle DE SON
-- tenant : sans cette garde, une ligne pourrait pointer une organisation d'un
-- autre tenant, qu'aucune FK ne peut interdire ici.
-- ----------------------------------------------------------------------------

create or replace function public.email_template_check_tenant_scope()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare v_org uuid;
begin
  select t.organization_id into v_org
    from public.email_templates t where t.id = new.template_id;
  if v_org is null then
    raise exception 'Modèle d''e-mail introuvable.';
  end if;
  if not exists (
    select 1 from public.socle_organizations m
     where m.organization_id = v_org and m.socle_id = new.socle_org_id
  ) then
    raise exception 'Cette organisation n''appartient pas à la collectivité de ce modèle.';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.email_template_check_tenant_scope() from public, anon, authenticated;

drop trigger if exists t01_email_template_organizations_scope on public.email_template_organizations;
create trigger t01_email_template_organizations_scope
  before insert or update on public.email_template_organizations
  for each row execute function public.email_template_check_tenant_scope();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.email_template_organizations enable row level security;

-- Lecture : tout membre du tenant propriétaire du modèle. Le rattachement
-- n'est pas plus secret que le modèle lui-même.
drop policy if exists email_template_organizations_select on public.email_template_organizations;
create policy email_template_organizations_select on public.email_template_organizations
  for select to authenticated
  using (exists (
    select 1 from public.email_templates t
     where t.id = template_id and public.is_org_member(t.organization_id)
  ));

drop policy if exists email_template_organizations_insert on public.email_template_organizations;
create policy email_template_organizations_insert on public.email_template_organizations
  for insert to authenticated
  with check (exists (
    select 1 from public.email_templates t
     where t.id = template_id and public.has_admin_scope(t.organization_id, socle_org_id)
  ));

drop policy if exists email_template_organizations_delete on public.email_template_organizations;
create policy email_template_organizations_delete on public.email_template_organizations
  for delete to authenticated
  using (exists (
    select 1 from public.email_templates t
     where t.id = template_id and public.has_admin_scope(t.organization_id, socle_org_id)
  ));

-- Pas de policy UPDATE : la table n'a rien à modifier — on active ou on
-- désactive, c'est une insertion ou une suppression.

drop policy if exists email_template_organizations_service on public.email_template_organizations;
create policy email_template_organizations_service on public.email_template_organizations
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Les organisations que l'appelant ADMINISTRE, prêtes à dessiner un arbre.
--
-- `has_admin_scope` est un prédicat par organisation ; l'écran a besoin de la
-- LISTE. On la construit ici plutôt que de laisser le navigateur interroger le
-- prédicat nœud par nœud.
-- ----------------------------------------------------------------------------

create or replace function public.administrable_organizations(p_org_id uuid)
returns table (socle_org_id uuid, socle_parent_id uuid, name text, obsolete boolean)
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'Collectivité introuvable.';
  end if;

  return query
    select m.socle_id, m.socle_parent_id, m.name, m.obsoleted_at is not null
      from public.socle_organizations m
     where m.organization_id = p_org_id
       and public.has_admin_scope(p_org_id, m.socle_id)
     order by m.name;
end;
$fn$;
comment on function public.administrable_organizations(uuid) is
  'Organisations Socle du tenant que l''utilisateur COURANT administre (has_admin_scope, remontée d''ascendance comprise). Alimente l''arbre des Paramètres et les bascules d''activation des modèles d''e-mail.';
revoke execute on function public.administrable_organizations(uuid) from public, anon;
grant  execute on function public.administrable_organizations(uuid) to authenticated;
