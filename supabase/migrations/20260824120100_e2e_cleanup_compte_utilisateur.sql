-- ============================================================================
-- Purge du décor de vérification de « Mon compte » (2026-08-24) — miroir de la
-- migration de cleanup appliquée.
--
-- Le décor : les préférences de notification posées depuis l'écran pendant la
-- vérification en navigateur, sur le compte de test du propriétaire du projet.
-- Leur absence rétablit le défaut (*fail open* : tout activé), c'est-à-dire
-- l'état d'origine du compte. La photo de test a été retirée depuis l'écran
-- lui-même (bouton « Retirer »), objet storage compris.
-- ============================================================================

delete from public.notification_preferences
 where user_id = '3bc951fd-1ea9-4d4f-a709-c9bd0ac7fad2';
