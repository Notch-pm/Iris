-- ============================================================================
-- Purge du décor de vérification en navigateur des modèles d'e-mail
-- (2026-08-26) — miroir de la migration de cleanup appliquée.
--
-- Le décor : un modèle « Accusé de réception » créé depuis l'écran pour
-- vérifier la chaîne complète (variables cliquables, aperçu, garde serveur,
-- enregistrement). C'est cette vérification qui a révélé le défaut corrigé par
-- 20260826100100.
-- ============================================================================

delete from public.email_templates;
