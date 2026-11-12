-- ============================================================================
-- Retrait des modèles d'e-mail PROPRES à Iris (décision PO du 2026-11-12).
--
-- Les modèles se rédigent désormais dans le Socle ; Iris en tient le miroir
-- `socle_email_templates` (migration `modeles_courriels_socle`). Les trois
-- modèles qui existaient (« Document incomplet », tenants ACCM, Agglomération
-- Normandie Démo, Mairie de Saint Laurent) ont été rapatriés dans le Socle le
-- même jour, avec leurs organisations d'activation.
--
-- Appliquée le 2026-11-12, après le déploiement du code (le code précédent lisait
-- encore `email_templates`).
--
-- `request_emails.template_id` n'a plus de FK depuis la migration précédente :
-- l'historique des échanges garde ses identifiants et `template_name`.
-- `administrable_organizations` reste : l'arbre des Paramètres s'en sert.
-- Rejouable : IF EXISTS partout.
-- ============================================================================

drop table if exists public.email_template_organizations;
drop table if exists public.email_templates;

drop function if exists public.email_template_check_tenant_scope();
drop function if exists public.email_templates_guard_variables();
drop function if exists public.email_template_unknown_variables(text);
drop function if exists public.email_template_variables();
