-- ============================================================================
-- Trace historique — nettoyage de la vérification bout en bout de requests-api
-- (2026-08-20) : purge des tenants E2E et retrait de l'entrée de seed.
-- Rejouable à vide sur tout environnement (les UUID E2E n'existent plus).
-- Les gardes d'immuabilité sont désactivées LE TEMPS de la purge — c'est le
-- geste conscient qu'exigera la future procédure de purge RGPD service_role.
-- ============================================================================
do $$
declare
  v_roots uuid[] := array['e2e00000-0000-4000-8000-00000000000a',
                          'e2e00000-0000-4000-8000-00000000000b']::uuid[];
begin
  alter table public.request_events disable trigger t01_request_events_immutable;
  alter table public.request_assignments disable trigger t01_request_assignments_immutable;
  alter table public.integration_api_logs disable trigger t01_integration_api_logs_immutable;

  delete from public.requests r using public.organizations o
   where r.organization_id = o.id and o.socle_org_id = any(v_roots);

  delete from public.integration_api_logs l using public.organizations o
   where l.organization_id = o.id and o.socle_org_id = any(v_roots);

  delete from public.organizations where socle_org_id = any(v_roots);

  alter table public.request_events enable trigger t01_request_events_immutable;
  alter table public.request_assignments enable trigger t01_request_assignments_immutable;
  alter table public.integration_api_logs enable trigger t01_integration_api_logs_immutable;
end $$;
