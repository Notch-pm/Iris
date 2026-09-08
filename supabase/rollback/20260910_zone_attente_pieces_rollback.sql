-- Rollback du lot 1 « zone d'attente des pièces » (migrations 20260910100000 et
-- 20260910100100). ⚠️ Jamais via `apply_migration` (ce n'est pas une migration).
--
-- À jouer si le dépôt par `POST /v1/uploads` doit être refermé d'urgence.
-- Ce que le rollback NE défait PAS, volontairement :
--   · les lignes `request_attachments` nées d'un dépôt push (objet présent,
--     `copy_status = copied`) — ce sont des pièces de dossier valides ;
--   · les objets encore en zone d'attente (`{org}/_staging/…`) : sans la table
--     qui les décrit ils deviennent des orphelins — les lister AVANT via
--     `select storage_path from public.attachment_uploads where consumed_at is null`
--     et les retirer par l'API Storage.
-- Le contrat OpenAPI redescend en 1.2.0 avec le redéploiement de la version
-- précédente de `requests-api` : ce script ne touche pas aux edge functions.

drop function if exists public.ingest_request_attachments(uuid, uuid, uuid, jsonb);
drop function if exists public.consume_attachment_upload(uuid, uuid, uuid, uuid, uuid);
drop table if exists public.attachment_uploads;

alter table public.request_attachments
  drop constraint if exists request_attachments_copy_status_check;
alter table public.request_attachments
  add constraint request_attachments_copy_status_check
  check (copy_status in ('copied', 'pending', 'error'));
alter table public.request_attachments add column if not exists fetch_url text;
comment on column public.request_attachments.fetch_url is
  'URL signée temporaire fournie à l''ingestion (copy_status=pending). Consommée par le worker de copie, jamais re-servie.';
