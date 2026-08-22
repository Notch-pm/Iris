# Feature : zone superadmin (`src/features/superadmin`)

Chargé automatiquement quand on travaille dans ce dossier. Les invariants globaux du
`CLAUDE.md` racine (Socle source de vérité, snapshots construits côté serveur, RLS = vérité,
aucun miroir d'usagers, aucune demande libre) priment sur tout ce qui suit.

Zone à shell séparé (motif Socle/Clara), réservée aux **admins plateforme**
(`users.is_platform_admin`, garde `SuperAdminRoute` ; lien « Superadmin » dans le rail de
l'app pour les seuls admins plateforme — pas de redirection forcée, contrairement à Socle).
Vérifiée au navigateur le 2026-08-20 (arbre, création/rattachement/suppression d'utilisateur).

- **Organisations** (`/superadmin`) : une carte par tenant, arbre du miroir Socle
  (ergonomie Clara `SocleOrganizationTree` : tout déplié, chevrons, badge Obsolète) —
  **consultation uniquement, la hiérarchie se gère dans le Socle** ; dernière sync affichée ; **bouton « Synchroniser maintenant »** (motif Clara :
  `useTriggerSocleSync` → edge `sync-socle-referentiel` avec le JWT de l'admin plateforme,
  appel synchrone, compteurs affichés, miroirs/caches invalidés).
  Logique d'arbre pure `socleOrgTree.ts` (testée).
- **Utilisateurs** (`/superadmin/utilisateurs`) : recherche, table (nom, email, badge Admin
  plateforme, rattachements par tenant), création (mot de passe généré **affiché une seule
  fois**), édition (noms, statut plateforme — verrouillé sur soi-même —, accès par tenant
  appliqués immédiatement), réinitialisation de mot de passe, suppression (confirmée,
  interdite sur soi-même).
- Rattachement à un tenant = **simple accès** (« Donner accès » / « Retirer l'accès »), **sans
  rôle** (RM-44) : `role` n'est plus qu'un filet de compatibilité (`agent`, écrasé par la
  colonne dérivée côté serveur). Colonne Tenants : chips d'accès + **profils de droits
  attribués** en lecture seule (`useAllProfileAssignments`, pastille « Aucun profil ») —
  l'attribution reste un geste du tenant (Paramètres — Droits), pas de la plateforme.
- **`admin-users`** (edge, JWT + is_platform_admin vérifiés en code, CORS allowlist) : seules
  les opérations service_role y passent — `create_user`, `set_password`, `delete_user`.
  Tout le reste (lecture, profils, appartenances) passe par le RLS.
