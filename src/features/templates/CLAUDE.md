# Modèles d'e-mail (`src/features/templates`)

Textes réutilisables pour écrire à un usager, avec des **variables** remplacées par les
informations de la demande. Livré le 2026-08-26 ; **rédigés dans le SOCLE depuis le
2026-11-12** (décision PO) : Iris n'a plus d'éditeur, il lit un miroir.

## D'où viennent les modèles

Le Socle (Référentiels › Modèles de courriels) tient, par collectivité :
- les **courriels système** — textes des messages automatiques à l'usager (accusé, avis,
  clôture, code d'accès, nouveau message), lus par l'envoi côté serveur
  (`supabase/functions/_shared/email/socleTemplates*.ts`, voir `docs/emails.md`) ;
- les **modèles créés**, cochés pour Iris et **activés organisme par organisme** — ceux que
  l'agent choisit dans l'onglet Échanges.

`sync-socle-referentiel` recopie les deux dans `socle_email_templates` (RPC de service
`sync_email_templates_from_socle`, miroir strict par tenant). Aucune écriture cliente. Les
anciennes tables d'Iris (`email_templates`, `email_template_organizations`) sont supprimées ;
leurs trois modèles ont été rapatriés dans le Socle avec leurs organisations.

## Règles qui restent

- **Pas de descendance implicite** : un modèle n'est proposé que sur les organisations Socle
  cochées nommément (`useActiveEmailTemplates`, égalité stricte sur `socle_scope_org_id`).
  Liste vide = normal, l'agent rédige à la main.
- **Le catalogue de variables est celui du Socle** (`GET /v1/email-templates/variables`,
  `common`), que le Socle **garde en base** : il refuse un modèle qui cite une autre clé.
  `TEMPLATE_VARIABLES` (`templates.ts`) en est la copie, testée contre la liste du Socle ;
  `requestTemplateValues` (`requests/instruction/courriel.ts`) remplit chaque clé. Une clé
  ajoutée au Socle doit l'être ici et là, sinon elle part vide.
- **Valeur absente ⇒ clé omise**, jamais un mot d'écran de gestion (règle de `courriel.ts`).
- Texte **brut**, sections `{{#cle}}…{{/cle}}` rendues par `renderTemplate`, qui délègue au
  moteur partagé avec les courriels automatiques (`@fn/_shared/email/socleTemplates`).
- `request_emails.template_id` porte l'identifiant **Socle** nu du modèle (plus de FK).

## Fichiers

| Fichier | Rôle |
|---|---|
| `templates.ts` | **Pur, testé** : catalogue (`TEMPLATE_VARIABLES`), `renderTemplate`, `buildOrgTree` / `flattenOrgTree`. |
| `useEmailTemplates.ts` | Lecture du miroir : `useActiveEmailTemplates` (Échanges), `useSocleCustomTemplates` (vue d'ensemble), `useAdministrableOrganizations`. |
| `OrganisationsPanel.tsx` | Paramètres › Organisations : arbre administrable, nombre de modèles proposés par organisation (lecture seule), et le `ReferentielPanel` (synchronisation) dessous. |
