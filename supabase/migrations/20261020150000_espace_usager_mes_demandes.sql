-- ============================================================================
-- Espace usager — lot L3b : « Mes demandes » (Projet Sceaux, AO 26AS02).
--
-- Décision PO du 2026-10-19 : un usager connecté voit TOUTES les demandes
-- rattachées à sa fiche du Socle, quel que soit le canal (portail, guichet,
-- courrier relayé par Clara…). Le rattachement devient donc une frontière de
-- sécurité ; garde-fous (02-espace-usager.md §3.3) :
--   · rapprochement durci à l'ingestion (requests-api, même lot) ;
--   · une demande peut être SOUSTRAITE à l'espace usager par un agent
--     (confidentialité, demande d'un tiers rattachée à tort…) : drapeau
--     `citizen_visible`, réservé au droit d'instruction ;
--   · lectures par la clé du portail, et par un JETON COURT signé exigé à
--     chaque lecture (requests-api, `_shared/citizenToken.ts`).
-- ============================================================================

alter table public.requests
  add column citizen_visible boolean not null default true;

comment on column public.requests.citizen_visible is
  'Visible dans l''espace usager du titulaire de la fiche (portail Nora). false = soustraite par un agent ayant le droit d''instruction (confidentialité, rattachement à corriger).';

-- « Mes demandes » : les demandes visibles d'une fiche, les plus récentes d'abord.
create index if not exists requests_org_contact_citizen_idx
  on public.requests (organization_id, socle_contact_id, received_at desc, id desc)
  where socle_contact_id is not null and citizen_visible;

-- Seul le droit d'instruction change la visibilité côté usager (le contrôle
-- d'édition du dossier, `requests_guard_transition`, liste ses colonnes une à
-- une : celle-ci a donc sa propre garde). SECURITY INVOKER, comme t10/t11 :
-- en DEFINER, `is_service_context()` lirait le propriétaire et serait toujours
-- vrai (relecture de sécurité du 2026-10-20, I1).
create or replace function public.requests_guard_citizen_visibility()
returns trigger
language plpgsql security invoker set search_path = '' as $fn$
begin
  if new.citizen_visible is distinct from old.citizen_visible
     and not public.is_service_context()
     and not public.user_has_request_right(
       (select auth.uid()), old.organization_id, old.socle_organization_id, old.socle_procedure_id, 'instruction') then
    raise exception 'Changer la visibilité d''une demande dans l''espace usager exige le droit d''instruction.';
  end if;
  return new;
end;
$fn$;

comment on function public.requests_guard_citizen_visibility() is
  'Garde : seul un agent ayant le droit d''instruction (ou le service) change requests.citizen_visible.';

create trigger t14_requests_guard_citizen_visibility
  before update of citizen_visible on public.requests
  for each row execute function public.requests_guard_citizen_visibility();
revoke execute on function public.requests_guard_citizen_visibility() from public, anon, authenticated;
