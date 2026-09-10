# Feature : droits et paramètres (`src/features/permissions`, `src/features/rights`)

Chargé automatiquement quand on travaille dans ces dossiers. Les invariants globaux du
`CLAUDE.md` racine (Socle source de vérité, RLS = vérité, aucune demande libre) priment sur ce
qui suit, ainsi que la spécification métier « profils de droits » (ADR-11).

Zone `/parametres`, réservée aux administrateurs de tenant (`AdminRoute`, sous
`TenantProvider` — nécessite le tenant et les droits chargés). `/parametres/droits`
(ancienne adresse) redirige vers `/parametres`. Remplace le rôle binaire
`agent | administrateur` par des **profils de droits** attribuables, plusieurs par
utilisateur : administration (oui/non), périmètre d'organisations Socle (sous-arbre implicite,
RM-25), matrice démarche × droits (consultation/création/instruction/clôture, RM-01), droits
par défaut pour toute démarche non listée y compris futures (RM-33).

- **`src/features/rights/rights.ts`** (pur, testé, **livré — ne pas réécrire, seulement
  compléter**) : miroir EXACT de la combinaison serveur (`my_rights`/`permission_pairs_of`) —
  `rightsFor`, `hasRight`, `isAdminOn`, `hasAnyProfile`, `canCreateProcedure`/
  `creatableProcedures`/`creationOrganizationIds` (RM-58/59), `canViewProcedure`/
  `viewableProcedures` (lecture), `explainRight` (RM-46). Ce module ne protège rien : la
  vérité est dans le RLS Postgres.
- **`src/features/rights/useRights.ts`** : `useMyRights(orgId)` (TanStack Query, keyée sur
  l'id utilisateur — jamais l'objet session, piège documenté), parse défensif du JSON de la
  RPC (`MyRights`), repli `emptyRights`. `invalidateRights(queryClient)` exportée pour les
  mutations hors de cette feature.
- **`TenantProvider`** expose `rights`, `rightsLoading`, `isAdmin` (admin plateforme ou profil
  `is_admin` actif) et `hasAnyProfile` en plus des appartenances — consommés par `AppShell`
  (accès « Paramètres » **en haut à droite du header**, icône `assets/icons/parametres.svg`
  recopiée de Clara — pas dans le rail ; chip « Administrateur », liste des profils dans le
  menu compte, RM-46) et `DashboardPage` (RM-45).
- **`profileValidation.ts`** (pur, testé, **livré**) : `ProfileDraft`, `PRESET_LEVELS`
  (RM-03), `validateProfileDraft` (RM-05/06, bloquant), `profileWarnings` (RM-04, non
  bloquant), `toSavePayload` (contrat de `save_permission_profile`).
- **`profileRows.ts`** (pur, testé) : fusion des trois tables filles d'un profil en
  `ProfileRow`, conversions vers/depuis `ProfileDraft` (`draftFromProfileRow`,
  `draftForDuplicate`, `draftFromTemplate`), modèles de reprise rapide (`PROFILE_TEMPLATES`,
  RM-51), résumé de matrice pour la table des profils.
- **`usePermissions.ts`** : lecture (profils avec périmètre + matrice, membres du tenant avec
  profils attribués, `members_without_profile` RM-63, `permission_coverage_report` RM-62,
  journal `permission_audit_log` 50 dernières entrées RM-57, miroir `socle_organizations` et
  cache `socle_procedure_cache` actif+obsolète) et mutations (`useSaveProfile`,
  `useSetProfileStatus`, `useDeleteProfile`, `useAssignProfile`, `useRevokeProfile`) — chacune
  invalide la feature ET `my-rights` ET `tenant-memberships` (RM-08, RM-43). Erreurs RPC
  (Postgres, déjà en français) affichées telles quelles (RM-09), y compris le verrou
  optimiste (RM-56).
- **`OrgScopePicker`** : arbre du miroir Socle à cases à cocher (ergonomie
  `superadmin/socleOrgTree`), sous-arbre implicite (aucune expansion visuelle — le serveur
  expanse), nœuds obsolètes non proposés à l'ajout mais togglables au retrait s'ils sont déjà
  dans le profil (RM-30).
- **`RightsPicker`** : sélecteur de niveau prédéfini (RM-03) + mode détaillé à trois cases
  (consultation toujours impliquée), réutilisé pour les droits par défaut et chaque ligne de
  `ProfileMatrix`.
- **`ProfileMatrix`** : démarches actives groupées par catégorie Socle, recherche, action
  « appliquer à toute la catégorie », compteur « N démarches actives relèvent du défaut »
  (RM-34), lignes de démarches obsolètes/inconnues conservées avec badge (RM-35, CL-25).
