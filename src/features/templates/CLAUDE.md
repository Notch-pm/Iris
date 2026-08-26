# Modèles d'e-mail (`src/features/templates`)

Textes réutilisables pour répondre à un usager, avec des **variables** remplacées par les
informations de la demande. Administrés depuis les Paramètres, activés **organisation par
organisation**. Livré le 2026-08-26.

Deux sections des Paramètres vivent ici (branchées dans `PermissionsPage` selon la règle
documentée : « une entrée dans `SECTIONS` + un bloc conditionnel ») :
**« Modèles d'e-mail »** (le CRUD) et **« Organisations »** (l'arbre + l'activation).

## Vocabulaire : « modèle d'e-mail », jamais « modèle de courrier »

Décision PO du 2026-08-26. « Courrier » désigne l'objet métier de **Clara** dans toute la
gamme (`source='clara'`, `channel='courrier'`) : le mot serait ambigu dans Iris. La décision
d'architecture **D7** dit d'ailleurs que « le canal d'origine porte la communication » — Iris
produit le **texte**, Clara produit le pli — et **Q8** (« qui sait signer et produire un PDF
gabarié ») reste ouverte au profit de Clara. D'où : **texte brut**, ni HTML, ni PDF.

## Le catalogue de variables est un contrat, et il a un jumeau en base

`TEMPLATE_VARIABLES` (`templates.ts`) et `public.email_template_variables()` (SQL) doivent
rester **identiques** — clés et ordre. Chaque clé correspond à une donnée qu'Iris possède
réellement.

C'est **la base** qui refuse une variable inconnue (`t03_email_templates_guard_variables`) ;
`validateTemplateDraft` ne fait que le dire plus tôt et en français. Ajouter une variable au
front **sans migration** donnerait un écran qui promet ce que le serveur refuse.

⚠️ **`demande.date_instruction` n'est pas une colonne** : c'est le premier `status_changed`
vers `en_instruction` dans `request_events`. Sans effet tant que l'aperçu tourne sur des
valeurs d'exemple ; à câbler le jour où la résolution portera sur de vraies demandes — et
attention, `buildStages()` (`requests/instruction/instruction.ts`) fait déjà ce calcul mais
avec un `visited.set` qui **écrase** : après une réouverture il retient le *dernier* passage,
pas le premier.

## Activation par organisation

`email_template_organizations (template_id, socle_org_id)` — satellite au motif de
`permission_profile_organizations`. **Un modèle neuf n'est activé nulle part** : l'ouverture
est un geste, il n'y a rien à refermer après coup.

- **Pas de descendance implicite**, contrairement au périmètre d'un profil de droits : chaque
  organisation est activée nommément. Activer sur la racine n'active pas les services.
- **Qui active** : `has_admin_scope(tenant, socle_org)` — l'administration effective sur
  CETTE organisation. Et non `is_org_admin_anywhere`, qui gouverne l'écriture du modèle
  lui-même (objet de tenant) : ouvrir un modèle à la Voirie est une décision sur la Voirie, et
  un administrateur borné au CCAS n'a pas à la prendre.
- Deux angles de réglage, **une seule bascule** (`OrganisationToggles.tsx`) : depuis un modèle
  (« dans quelles organisations ? ») et depuis une organisation (« quels modèles ? »).
- Chaque bascule **écrit immédiatement**. Un rattachement est une ligne, pas un champ du
  formulaire : le mêler à l'enregistrement du texte obligerait à réconcilier deux écritures
  qui n'échouent pas ensemble. C'est aussi pourquoi le contenu et l'activation vivent dans
  **deux modales distinctes** (décision PO 2026-08-26) — deux gestes, deux modes
  d'enregistrement.
- `t01_email_template_organizations_scope` tient la cohérence de tenant — aucune FK ne peut
  le faire, `socle_org_id` étant un UUID Socle nu.

## Écriture par policies, pas par RPC

À rebours des tables `permission_*` voisines, et délibérément. Le projet retient la RPC quand
l'écriture est **composite**, quand un invariant échappe au `with check`, quand une policy
bouclerait sur le moteur de droits, ou quand une colonne est un secret
(`docs/data-model.md` §Principes). Aucun de ces cas : une ligne, un prédicat simple. La seule
règle qui dépasse le prédicat — la validité des variables — est portée par un **trigger**, qui
ne se contourne pas davantage qu'une RPC.

