-- ============================================================================
-- Fermeture de l'ancien chemin des pièces — plus aucune écriture CLIENTE
-- (lot 2b du chantier documents, 2026-09-08).
--
-- ⚠️ À N'APPLIQUER QU'UNE FOIS LE LOT 2a DÉPLOYÉ (migration 20260911100000,
-- edge functions request-attachments / create-request-from-procedure /
-- send-request-email / generate-request-document, et le front) : après cette
-- migration, un navigateur qui écrirait encore lui-même dans le bucket serait
-- refusé.
--
-- CE QUI FERME, ET POURQUOI :
--   · `request_attachments_insert` (table) — la policy vérifiait le droit
--     d'instruction et `uploaded_by`, mais PAS `storage_path` : un agent
--     pouvait déclarer un chemin arbitraire du bucket, que `send-request-email`
--     téléchargeait ensuite en service_role pour le joindre à un courriel.
--     Toute écriture passe désormais par une RPC DEFINER ou le service_role,
--     qui relisent le chemin dans la zone d'attente.
--   · `request_attachments_storage_insert` et `_delete` (storage) — le
--     navigateur n'écrit plus un octet : la porte est l'edge function
--     `request-attachments`. Avec elles disparaît la branche « brouillon »
--     (objet sous une demande inexistante, visible à vie par son déposant, et
--     vecteur d'écriture non borné : 25 Mio × N sous des chemins fictifs).
--   · `request_attachments_storage_select` est RÉÉCRITE sans cette branche :
--     lire un objet = pouvoir lire la demande de son 2ᵉ segment, rien d'autre.
--     La zone d'attente (`_staging`, pas un UUID) y est invisible par
--     construction.
--   · `has_any_creation_right(uuid)` n'avait plus d'appelant (la policy INSERT
--     storage) : retirée. Sa variante `_for`, appelée par les edge functions,
--     reste.
--
-- CE QUI S'AJOUTE : `allowed_mime_types` sur le bucket — la liste fermée que
-- la porte unique applique déjà sur le CONTENU. Le bucket la rejoue sur le type
-- déclaré à l'écriture, service_role compris : ceinture et bretelles.
--
-- ⚠️ GARDE-FOU : refus si un objet existant porte un type ACTIF (SVG, HTML,
-- script) — il serait servi inline depuis le domaine du stockage. Les autres
-- types hors liste (un `text/plain` de test, au 2026-09-08) sont signalés et
-- laissés : la restriction ne vaut que pour les écritures à venir.
--
-- Rollback : supabase/rollback/20260911_pieces_policies_serveur_rollback.sql.
-- ============================================================================

do $$
declare
  v_active  text;
  v_others  text;
  v_allowed text[] := array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet'];
begin
  select string_agg(name || ' (' || coalesce(metadata ->> 'mimetype', '?') || ')', ', ')
    into v_active
    from storage.objects
   where bucket_id = 'request-attachments'
     and coalesce(metadata ->> 'mimetype', '') in (
       'image/svg+xml', 'text/html', 'application/xhtml+xml', 'application/javascript',
       'text/javascript', 'application/x-msdownload', 'application/x-sh');
  if v_active is not null then
    raise exception 'FERMETURE REFUSÉE : objet(s) à contenu actif dans le bucket, à retirer d''abord : %', v_active;
  end if;

  select string_agg(name || ' (' || coalesce(metadata ->> 'mimetype', '?') || ')', ', ')
    into v_others
    from storage.objects
   where bucket_id = 'request-attachments'
     and not (coalesce(metadata ->> 'mimetype', '') = any (v_allowed));
  if v_others is not null then
    raise notice 'Objets antérieurs hors de la liste des types acceptés (laissés, lisibles, jamais réécrits) : %', v_others;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Table : plus d'INSERT client. SELECT (suit la demande) et DELETE (admin)
--    inchangées.
-- ---------------------------------------------------------------------------
drop policy if exists request_attachments_insert on public.request_attachments;
comment on table public.request_attachments is
  'Pièces d''une demande (usager, instruction, courriers, pièces jointes des échanges). AUCUNE écriture cliente depuis le 2026-09-08 : les RPC DEFINER (attach_request_piece, qualify_request_attachment) et le service_role sont les seules portes ; l''octet entre par la porte unique _shared/files/receive.ts.';

-- ---------------------------------------------------------------------------
-- 2. Storage : le navigateur ne fait plus que LIRE, et seulement ce que la
--    demande du chemin lui ouvre.
-- ---------------------------------------------------------------------------
drop policy if exists "request_attachments_storage_insert" on storage.objects;
drop policy if exists "request_attachments_storage_delete" on storage.objects;
drop policy if exists "request_attachments_storage_select" on storage.objects;
create policy "request_attachments_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and public.can_read_request(public.uuid_or_null((storage.foldername(name))[2]))
  );

update storage.buckets
   set allowed_mime_types = array[
     'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.oasis.opendocument.text',
     'application/vnd.oasis.opendocument.spreadsheet']
 where id = 'request-attachments';

-- ---------------------------------------------------------------------------
-- 3. Helper sans appelant.
-- ---------------------------------------------------------------------------
drop function if exists public.has_any_creation_right(uuid);
