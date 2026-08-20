-- ============================================================================
-- Un membre du tenant voit la liste des membres de son tenant (nécessaire à
-- l'affectation des demandes par les superviseurs — l'ancienne policy ne
-- montrait que sa propre ligne aux non-admins). Les écritures restent admin.
-- ============================================================================
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(organization_id));
