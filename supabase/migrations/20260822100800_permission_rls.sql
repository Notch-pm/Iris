-- ============================================================================
-- Profils de droits — M9/9 : RLS des 5 tables de M1. AUCUNE policy d'écriture
-- cliente (ADR-03 : les 5 RPC de M5 sont la seule porte d'entrée, security
-- definer, EXECUTE contrôlé — les tables restent fermées en écriture pour
-- authenticated/anon, seul service_role et les RPC (qui s'exécutent comme le
-- propriétaire des fonctions, hors RLS) peuvent y écrire).
-- Réf : spec-profils-droits.md §2.1, RM-57 · correctif N.
-- Vigilance anti-récursion (risque documenté par l'architecte, §4.2 du plan) :
-- AUCUNE policy ci-dessous n'appelle my_permission_pairs / permission_pairs_of
-- / user_has_request_right — ces fonctions LISENT permission_profiles et
-- permission_profile_assignments ; les faire apparaître dans les policies DE
-- CES MÊMES TABLES créerait une boucle d'évaluation RLS. is_org_member et
-- is_org_admin_anywhere ne lisent QUE organizations/organization_members et
-- permission_profiles/permission_profile_assignments respectivement, jamais
-- en repassant par leurs propres policies de façon récursive (SECURITY
-- DEFINER, comme tous les helpers RLS du projet).
-- ============================================================================

-- permission_profiles — F-3 (revue de sécurité, 2026-08-22) : RESTREINT par
-- rapport à la version initiale (is_org_member, trop large — un agent
-- pouvait lire la topologie COMPLÈTE des profils du tenant, y compris ceux
-- d'autres services, une fuite d'organisation par rapport à RM-46 qui ne
-- promet à l'utilisateur que la liste DE SES PROPRES profils). Un
-- administrateur (is_org_admin_anywhere) voit tout, pour l'écran Paramètres
-- ; un agent ne voit que les profils auxquels IL est attribué.
drop policy if exists permission_profiles_select on public.permission_profiles;
create policy permission_profiles_select on public.permission_profiles
  for select to authenticated
  using (
    public.is_org_admin_anywhere(organization_id)
    or exists (
      select 1 from public.permission_profile_assignments a
       where a.profile_id = permission_profiles.id and a.user_id = auth.uid()
    )
  );

-- permission_profile_organizations / permission_profile_procedures — pas de
-- organization_id direct : jointure vers permission_profiles, MÊME règle
-- (F-3) appliquée à travers la jointure — sans double-implémentation de la
-- sémantique, juste répétée car ces deux tables n'ont pas de policy propre
-- sur permission_profiles à hériter automatiquement (RLS ne « traverse » pas
-- les FK).
drop policy if exists permission_profile_organizations_select on public.permission_profile_organizations;
create policy permission_profile_organizations_select on public.permission_profile_organizations
  for select to authenticated
  using (
    exists (
      select 1 from public.permission_profiles p
       where p.id = permission_profile_organizations.profile_id
         and (
           public.is_org_admin_anywhere(p.organization_id)
           or exists (select 1 from public.permission_profile_assignments a
                       where a.profile_id = p.id and a.user_id = auth.uid())
         )
    )
  );

drop policy if exists permission_profile_procedures_select on public.permission_profile_procedures;
create policy permission_profile_procedures_select on public.permission_profile_procedures
  for select to authenticated
  using (
    exists (
      select 1 from public.permission_profiles p
       where p.id = permission_profile_procedures.profile_id
         and (
           public.is_org_admin_anywhere(p.organization_id)
           or exists (select 1 from public.permission_profile_assignments a
                       where a.profile_id = p.id and a.user_id = auth.uid())
         )
    )
  );

-- permission_profile_assignments — soi-même (RM-46 : « pourquoi je peux/ne
-- peux pas ») ou administration quelque part dans le tenant (RM-20).
drop policy if exists permission_profile_assignments_select on public.permission_profile_assignments;
create policy permission_profile_assignments_select on public.permission_profile_assignments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_org_admin_anywhere(organization_id)
  );

-- permission_audit_log — RM-57 : réservé aux administrateurs (pièce d'audit).
-- F-4 (revue de sécurité, 2026-08-22) : décision ACTÉE, gardé tel quel —
-- is_org_admin_anywhere reste le bon périmètre ici (comme pour la RPC
-- members_without_profile, M5) : le journal des droits et la liste des
-- membres sans profil sont des outils d'ADMINISTRATION du tenant, jamais
-- une information qu'un agent ordinaire doit pouvoir consulter (contrairement
-- à permission_profiles ci-dessus, où RM-46 promet explicitement à CHACUN la
-- liste de SES PROPRES profils).
drop policy if exists permission_audit_log_select on public.permission_audit_log;
create policy permission_audit_log_select on public.permission_audit_log
  for select to authenticated
  using (public.is_org_admin_anywhere(organization_id));

-- Aucune policy INSERT/UPDATE/DELETE sur les 5 tables pour authenticated/anon
-- : par défaut, PostgreSQL refuse toute opération non couverte par une
-- policy — c'est le comportement recherché (ADR-03). service_role contourne
-- le RLS par attribut (aucune policy « service » à écrire, cf. CLAUDE.md).
