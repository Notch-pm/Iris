-- ============================================================================
-- Profils de droits — finition : advisor performance 0003 (auth_rls_initplan)
-- sur les policies SELECT des tables de profils (M9) — `auth.uid()` enveloppé
-- dans `(select auth.uid())` pour être évalué une fois par requête (InitPlan)
-- plutôt qu'une fois par ligne. Sémantique strictement inchangée.
-- ============================================================================
drop policy if exists permission_profiles_select on public.permission_profiles;
create policy permission_profiles_select on public.permission_profiles
  for select to authenticated
  using (
    public.is_org_admin_anywhere(organization_id)
    or exists (
      select 1 from public.permission_profile_assignments a
       where a.profile_id = permission_profiles.id and a.user_id = (select auth.uid())
    )
  );

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
                       where a.profile_id = p.id and a.user_id = (select auth.uid()))
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
                       where a.profile_id = p.id and a.user_id = (select auth.uid()))
         )
    )
  );

drop policy if exists permission_profile_assignments_select on public.permission_profile_assignments;
create policy permission_profile_assignments_select on public.permission_profile_assignments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_admin_anywhere(organization_id)
  );
