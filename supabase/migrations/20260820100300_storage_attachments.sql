-- ============================================================================
-- Fondations Iris — 4/4 : stockage privé des pièces de demandes.
-- Réf : docs/architecture-proposee.md §4.4 · docs/data-model.md.
-- ⚠️ Les policies storage vivent dans cette migration versionnée : le `db dump`
-- ne couvre pas le schéma storage (constat Socle) — sans fichier miroir, elles
-- disparaîtraient d'une reconstruction.
-- ============================================================================

-- Bucket PRIVÉ, 25 Mio max par fichier (parité Socle procedure-documents).
insert into storage.buckets (id, name, public, file_size_limit)
values ('request-attachments', 'request-attachments', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- Convention de chemin PORTEUSE du RLS : {organization_id}/{request_id}/{uuid}-{slug}
-- Le 1er segment est l'id du tenant Iris (organizations.id, PAS l'UUID Socle).
-- Consultation par URL signée temporaire (5 min) — jamais d'accès public.
-- La granularité par sous-arbre Socle viendra avec le miroir d'organisations
-- (vague ultérieure) via une jointure request_attachments.

drop policy if exists "request_attachments_storage_select" on storage.objects;
create policy "request_attachments_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "request_attachments_storage_insert" on storage.objects;
create policy "request_attachments_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'request-attachments'
    and public.is_org_writer(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "request_attachments_storage_delete" on storage.objects;
create policy "request_attachments_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'request-attachments'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

-- Pas de policy UPDATE : un objet se remplace par suppression + nouvel envoi
-- (chemins générés, jamais réutilisés).
