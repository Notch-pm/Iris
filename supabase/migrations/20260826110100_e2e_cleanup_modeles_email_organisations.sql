-- ============================================================================
-- Purge du décor de vérification en navigateur de l'activation par
-- organisation (2026-08-26) — miroir de la migration de cleanup appliquée.
--
-- Le décor : un modèle « Accusé de réception » activé sur ACCM, Services
-- techniques et Mairie de Fontvieille, pour vérifier les deux angles de
-- réglage (depuis le modèle et depuis l'organisation) et leur cohérence.
-- La cascade de `email_template_organizations` emporte les rattachements.
-- ============================================================================

delete from public.email_templates;