**Verrou optimiste sans RPC** : `update … where id = ? and version = ?`, puis `version + 1`.
Zéro ligne affectée = conflit (motif RM-56 de `permission_profiles`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `templates.ts` | **Pur, testé (32 cas)** : catalogue, `parseVariables` / `unknownVariables` (jumeaux du motif SQL), `renderTemplate`, `previewValues`, `insertVariable`, `validateTemplateDraft`, et `buildOrgTree` / `flattenOrgTree`. |
| `useEmailTemplates.ts` | Lecture et écritures ; `useAdministrableOrganizations`, `useTemplateLinks` (TOUS les rattachements en une requête — le volume est celui d'un paramétrage), `useToggleTemplateOrganization`. |
| `EmailTemplatesPanel.tsx` | Section « Modèles d'e-mail » : liste et **trois actions par ligne** — modifier le contenu, définir les organisations, supprimer. |
| `EmailTemplateDialog.tsx` | **Modale 1** — le contenu : formulaire, variables cliquables, aperçu. Rend l'identifiant ET le nom du modèle enregistré (`onSaved`), l'appelant enchaînant sur la modale 2. |
| `TemplateOrganisationsDialog.tsx` | **Modale 2** — l'activation par organisation. S'ouvre soit dans la foulée d'un enregistrement (avec une phrase d'accueil qui explique qu'un modèle neuf n'est actif nulle part), soit depuis l'action dédiée de la liste. |
| `OrganisationsPanel.tsx` | Section « Organisations » : arbre administrable, modale par organisation, et le `ReferentielPanel` conservé en dessous. |
| `OrganisationToggles.tsx` | La bascule partagée par les deux modales. |

## Pièges rencontrés — à ne pas rejouer

- **La garde de variables doit être `SECURITY DEFINER`.** En `INVOKER`, elle s'exécute comme
  l'agent, qui n'a aucun droit sur le catalogue — justement révoqué. Toute écriture échouait
  alors en `permission denied for function email_template_unknown_variables`. Migration de
  correction : `20260826100100`.
- **Un test qui avale toutes les erreurs ne teste rien.** Les scénarios « la variable inconnue
  est refusée » utilisaient `exception when others then null` : ils accueillaient le
  `permission denied` ci-dessus comme un refus légitime. Le test était vert, le client réel
  échouait. Ils vérifient désormais le **message** du refus.
- **Ne pas mémoriser une position de curseur dans une ref** pour insérer une variable : elle
  se désynchronise du contenu dès la frappe suivante. `EmailTemplateDialog` lit `el.value` et
  `el.selectionStart` **dans le DOM** au moment de l'insertion.
- **`onSaved` doit remonter le NOM depuis la modale**, pas le lire dans l'état du parent :
  celui-ci ne connaît que le brouillon d'OUVERTURE. Le titre de la seconde modale affichait
  « Modèle » au lieu du nom qui venait d'être saisi.
- **Les erreurs PostgREST ne sont pas des `Error`** : sans enveloppe (`asError`), le message
  du serveur — déjà en français — est remplacé par un générique inutile. Même rôle que
  `rpcError()` dans `usePermissions.ts`.

## Branchement dans la fiche demande — livré le 2026-08-26

Les modèles servent désormais **pour de vrai**, depuis l'onglet **Échanges**
([`../requests/CLAUDE.md`](../requests/CLAUDE.md)). Trois points qui concernent ce dossier :

- **La résolution sur une vraie demande vit dans `requests/instruction/courriel.ts`**, pas ici :
  le résolveur connaît une demande, donc le spécifique importe le général (`renderTemplate`),
  jamais l'inverse.
- **`useActiveEmailTemplates(orgId, socleOrgId)`** (dans `useEmailTemplates.ts`) ne propose que
  les modèles **activés** pour l'organisation porteuse de la demande (`socle_scope_org_id`,
  NOT NULL, et non `socle_organization_id` qui est nullable). Égalité stricte : « pas de
  descendance implicite » vaut aussi ici. Une liste vide est un résultat normal.
- **La question laissée ouverte par cette feature est tranchée** : la doctrine « ce qui sort
  d'Iris » de `_shared/email/notifications.ts` vise les e-mails de **notification**, qui vont
  aux agents ; elle ne s'applique pas à une réponse délibérée à l'usager, qui est la personne
  concernée. Ce qui reste vrai sans exception : le corps d'une note interne ne sort jamais.
  Détail : [`../../../docs/emails.md`](../../../docs/emails.md) §4.

`DocumentsPane` reste grisé pour les pièces d'instruction et les courriers (génération de PDF :
question **Q8**, ouverte au profit de Clara).

## Ce qui n'est pas fait

La suppression d'un modèle ne casse pas les échanges déjà partis (`template_id` passe à `null`,
`template_name` reste figé), mais **rien ne dit à l'administrateur combien d'envois s'appuient
sur un modèle** avant qu'il le supprime.

## Tests

- `templates.test.ts` — module pur, 32 cas.
- [`supabase/tests/modeles-email.test.sql`](../../../supabase/tests/modeles-email.test.sql)
  — **8 groupes** : création par un administrateur, variable inconnue refusée **avec le bon
  message**, texte entre accolades ordinaire accepté, nom unique par tenant, verrou optimiste,
  étanchéité cross-tenant, agent qui lit sans écrire, catalogue hors de portée d'`authenticated`.
- [`supabase/tests/modeles-email-organisations.test.sql`](../../../supabase/tests/modeles-email-organisations.test.sql)
  — **10 groupes** : modèle neuf actif nulle part, administrateur racine vs **administrateur
  borné à une branche** (le cœur du fichier), agent sans administration, étanchéité
  cross-tenant, garde de cohérence de tenant, cascade à la suppression.
- Vérifié en navigateur le 2026-08-26 : création avec variables cliquables et aperçu, arbre
  des 8 organisations d'ACCM, activation depuis les deux angles avec répercussion croisée,
  puis enchaînement des deux modales et ouverture directe par l'action de ligne.
