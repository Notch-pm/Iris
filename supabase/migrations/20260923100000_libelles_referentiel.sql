-- Libellés : « Socle » devient « Référentiel » dans les messages que lit un agent.
--
-- Les écrans ne nomment plus le référentiel par son nom de produit ; les deux gardes
-- d'activation (t18 à la création, t12 au transfert) remontent leur message tel quel
-- jusqu'à l'écran — elles suivent. Corps recopiés de la définition LIVE
-- (pg_get_functiondef), seul le texte du `raise` change.

create or replace function public.requests_require_procedure_active()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
begin
  v_org := coalesce(new.socle_organization_id, new.socle_root_org_id);
  if v_org is null then
    return new;
  end if;
  if not exists (
    select 1
      from public.socle_procedure_organizations
     where organization_id    = new.organization_id
       and socle_procedure_id = new.socle_procedure_id
       and socle_org_id       = v_org
       and obsoleted_at is null
  ) then
    raise exception 'Cette démarche n''est pas activée pour cet organisme dans le Référentiel.';
  end if;
  return new;
end;
$function$;

create or replace function public.requests_transfer_procedure_active()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
begin
  if new.socle_organization_id is not distinct from old.socle_organization_id then
    return new;
  end if;
  if new.socle_procedure_id is null then
    return new;  -- demande anterieure a l'obligation de demarche
  end if;
  v_org := coalesce(new.socle_organization_id, new.socle_root_org_id);
  if v_org is null then
    return new;
  end if;
  if not exists (
    select 1
      from public.socle_procedure_organizations
     where organization_id    = new.organization_id
       and socle_procedure_id = new.socle_procedure_id
       and socle_org_id       = v_org
       and obsoleted_at is null
  ) then
    raise exception 'Transfert : cette démarche n''est pas activée pour l''organisme cible dans le Référentiel.';
  end if;
  return new;
end;
$function$;

-- Le replace re-grante PUBLIC : re-révoquer (piège Clara).
revoke execute on function public.requests_require_procedure_active() from anon, authenticated, public;
revoke execute on function public.requests_transfer_procedure_active() from anon, authenticated, public;
