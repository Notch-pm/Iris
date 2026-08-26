-- ============================================================================
-- Purge du décor de vérification du doublage e-mail (2026-08-24) — miroir de
-- la migration de cleanup appliquée.
--
-- Le décor : UNE notification posée pour le compte de test du propriétaire du
-- projet, afin de vérifier la chaîne complète (boîte d'envoi → cron → edge
-- function → relais Mailjet du tenant). L'envoi a réussi au premier essai.
-- Aucun tiers n'a été destinataire : les deux comptes du tenant ACCM
-- appartiennent au même utilisateur.
--
-- Les migrations de seed sont retirées de l'historique : seule la trace du
-- cleanup subsiste (motif des campagnes E2E du projet).
-- ============================================================================

delete from public.notifications where payload ? 'e2e';

delete from supabase_migrations.schema_migrations
 where name in ('e2e_notifications_email_verif');
