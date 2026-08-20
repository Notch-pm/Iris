-- Purge du seed E2E « règle démarche » — retire toute donnée de test, remet
-- les séquences à zéro quand plus aucune demande ne subsiste, et efface la
-- trace du seed dans schema_migrations. Cette migration reste comme trace.
-- Campagne couverte : refus ingestion (sans démarche / inconnue / snapshot
-- imposé), dépôt dégradé + réel, périmètre socle-proxy, sanitisation contacts.
do $$
declare
  v_accm uuid := '51a96071-6dc3-47e9-989e-5573ae4590aa';
  v_org  uuid := 'e2e00000-0000-4000-8000-000000000001';
  v_user uuid := 'e2e00000-0000-4000-8000-0000000000ee';
begin
  execute 'alter table public.request_events disable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments disable trigger t01_request_assignments_immutable';
  execute 'alter table public.integration_api_logs disable trigger t01_integration_api_logs_immutable';

  delete from public.requests where source in ('e2e-src', 'e2e-accm');
  delete from public.integration_api_logs where integration_source_id in
    (select id from public.integration_sources where code in ('e2e-src', 'e2e-accm'));
  delete from public.integration_sources where code in ('e2e-src', 'e2e-accm');
  delete from public.socle_procedure_cache where socle_id = 'e2e00000-0000-4000-8000-0000000000aa';
  delete from public.organization_members where user_id = v_user;
  delete from auth.users where id = v_user;
  delete from public.organizations where id = v_org;

  -- Séquence ACCM : remise à zéro uniquement si plus aucune demande.
  if not exists (select 1 from public.requests where organization_id = v_accm) then
    delete from public.request_sequences where organization_id = v_accm;
  end if;

  execute 'alter table public.request_events enable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments enable trigger t01_request_assignments_immutable';
  execute 'alter table public.integration_api_logs enable trigger t01_integration_api_logs_immutable';

  delete from supabase_migrations.schema_migrations where name = 'e2e_seed_regle_demarche';
end $$;
