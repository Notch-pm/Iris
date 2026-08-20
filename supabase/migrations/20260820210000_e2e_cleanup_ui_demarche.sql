-- Purge du seed E2E navigateur « retrait demande libre » — parcours vérifié :
-- connexion, dialogue sans option libre (sélecteur requis sur le cache),
-- création sur « Demande d'intervention voirie » avec snapshot serveur complet
-- (form_schema présent, non dégradé), fiche et journal. Trace conservée.
do $$
declare
  v_accm uuid := '51a96071-6dc3-47e9-989e-5573ae4590aa';
  v_user uuid := 'e2e00000-0000-4000-8000-0000000000dd';
begin
  execute 'alter table public.request_events disable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments disable trigger t01_request_assignments_immutable';

  delete from public.requests where id = 'dec862e7-7015-43eb-94f4-8b8325828e54';
  delete from public.organization_members where user_id = v_user;
  delete from auth.users where id = v_user;

  if not exists (select 1 from public.requests where organization_id = v_accm) then
    delete from public.request_sequences where organization_id = v_accm;
  end if;

  execute 'alter table public.request_events enable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments enable trigger t01_request_assignments_immutable';

  delete from supabase_migrations.schema_migrations where name = 'e2e_seed_ui_demarche';
end $$;
