-- ============================================================================
-- Purge du décor de vérification VISUELLE du volet de notifications
-- (2026-08-24) — miroir de la migration de cleanup appliquée.
--
-- Le décor consistait en quelques lignes de `notifications` posées pour un
-- utilisateur réel du tenant ACCM, afin de photographier le volet (groupes,
-- libellés, pastille, accusé de lecture, push temps réel). Aucune demande n'a
-- été créée : une notification n'est pas une pièce administrative, elle se
-- supprime. Les lignes de seed portaient `payload ? 'e2e'`.
--
-- Les migrations de seed sont retirées de l'historique : seule la trace du
-- cleanup subsiste (motif des campagnes E2E du projet, voir les autres
-- `*_e2e_cleanup_*.sql`).
-- ============================================================================

delete from public.notifications where payload ? 'e2e';

delete from supabase_migrations.schema_migrations
 where name in ('e2e_seed_notifications_verif_ui',
                'e2e_notifications_reset_read_at',
                'e2e_notifications_push_temps_reel');
