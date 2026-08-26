-- ============================================================================
-- Purge du décor de vérification de la séparation en deux modales
-- (2026-08-26) — miroir de la migration de cleanup appliquée.
--
-- ⚠️ Suppression NOMINATIVE, pas un `delete from` global : un modèle
-- « Document incomplet » créé par le propriétaire du projet pendant la session
-- ne devait pas être emporté. La cascade de `email_template_organizations`
-- retire les rattachements des deux modèles visés.
-- ============================================================================

delete from public.email_templates
 where name in ('Demande recevable', 'Rejet — pièce manquante');
