# Feature : droits et paramètres (`src/features/permissions`, `src/features/rights`)

Chargé automatiquement quand on travaille dans ces dossiers. Les invariants globaux du
`CLAUDE.md` racine (Socle source de vérité, RLS = vérité, aucune demande libre) priment sur ce
qui suit, ainsi que la spécification métier « profils de droits » (ADR-11).

Zone `/parametres/droits`, réservée aux administrateurs de tenant (`AdminRoute`, sous
`TenantProvider` — nécessite le tenant et les droits chargés). Remplace le rôle binaire
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
  (entrée « Paramètres », chip « Administrateur », liste des profils dans le menu compte,
  RM-46) et `DashboardPage` (RM-45).
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
- **`PermissionsPage`** (`/parametres/droits`) : bandeaux RM-63/RM-62 en tête, sections
  Profils (table + Modifier/Dupliquer/Désactiver-Réactiver/Supprimer, `AlertDialog` avec
  effectifs concernés RM-53, Supprimer désactivé si attribué RM-52), Utilisateurs (chips de
  profils grisés si désactivés, retrait par croix avec confirmation si perte de sa propre
  administration RM-42), Couverture (RM-62), Journal (RM-57, détail avant/après replié).
- `src/components/ui/alert-dialog.tsx` : confirmations destructives — construit sur
  `@radix-ui/react-dialog` (pas de dépendance `@radix-ui/react-alert-dialog` dans le projet),
  sans bouton de fermeture flottant, l'appelant garde `open` et ferme après succès.

- **Onglet Référentiel** (`ReferentielPanel`, 2026-08-22) : état du miroir Socle du tenant
  (organisations/démarches actives et obsolètes, dernière `synced_at` — `sync_runs` reste
  réservé à la plateforme) et bouton « Synchroniser maintenant » (`useTriggerSocleSync(orgId)`,
  feature `socle`) : la synchro lancée par un administrateur de tenant ne porte **que sur son
  tenant** — périmètre dérivé de l'appelant par l'edge `sync-socle-referentiel` (403/404 sinon).
