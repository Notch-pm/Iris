-- ============================================================================
-- Purge du décor de vérification des mentions (2026-08-24) — miroir de la
-- migration de cleanup appliquée.
--
-- Le décor : une note interne posée depuis l'écran sur DEM-2026-000005,
-- mentionnant le second compte du propriétaire du projet, pour vérifier la
-- chaîne complète (menu « @ » → garde de consultation → notification
-- « mentioned » → boîte d'envoi → e-mail). L'envoi a réussi au premier essai.
-- Aucun tiers n'a été destinataire : les deux comptes du tenant ACCM
-- appartiennent au même utilisateur.
-- ============================================================================

delete from public.notifications
 where request_id in (select id from public.requests where reference = 'DEM-2026-000005');

delete from public.request_messages
 where body like '%Peux-tu regarder%merci.%';
