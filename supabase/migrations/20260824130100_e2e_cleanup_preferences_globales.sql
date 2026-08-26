-- ============================================================================
-- Purge du décor de re-vérification des préférences après leur passage en
-- portée GLOBALE (2026-08-24) — miroir de la migration de cleanup appliquée.
-- Leur absence rétablit le défaut (*fail open* : tout activé).
-- ============================================================================

delete from public.notification_preferences
 where user_id = '3bc951fd-1ea9-4d4f-a709-c9bd0ac7fad2';
