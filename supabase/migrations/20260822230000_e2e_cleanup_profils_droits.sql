-- Purge du seed E2E « profils de droits » — retire toute donnée de test et
-- efface la trace du seed dans schema_migrations. Cette migration reste comme
-- trace. Campagne couverte : parcours administrateur (tableau de bord, liste,
-- Paramètres › Droits, création d'un profil de sous-arbre, attribution,
-- couverture, journal, fiche) et parcours agent restreint (liste vide, pas de
-- création, pas de Paramètres, fiche hors périmètre).
-- Ordre imposé par les FK : le journal (SET NULL vers users, protégé par le
-- trigger d'immuabilité) et le profil E2E (created_by NO ACTION vers users)
-- doivent disparaître avant les comptes.
do $$
declare
  v_accm  uuid := '51a96071-6dc3-47e9-989e-5573ae4590aa';
  v_admin uuid := 'e2e00000-0000-4000-8000-0000000000a1';
  v_agent uuid := 'e2e00000-0000-4000-8000-0000000000a2';
begin
  execute 'alter table public.permission_audit_log disable trigger t01_permission_audit_log_immutable';

  -- Journal : entrées dont l'acteur ou la cible est un compte e2e, ou qui
  -- concernent le profil de test.
  delete from public.permission_audit_log
   where actor_id in (v_admin, v_agent)
      or target_user_id in (v_admin, v_agent)
      or profile_name like 'E2E %'
      or profile_id in (select id from public.permission_profiles
                         where organization_id = v_accm and name like 'E2E %');

  -- Attributions des comptes e2e (dont celle au profil de reprise « Administrateur »).
  delete from public.permission_profile_assignments where user_id in (v_admin, v_agent);

  -- Profil de test (cascade : périmètre, matrice, attributions restantes).
  delete from public.permission_profiles
   where organization_id = v_accm and name like 'E2E %';

  -- Appartenances e2e. Le trigger t05_organization_members_protect_last_admin
  -- n'intervient pas : les deux administrateurs racine réels d'ACCM subsistent.
  delete from public.organization_members where user_id in (v_admin, v_agent);

  -- Comptes GoTrue (cascade vers public.users et auth.identities).
  delete from auth.users where id in (v_admin, v_agent);

  execute 'alter table public.permission_audit_log enable trigger t01_permission_audit_log_immutable';

  delete from supabase_migrations.schema_migrations where name = 'e2e_seed_profils_droits';
end $$;
