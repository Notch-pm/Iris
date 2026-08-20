-- ============================================================================
-- Promotion admin plateforme du compte fondateur (rôle « superadmin » d'Iris :
-- provisioning des tenants, clés d'intégration, supervision — voir
-- docs/data-model.md §Identité). Idempotent — sans effet si le compte n'existe
-- pas dans l'environnement ; le trigger anti-escalade
-- users_prevent_admin_escalation autorise le contexte de service.
-- ============================================================================
update public.users
   set is_platform_admin = true
 where email = 'jacquotlaurent@gmail.com';
