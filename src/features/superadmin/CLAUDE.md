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
  `useTriggerSocleSync()` de la feature `socle` → edge `sync-socle-referentiel` avec le JWT de
  l'admin plateforme, appel synchrone, compteurs affichés, miroirs/caches invalidés) — ici
  la synchro est **globale** (tous les tenants) ; l'administrateur d'un tenant dispose de la
  sienne, limitée à son tenant, dans Paramètres › Référentiel.
  Logique d'arbre pure `socleOrgTree.ts` (testée).
- **Utilisateurs** (`/superadmin/utilisateurs`) : recherche, table (nom, email, badge Admin
  plateforme, rattachements par tenant), **invitation** (compte ouvert sans mot de passe,
  rattachement au tenant et lien d'activation envoyés d'un bloc côté serveur), édition (noms,
  statut plateforme — verrouillé sur soi-même —, accès par tenant appliqués immédiatement),
  **envoi d'un lien de réinitialisation** au titulaire, suppression (confirmée, interdite sur
  soi-même).
  ⚠️ **Aucun mot de passe n'est plus généré ni affiché** (2026-08-23) : l'ancien encart
  « Identifiants de connexion » a laissé place à un message d'issue (invitation envoyée /
  compte existant rattaché / compte créé mais mail non parti). Voir
  [`docs/emails.md`](../../../docs/emails.md).
- Rattachement à un tenant = **simple accès** (« Donner accès » / « Retirer l'accès »), **sans
  rôle** (RM-44) : `role` n'est plus qu'un filet de compatibilité (`agent`, écrasé par la
  colonne dérivée côté serveur). Colonne Tenants : chips d'accès + **profils de droits
  attribués** en lecture seule (`useAllProfileAssignments`, pastille « Aucun profil ») —
  l'attribution reste un geste du tenant (Paramètres — Droits), pas de la plateforme.
- **`admin-users`** (edge, JWT vérifié en code, CORS allowlist) : seules les opérations
  service_role y passent — `invite_user`, `send_password_reset`, `delete_user`
  (`send_test_email` retirée le 2026-08-23 avec l'écran Messagerie : le serveur d'envoi vient
  du Socle et se teste là-bas). Tout le reste (lecture, profils, appartenances) passe par le RLS.
  L'habilitation est **par action** et n'est plus « plateforme » partout : un administrateur
  de tenant invite dans SON tenant et renvoie un lien à SES membres (règles en SQL,
  `is_org_admin_anywhere_for` / `can_manage_account`) ; seule la suppression reste réservée à
  la plateforme. Le point d'entrée client commun est `src/lib/adminUsers.ts`.
