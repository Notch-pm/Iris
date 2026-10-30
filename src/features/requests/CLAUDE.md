# Feature : parcours agent (`src/features/requests`, `src/features/tenant`)

Chargé automatiquement quand on travaille dans ce dossier. Les invariants globaux du
`CLAUDE.md` racine (Socle source de vérité, snapshots construits côté serveur, RLS = vérité,
aucun miroir d'usagers, aucune demande libre) priment sur tout ce qui suit.

Ce fichier est un **index** (2026-10-30) : il garde les modules transverses du dossier, et
pour chaque écran ce qu'il faut savoir avant d'ouvrir sa fiche `docs/features/`. **Le détail
— décisions, pièges, pointeurs de code — vit dans la fiche, et c'est là qu'on l'écrit.**
Taille tenue par `src/claudeMd.test.ts`.

Premier parcours applicatif, livré et **vérifié en navigateur réel** (2026-08-20) : connexion →
sélection du tenant → liste filtrée/paginée → création manuelle → fiche → prise en charge →
note interne → résolution avec texte de clôture → journal.

- **`TenantProvider`** (`features/tenant/`) : appartenances de l'utilisateur
  (`organization_members` + `organizations`), tenant courant persisté en localStorage,
  sélecteur dans le header d'`AppShell` (masqué si un seul tenant), rôle affiché en badge.
- **`statuts.ts`** (pur, testé) : libellés FR des 7 statuts/motifs/priorités et
  **`allowedTransitions(status, role)`** — miroir EXACT de la garde SQL
  `requests_guard_transition` (exigences : assigné, motifs — le texte de clôture n'est plus
  exigé depuis le 2026-08-28, d'où `asksClosureText` et non `needs…` ; portes :
  réouverture superviseur+, archivage/désarchivage admin ; lecteur = rien). ⚠️ Ce module ne
  protège rien : il reflète ce que le trigger acceptera. Toute évolution de la matrice SQL se
  répercute ICI et dans `statuts.test.ts`. Le module porte aussi les deux partitions du
  workflow — `OPEN_STATUSES` / `CLOSED_STATUSES` (la carte les re-publie, le tableau les
  consomme) — et `needsTransitionDialog(spec, defaultAssignee)`, la règle « faut-il ouvrir le
  dialogue ? » partagée par la fiche et le tableau.
- **`facets.ts`** (pur, testé) : facettes destinataire/démarche/source déduites des demandes
  existantes du tenant — catalogue provisoire jusqu'à la sync du référentiel Socle.
- RLS = source de vérité : l'UI ne masque les actions que par confort ; toute erreur de garde
  SQL est affichée telle quelle.
- **Droits effectifs (profils de droits, 2026-08-22)** : `useTenant()` expose `rights`
  (`MyRights`, RPC `my_rights`), `isAdmin`, `hasAnyProfile`. Dans la fiche, les droits se
  calculent sur le **couple** de la demande — `rightsFor(rights, r.socle_scope_org_id,
  r.socle_procedure_id)` + `isAdminOn(rights, r.socle_scope_org_id)` → `RequestRights` — et
  alimentent `allowedTransitionsFor`, `canWriteWith` (notes), `canAdminWith` (réouverture,
  archivage, suppression de note d'autrui). « Nouvelle demande » est UN composant
  (`NewRequestButton`, style de la liste) posé sur la liste, le tableau et la carte, et
  conditionné par `useCanCreateRequest` (droits × activations). La liste restreint la facette Démarche
  aux démarches consultables. `allowedTransitions(status, role)`/`canWrite(role)` sont
  **dépréciés** (vestiges du rôle binaire). Référence : [`docs/droits.md`](../../../docs/droits.md).

## Index des fiches

- [**Parcours de création guidé**](../../../docs/features/creation-de-demande.md)
  (`creation/`, `/demandes/nouvelle`) — plus aucun INSERT de demande depuis le navigateur :
  tout passe par l'edge `create-request-from-procedure` et le moteur partagé
  `procedureForm.ts`. ⚠️ Un type de champ inconnu vide TOUT le schéma ; la période de
  publication MASQUE sans refuser ; l'activation par organisme masque ET refuse (`t18`).
- [**Demande complexe relayée à Clara**](../../../docs/features/demande-complexe.md)
  (`complexe/`, edge `relay-courrier-clara`) — Iris n'en garde ni ligne ni octet ; un refus de
  Clara dit toujours que **rien n'est parti**.
- [**Liste des demandes**](../../../docs/features/liste-des-demandes.md) (`useRequests.ts`,
  pages, `listing.ts`) — tri serveur, regroupement, export. ⚠️ À l'écran on dit
  **« Organisme »**, les clés restent `destinataire` ; toute route sous une entrée de rail
  existante se déclare dans `nav.ts`.
- [**Fiche d'instruction et mentions**](../../../docs/features/fiche-instruction.md)
  (`RequestDetailPage` + `instruction/`) — en-tête, rail d'onglets, notes internes et
  mentions. ⚠️ Le jeton `@[Nom](uuid)` ne s'affiche jamais tel quel, et son nom n'est pas de
  confiance.
- [**Échanges avec l'usager et avis de clôture**](../../../docs/features/echanges-usager.md)
  (`send-request-email`) — messagerie de l'usager FERMÉE par défaut ; l'envoi SUIT la
  transition sans la conditionner ; le motif de clôture ne sort jamais ; aucun avis pour une
  demande issue de Clara.
- [**Pièces justificatives**](../../../docs/features/pieces-justificatives.md) — porte unique,
  qualification conforme / non conforme, ajout d'une pièce, modification des réponses.
  ⚠️ `conformite.ts` est un jumeau SQL ; on modifie les RÉPONSES, jamais la démarche.
- [**Transfert d'organisme responsable**](../../../docs/features/transfert-organisme.md) —
  ⚠️ la RPC `transfer_request` est l'UNIQUE porte, un `update` client ne marche pas.
- [**Identité vivante de l'usager**](../../../docs/features/usagers-et-identite.md)
  (`requesterView`) — fiche Socle relue à côté du snapshot immuable.
- [**Documents d'instruction et courriers**](../../../docs/features/documents-instruction.md)
  (`generate-request-document`) — trois natures ; un document interne ne sort jamais.
- [**Interventions**](../../../docs/features/interventions.md) (`interventions/`,
  `/interventions`) — sollicitation par RPC, justificatifs par la porte unique.
- [**Carte des interventions**](../../../docs/features/carte-des-interventions.md)
  (`carte/`, `/carte`) — cadrée sur le territoire, pas sur ses épingles.
- [**Tableau des demandes**](../../../docs/features/tableau-des-demandes.md) (`tableau/`) —
  kanban ; seules s'ouvrent les colonnes que la garde accepterait.
- [**Saisie d'adresse et cartographie**](../../../docs/features/adresse-et-cartographie.md) —
  propose, ne garde jamais la porte.
- [**Pages mobiles**](../../../docs/features/demandes-mobile.md) — mêmes hooks, jamais un
  second chemin d'écriture.
