-- ============================================================================
-- Trace historique — nettoyage de la vérification navigateur du parcours agent
-- (2026-08-20) : purge du tenant de démo E2E, des comptes de test et des
-- entrées de migration e2e_*. Rejouable à vide sur tout environnement.
-- Gardes d'immuabilité désactivées LE TEMPS de la purge (geste conscient,
-- motif de la future purge RGPD service_role).
-- ============================================================================
do $$
declare
  v_root uuid := 'e2ea0000-0000-4000-8000-00000000000f';
begin
  alter table public.request_events disable trigger t01_request_events_immutable;
  alter table public.request_assignments disable trigger t01_request_assignments_immutable;
  alter table public.integration_api_logs disable trigger t01_integration_api_logs_immutable;

  delete from public.requests r using public.organizations o
   where r.organization_id = o.id and o.socle_org_id = v_root;
  delete from public.integration_api_logs l using public.organizations o
   where l.organization_id = o.id and o.socle_org_id = v_root;
  delete from public.organizations where socle_org_id = v_root;

  delete from auth.users
   where email in ('agent.e2e@iris.test', 'superviseur.e2e@iris.test');

  alter table public.request_events enable trigger t01_request_events_immutable;
  alter table public.request_assignments enable trigger t01_request_assignments_immutable;
  alter table public.integration_api_logs enable trigger t01_integration_api_logs_immutable;
end $$;
