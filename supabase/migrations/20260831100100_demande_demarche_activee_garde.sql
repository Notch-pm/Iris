-- ============================================================================
-- Garde : une demande NEUVE porte une démarche que son organisme PROPOSE.
--
-- ⚠️ **MIGRATION SÉPARÉE, ET C'EST VOULU.** Elle ne doit être appliquée
-- qu'APRÈS une synchronisation réussie ayant peuplé
-- `socle_procedure_organizations` (migration `20260831100000`). Appliquée sur
-- un miroir vide, elle ferme le guichet : plus aucune demande ne peut être
-- créée, ni par un agent, ni par l'ingestion partenaire. Rollback dédié dans
-- `supabase/rollback/` — jamais via `apply_migration`.
--
-- Décision PO du 2026-08-31 : l'activation par collectivité MASQUE **et**
-- REFUSE, contrairement à la période de publication qui ne fait que masquer.
-- Le motif est que les deux règles ne disent pas la même chose : une période
-- close décrit ce qu'on propose AU PUBLIC (un formulaire papier reçu pendant
-- la période reste consignable après), tandis qu'une démarche non activée dit
-- que cet organisme ne l'assure pas — la consigner n'aurait de sens à aucune
-- date.
--
-- BEFORE INSERT seulement, comme t16 : les demandes déjà déposées restent
-- lisibles et transitionnables si leur démarche est désactivée après coup. Le
-- nom la place APRÈS t16 (ordre alphabétique des triggers), qui a déjà garanti
-- que `socle_procedure_id` est non nul et connu du cache du tenant.
--
-- L'organisme vérifié est celui que la demande porte VRAIMENT :
-- `socle_organization_id` quand il est renseigné (parcours agent, RM-29), la
-- racine du tenant sinon — l'ingestion partenaire ayant le droit d'omettre le
-- destinataire (contrat requests-api 1.1.0).
--
-- DEFINER : lit le miroir hors RLS ; EXECUTE révoqué (règle CLAUDE.md).
-- ============================================================================
create or replace function public.requests_require_procedure_active()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  v_org := coalesce(new.socle_organization_id, new.socle_root_org_id);
  if v_org is null then
    return new;  -- aucune organisation attribuée : rien à vérifier
  end if;
  if not exists (
    select 1
      from public.socle_procedure_organizations
     where organization_id    = new.organization_id
       and socle_procedure_id = new.socle_procedure_id
       and socle_org_id       = v_org
       and obsoleted_at is null
  ) then
    raise exception 'Cette démarche n''est pas activée pour cet organisme dans le référentiel Socle.';
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_require_procedure_active() from public, anon, authenticated;

drop trigger if exists t18_requests_require_procedure_active on public.requests;
create trigger t18_requests_require_procedure_active
  before insert on public.requests
  for each row execute function public.requests_require_procedure_active();
create or replace function public.requests_require_procedure_active()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  v_org := coalesce(new.socle_organization_id, new.socle_root_org_id);
  if v_org is null then
    return new;  -- aucune organisation attribuée : rien à vérifier
  end if;
  if not exists (
    select 1
      from public.socle_procedure_organizations
     where organization_id    = new.organization_id
       and socle_procedure_id = new.socle_procedure_id
       and socle_org_id       = v_org
       and obsoleted_at is null
  ) then
    raise exception 'Cette démarche n''est pas activée pour cet organisme dans le référentiel Socle.';
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_require_procedure_active() from public, anon, authenticated;

drop trigger if exists t18_requests_require_procedure_active on public.requests;
create trigger t18_requests_require_procedure_active
  before insert on public.requests
  for each row execute function public.requests_require_procedure_active();
