-- Purge du seed E2E « parcours guidé » — campagne vérifiée : matrice HTTP
-- create-request-from-procedure 10/10 (401 sans JWT, 404 non-membre, 400
-- snapshot imposé/démarche inconnue/anonymat interdit/champ demandeur
-- obligatoire/option hors formulaire/destinataire hors sous-arbre, 201 création
-- atomique avec usager rapproché + conditions, 409 rejeu de brouillon) +
-- parcours navigateur complet (5 étapes, condition d'affichage en direct,
-- récapitulatif, fiche, journal). Trace conservée.
do $$
declare
  v_accm uuid := '51a96071-6dc3-47e9-989e-5573ae4590aa';
  v_user uuid := 'e2e00000-0000-4000-8000-0000000000cc';
begin
  execute 'alter table public.request_events disable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments disable trigger t01_request_assignments_immutable';

  delete from public.requests where organization_id = v_accm
    and subject in ('Nid de poule E2E parcours', 'Demande d''intervention voirie');
  delete from public.organization_members where user_id = v_user;
  delete from auth.users where id = v_user;

  if not exists (select 1 from public.requests where organization_id = v_accm) then
    delete from public.request_sequences where organization_id = v_accm;
  end if;

  execute 'alter table public.request_events enable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments enable trigger t01_request_assignments_immutable';

  delete from supabase_migrations.schema_migrations where name = 'e2e_seed_parcours_demarche';
end $$;
