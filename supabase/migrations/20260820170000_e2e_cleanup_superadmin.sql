-- ============================================================================
-- Trace historique — nettoyage de la vérification navigateur de la zone
-- superadmin (2026-08-20) : compte plateforme jetable supprimé, entrées de
-- migration e2e_* purgées. Rejouable à vide sur tout environnement.
-- ============================================================================
delete from auth.users where email = 'superadmin.e2e@iris.test';
