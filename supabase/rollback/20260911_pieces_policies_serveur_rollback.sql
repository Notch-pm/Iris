-- Rollback du lot 2b « fermeture de l'ancien chemin des pièces » (migration
-- 20260911100100). ⚠️ Jamais via `apply_migration` (ce n'est pas une migration).
--
-- Rouvre les écritures clientes telles qu'elles étaient le 2026-08-22
-- (20260822100700) — y compris la faille que 2b fermait (chemin non vérifié à
-- l'INSERT de request_attachments). À ne jouer que si les edge functions du
-- lot 2a doivent être retirées ; sinon, corriger en avant.

create or replace function public.has_any_creation_right(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_platform_admin from public.users u where u.id = auth.uid()), false)
      or exists (
        select 1 from public.permission_pairs_of(
                 array(select a.profile_id
                         from public.permission_profile_assignments a
                         join public.permission_profiles p on p.id = a.profile_id
                        where a.user_id = auth.uid() and a.organization_id = p_org_id
                          and p.status = 'active'),
                 'creation', p_org_id) s
         where s.organization_id = p_org_id);
$$;
revoke execute on function public.has_any_creation_right(uuid) from public, anon;
grant  execute on function public.has_any_creation_right(uuid) to authenticated;

update storage.buckets set allowed_mime_types = null where id = 'request-attachments';

drop policy if exists request_attachments_insert on public.request_attachments;
create policy request_attachments_insert on public.request_attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      (select public.is_platform_admin())
      or exists (
        select 1 from public.requests r
         where r.id = request_attachments.request_id
           and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
               in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                     from public.my_permission_pairs('instruction') s)
      )
    )
  );

drop policy if exists "request_attachments_storage_select" on storage.objects;
create policy "request_attachments_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and (
      public.can_read_request(public.uuid_or_null((storage.foldername(name))[2]))
      or (
        (owner_id = auth.uid()::text or owner = auth.uid())
        and not public.request_exists(public.uuid_or_null((storage.foldername(name))[2]))
      )
    )
  );

drop policy if exists "request_attachments_storage_insert" on storage.objects;
create policy "request_attachments_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'request-attachments'
    and public.has_any_creation_right(public.uuid_or_null((storage.foldername(name))[1]))
    and (
      not public.request_exists(public.uuid_or_null((storage.foldername(name))[2]))
      or public.can_process_request(public.uuid_or_null((storage.foldername(name))[2]))
    )
  );

drop policy if exists "request_attachments_storage_delete" on storage.objects;
create policy "request_attachments_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'request-attachments'
    and (
      public.can_admin_request(public.uuid_or_null((storage.foldername(name))[2]))
      or (
        (owner_id = auth.uid()::text or owner = auth.uid())
        and not public.request_exists(public.uuid_or_null((storage.foldername(name))[2]))
      )
    )
  );