- **`ProfileDialog`** : formulaire contrôlé sur `ProfileDraft` — nom, description,
  administration (aide RM-22 : n'accorde aucun droit sur les demandes), périmètre, défaut,
  matrice, avertissements non bloquants, erreurs bloquantes, erreur serveur affichée telle
  quelle avec bouton « Recharger » sur verrou optimiste.
- **`PermissionsPage`** (`/parametres`) — **motif Clara `SettingsPage`** (2026-08-23) :
  un **accueil en blocs cliquables** (`SECTIONS`, grille 1/2/3 colonnes : titre, description,
  pastille d'icône `bg-primary/10`) et **une seule section affichée à la fois**, avec retour
  par la flèche à gauche du titre (`ArrowLeft`) ; le sous-titre de l'en-tête porte le nom de
  la section. Plus de barre d'onglets (et donc plus de `role="tab"`/`tabpanel` ni de
  navigation par flèches) : les blocs sont de vrais `<button>`. L'**action de tête**
  « Synchroniser le référentiel » est à droite du titre sur l'accueil, comme chez Clara.
  L'état est local (`section`, valeur initiale `"menu"`), non porté par l'URL — idem Clara.
  Les bandeaux RM-63/RM-62 restent en tête de l'accueil et mènent aux sections concernées.
  Sections : Profils (table + Modifier/Dupliquer/Désactiver-Réactiver/Supprimer,
  `AlertDialog` avec effectifs concernés RM-53, Supprimer désactivé si attribué RM-52),
  Utilisateurs (chips de profils grisés si désactivés, retrait par croix avec confirmation si
  perte de sa propre administration RM-42), Couverture (RM-62), Référentiel, Journal (RM-57,
  détail avant/après replié).
- `src/components/ui/alert-dialog.tsx` : confirmations destructives — construit sur
  `@radix-ui/react-dialog` (pas de dépendance `@radix-ui/react-alert-dialog` dans le projet),
  sans bouton de fermeture flottant, l'appelant garde `open` et ferme après succès.

- **Section Référentiel** (`ReferentielPanel`, 2026-08-22) : état du miroir Socle du tenant
  (organisations/démarches actives et obsolètes, dernière `synced_at` — `sync_runs` reste
  réservé à la plateforme) et bouton « Synchroniser maintenant ». La mutation
  (`useTriggerSocleSync(orgId)`, feature `socle`) est **instanciée une seule fois dans
  `PermissionsPage`** et passée en prop (`SocleSyncMutation`) : le bouton de l'accueil et
  celui de la section partagent le même état « en cours » et le même compte rendu. La synchro
  lancée par un administrateur de tenant ne porte **que sur son tenant** — périmètre dérivé de
  l'appelant par l'edge `sync-socle-referentiel` (403/404 sinon).

- **Pas de section Messagerie** (retirée le 2026-08-23, décision PO) : le serveur d'envoi ne se
  configure pas dans Iris, il vient du **Socle** (organisation principale, onglet « Emails
  (SMTP) ») et `smtp_settings` n'est qu'un miroir écrit par la synchro du référentiel. Il n'y a
  donc plus rien à afficher ici : ni saisie, ni consultation (la table n'a plus aucune surface
  cliente), ni test d'envoi — il se fait dans le Socle. Diagnostic côté Iris :
  `sync_runs.counters` (`smtp_synchronises`, `smtp_retires`, `warnings`).
  Détail : [`docs/emails.md`](../../../docs/emails.md).
- **Invitation d'un membre** (section Utilisateurs) : `admin-users` (`invite_user`) avec le
  tenant courant imposé — même implémentation que la zone superadmin, habilitation SQL
  `is_org_admin_anywhere_for`. Bouton clé par membre : renvoi d'un lien de mot de passe
  (`can_manage_account`). Rappel affiché : sans profil attribué, l'invité ne voit aucune
  demande. Détail : [`docs/emails.md`](../../../docs/emails.md).
- La page s'intitule **« Paramètres »** (et non « Paramètres — Droits ») : elle porte cinq
  sections (Profils de droits, Utilisateurs, Couverture des démarches, Référentiel Socle,
  Journal des modifications), dont une ne relève pas des droits (Référentiel). Ajouter une
  section = une entrée dans `SECTIONS` + un bloc conditionnel dans le rendu.

## Sections ajoutées par d'autres features (2026-08-26)

Deux sections vivent dans `src/features/templates` et sont branchées ici selon la règle
d'extension ci-dessus (une entrée dans `SECTIONS` + un bloc conditionnel) :

- **« Modèles d'e-mail »** — CRUD des modèles de réponse à l'usager.
- **« Organisations »** — ancienne entrée « Référentiel Socle », **renommée** : elle porte
  désormais l'arbre des organisations que l'utilisateur administre et l'activation des modèles
  organisation par organisation. `ReferentielPanel` (état de la synchro) y reste affiché en
  dessous — c'est là qu'on vient quand une organisation manque à l'arbre.

Le périmètre documenté de cette feature reste « permissions + rights » : ces deux panneaux
n'y vivent pas, seul leur branchement est ici.

## Attribut « Intervenant » (2026-09-14)

`ProfileDraft.isIntervenant` ↔ `permission_profiles.is_intervenant` ↔ payload
`is_intervenant` de `save_permission_profile`. Second attribut de profil après
l'administration : case à cocher dans `ProfileDialog`, badge « Intervenant » dans la table
des profils, modèle de reprise rapide « Intervenant » (`PROFILE_TEMPLATES`, aucun droit
par défaut). `validateProfileDraft` admet un profil intervenant sans aucun droit — jumeau
de `validate_permission_profile_shape`. Côté droits, `MyRights.is_intervenant` et
`RightsProfile.is_intervenant` sont exposés par `my_rights` ; ils n'entrent dans AUCUN
calcul de `rightsFor` (l'attribut n'accorde rien sur les demandes). Doctrine :
[`docs/droits.md`](../../../docs/droits.md) ; écran : `src/features/requests/interventions/`.
