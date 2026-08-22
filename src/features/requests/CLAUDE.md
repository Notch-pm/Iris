# Feature : parcours agent (`src/features/requests`, `src/features/tenant`)

Chargé automatiquement quand on travaille dans ce dossier. Les invariants globaux du
`CLAUDE.md` racine (Socle source de vérité, snapshots construits côté serveur, RLS = vérité,
aucun miroir d'usagers, aucune demande libre) priment sur tout ce qui suit.

Premier parcours applicatif, livré et **vérifié en navigateur réel** (2026-08-20) : connexion →
sélection du tenant → liste filtrée/paginée → création manuelle → fiche → prise en charge →
note interne → résolution avec texte de clôture → journal.

- **`TenantProvider`** (`features/tenant/`) : appartenances de l'utilisateur
  (`organization_members` + `organizations`), tenant courant persisté en localStorage,
  sélecteur dans le header d'`AppShell` (masqué si un seul tenant), rôle affiché en badge.
- **`statuts.ts`** (pur, testé) : libellés FR des 7 statuts/motifs/priorités et
  **`allowedTransitions(status, role)`** — miroir EXACT de la garde SQL
  `requests_guard_transition` (exigences : assigné, texte de clôture, motifs ; portes :
  réouverture superviseur+, archivage/désarchivage admin ; lecteur = rien). ⚠️ Ce module ne
  protège rien : il reflète ce que le trigger acceptera. Toute évolution de la matrice SQL se
  répercute ICI et dans `statuts.test.ts`.
- **`facets.ts`** (pur, testé) : facettes destinataire/démarche/source déduites des demandes
  existantes du tenant — catalogue provisoire jusqu'à la sync du référentiel Socle.
- **Parcours de création guidé** (`features/requests/creation/`, page `/demandes/nouvelle`,
  design Claude Design « Écran création demande citoyens » implémenté et vérifié en
  navigateur le 2026-08-21) : l'ancien dialogue générique est SUPPRIMÉ — plus aucun INSERT
  direct de demande depuis le navigateur. Page **pleine hauteur** (`useFullBleedLayout`,
  contexte `ShellLayoutContext` d'`AppShell`) : en-tête + stepper 4 étapes, zone de saisie,
  **rail latéral** (fiche de la demande : progression/complétude ; demandes proches), pied
  d'actions. Étapes : **démarche** Socle active (`ProcedurePicker` : recherche, chips de
  catégories de démarches, cartes avec volume du mois ; obligatoire, cache du tenant) →
  **usager** (feature `contacts`) → **formulaire** (objet/priorité/description +
  `form_schema` : sections, choix, conditions visibleIf/requiredIf avec pastille
  « conditionnel », pièces en zone de dépôt avec formats/cardinalités ; `requester_config`
  respecté) → **récapitulatif** (groupes relisibles avec « Modifier », **organisation
  destinataire** en sélecteur inline pré-rempli par la démarche, bannière de doublon
  probable) → **edge function `create-request-from-procedure`** → écran « Demande créée »
  (ouvrir la fiche, **récépissé imprimable** `.print-receipt`, nouvelle saisie).
  - **Brouillon local** (`draft.ts` pur/testé, `useCreationDraft`) : localStorage, un par
    tenant et utilisateur, enregistré en différé à chaque saisie ; ne transporte que des
    identifiants et saisies (usager rapproché = id seul, **relu via `socle-proxy
    /v1/contacts/get` à la reprise** ; démarche rechargée ; pièces à redéposer). Proposé à
    la reprise au retour sur la page ; effacé à la création.
  - **Demandes proches** (`proches.ts` pur/testé, `useNearbyRequests`) : détection
    best-effort dès que l'usager est désigné (même `socle_contact_id`, ou nom déclaré à
    titre indicatif — **jamais un doublon probable sur le seul nom**), score 0-100 (même
    démarche, encore ouverte, récence), seuil 85 = bannière au récapitulatif. **Liaison
    explicite** par l'agent : `useLinkRequests` insère des `request_links` `liee_a` dans
    les deux sens APRÈS création (RLS writer + trigger de périmètre ; échec affiché, jamais
    bloquant). Décision humaine, aucune clôture automatique.
  - Score de rapprochement Socle = **classement relatif** à la réponse (contrat
    contacts-api) : affiché en barre relative au meilleur candidat, jamais en « % ».
  - Onglet « Procédure » du rail (base de connaissances / assistant) : **différé** (second
    temps, décision PO 2026-08-21).
  - **Moteur partagé** `@fn/create-request-from-procedure/_shared/procedureForm.ts` (pur,
    testé, miroir EXACT du contrat Socle formSchema v1/conditions/requesterFields) : rendu et
    validation de confort côté client, validation d'AUTORITÉ côté serveur sur la démarche
    **rechargée depuis Socle**. Clé de `form_data` = clé machine `key` (repli sur l'id si
    vide). Alias `@fn` → `supabase/functions/` (vite + tsconfig).
  - **`create-request-from-procedure`** (edge, JWT + rôle agent/administrateur en code, CORS
    allowlist) : cache du tenant = périmètre, démarche rechargée depuis Socle (503/502 si
    injoignable — contrairement à l'ingestion, jamais refusée), snapshots construits côté
    serveur (toute clé `procedure_snapshot`/inconnue dans le payload → 400), contact
    rapproché **relu depuis contacts-api** (identité de vérité), écriture ATOMIQUE via la
    RPC `create_request_from_procedure` (demande + pièces + événement
    `request_created_from_procedure`, attribution à l'agent — tout ou rien). Pièces :
    uploadées par le navigateur sur `{org}/{draftId}/…` AVANT l'appel (policy storage sur le
    1er segment), déclarées ensuite (chemin vérifié préfixé au brouillon).
- **`useRequests.ts`** : hooks TanStack Query (liste paginée `range`+`count`, facettes, fiche,
  satellites, membres du tenant) + mutations (transition via `buildTransitionUpdate`,
  affectation, notes, liaison `useLinkRequests`). Pas d'appel `supabase` direct dans les
  pages.
- **Pages** : `RequestsListPage` (filtres statut/destinataire/démarche/priorité/source,
  pagination 20, filtre initial depuis `?status=`, bouton « Nouvelle demande » →
  `/demandes/nouvelle`) et la **fiche d'instruction** ci-dessous.
- **Fiche d'instruction de la demande** (`RequestDetailPage` + `instruction/`, design Claude
  Design « Suivi demande » implémenté le 2026-08-22) : page pleine hauteur. **En-tête** : fil
  d'Ariane (Demandes / statut / référence mono), objet, statut (pastille à point), échéance
  (`due_at` : « dans N jours » / « en retard »), sous-titre usager · canal · date · échéance,
  **action principale** (transition « vers l'avant » : `splitTransitions`) + menu « ⋯ » (autres
  transitions, copier la référence). **Onglets** : Résumé (clôture, informations saisies
  étiquetées par `procedure_snapshot.form_schema` avec conditions rejouées — `formAnswers` —,
  description, lieu d'intervention, demandes liées via `useRequestSummaries`), Documents
  (pièces de la demande : vignette, taille, état de copie, « Voir » / « Télécharger » par URL
  signée ; pièces d'instruction ; courriers), Échanges, Notes internes (`request_messages`,
  bulles beurre, suppression auteur/admin), Activité (`activityItems` : journal `request_events`
  fusionné aux notes, plus récent en tête). **Rail** : prise en charge (urgence = `priority`
  via `useUpdatePriority`, agent instructeur via `useAssignRequest`, service instructeur),
  avancement (`buildStages` : étapes datées d'après le journal, attente « sautée », clôture
  avec motif ; bouton d'action principale), usager (`requesterIdentity` : snapshot normalisé
  quelle que soit l'origine — contacts-api, publics Iris, clés partenaires conservées en
  clair —, autres demandes du même usager Socle via `useRequesterRequests`).
  - **Fonctionnalités à venir, visibles mais grisées** (`SOON` dans `instruction/bits.tsx`,
    décision PO 2026-08-22) : écrire à l'usager / contacter / onglet Échanges (composeur
    entier), lieu d'intervention (carte, itinéraire), demander une pièce, pièces
    d'instruction, courriers, exporter le journal, voir la fiche usager, changer le service
    instructeur. Ne rien cacher : on les travaillera ensuite.
  - **`instruction/instruction.ts`** (pur, testé) porte TOUTE la déduction (échéance,
    sous-titre, identité, réponses, étapes, activité, vignettes) ; les composants affichent.
  - **`TransitionActions.tsx`** = `useTransitionRunner` (transition active, application
    directe ou dialogue, erreur) + `TransitionDialog` (motif / texte de clôture / assigné),
    monté une fois par fiche. Les refus de la garde SQL sont affichés tels quels (bandeau
    d'en-tête ou dialogue). `src/components/ui/dropdown.tsx` = menu flottant minimal (`ar-pop`).
- RLS = source de vérité : l'UI ne masque les actions que par confort ; toute erreur de garde
  SQL est affichée telle quelle.
- **Droits effectifs (profils de droits, 2026-08-22)** : `useTenant()` expose `rights`
  (`MyRights`, RPC `my_rights`), `isAdmin`, `hasAnyProfile`. Dans la fiche, les droits se
  calculent sur le **couple** de la demande — `rightsFor(rights, r.socle_scope_org_id,
  r.socle_procedure_id)` + `isAdminOn(rights, r.socle_scope_org_id)` → `RequestRights` — et
  alimentent `allowedTransitionsFor`, `canWriteWith` (notes), `canAdminWith` (réouverture,
  archivage, suppression de note d'autrui). La liste conditionne « Nouvelle demande » à
  `canCreateProcedure` sur au moins une démarche du cache et restreint la facette Démarche
  aux démarches consultables. `allowedTransitions(status, role)`/`canWrite(role)` sont
  **dépréciés** (vestiges du rôle binaire). Référence : [`docs/droits.md`](../../../docs/droits.md).
