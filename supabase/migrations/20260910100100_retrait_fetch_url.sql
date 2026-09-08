-- ============================================================================
-- Retrait du mode « pull » des pièces ingérées — `fetch_url` et l'état
-- `copy_status = 'pending'` (lot 1 du chantier documents, 2026-09-08).
--
-- CE QUE C'ÉTAIT. Le contrat d'ingestion 1.x promettait qu'un partenaire
-- fournirait une URL SIGNÉE et qu'un worker (`process-attachment-queue`)
-- viendrait copier le fichier. Le worker n'a jamais existé : les pièces
-- restaient `pending` à vie, l'URL signée — un droit d'accès au document du
-- partenaire — dormait en clair dans une table lisible par tout membre du
-- tenant, et le jour où le worker serait né, n'importe quelle URL https
-- aurait été téléchargée par le serveur (SSRF).
--
-- CE QUI LE REMPLACE. Le partenaire DÉPOSE les octets (`POST /v1/uploads`,
-- contrat 2.0.0) : Iris vérifie et écrit lui-même, il n'y a plus rien à
-- copier, donc plus d'état intermédiaire. `copy_status` ne garde que
-- `copied` (le cas normal) et `error` (posé par la réconciliation du lot 4
-- quand une ligne n'a plus d'objet).
--
-- ⚠️ GARDE-FOU : refus si une ligne `pending` ou une `fetch_url` subsistait —
-- elle serait la promesse d'un fichier qu'on ne pourrait plus aller chercher,
-- et il faudrait la traiter avec le partenaire avant de l'effacer. Au
-- 2026-09-08 : zéro ligne dans les deux cas (vérifié en base).
--
-- Rollback : supabase/rollback/20260910_zone_attente_pieces_rollback.sql.
-- Après exécution : régénérer `src/types/database.types.ts`.
-- ============================================================================

do $$
declare
  v_pending bigint;
  v_urls    bigint;
begin
  select count(*) into v_pending from public.request_attachments where copy_status = 'pending';
  select count(*) into v_urls    from public.request_attachments where fetch_url is not null;
  if v_pending > 0 or v_urls > 0 then
    raise exception
      'RETRAIT REFUSÉ : % pièce(s) en attente de copie et % fetch_url. Un fichier promis par un partenaire ne s''efface pas au passage : le redemander par POST /v1/uploads, puis relancer.',
      v_pending, v_urls;
  end if;
end $$;

alter table public.request_attachments drop column if exists fetch_url;

alter table public.request_attachments
  drop constraint if exists request_attachments_copy_status_check;
alter table public.request_attachments
  add constraint request_attachments_copy_status_check
  check (copy_status in ('copied', 'error'));

comment on column public.request_attachments.copy_status is
  'copied : l''objet est dans le bucket (cas normal — depuis le contrat 2.0.0, tout octet est reçu et vérifié par le serveur avant la ligne). error : la réconciliation n''a pas retrouvé l''objet.';
comment on column public.request_attachments.checksum is
  'sha256 hexadécimal du fichier, calculé par le serveur à la réception (porte unique). NULL sur les lignes antérieures au 2026-09.';
