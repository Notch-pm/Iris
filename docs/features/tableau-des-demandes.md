# Tableau des demandes (kanban)

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Tableau des demandes** (`features/requests/tableau/`, route `/demandes/tableau`, entrée
  de rail au-dessus de « Demandes », design Claude Design « Kanban demandes » implémenté et
  vérifié en navigateur le 2026-08-28) : les
  demandes du tenant réparties par statut, **déplaçables d'une colonne à l'autre**. Page
  pleine hauteur (`useFullBleedLayout`), le board défile horizontalement, chaque colonne
  verticalement.
  - **Une colonne = UN statut**, les 7, dans l'ordre du cycle de vie. Pas de colonne
    « Clôturées » qui regrouperait résolution positive, négative et annulation : un dépôt
    DEMANDE une transition précise, et une colonne composite ne saurait pas laquelle.
  - **Ce que porte une carte** : référence, pastille d'urgence, objet, **l'organisme qui
    traite la demande** (icône `Building2`, sous l'objet — c'est l'information de ROUTAGE,
    elle passe donc avant la démarche et la date ; sur sa propre ligne, une colonne de 286 px
    ne tenant pas un troisième élément dans la rangée de pastilles, et avec un `title` pour
    les libellés tronqués), la démarche (pastille **masquée quand son libellé répète l'objet**
    — `showProcedure`), la date de dépôt, l'usager et l'agent affecté. « Sans organisme »
    s'affiche AUSSI : c'est l'anomalie `destinataire_inconnu`, elle mérite d'être vue.
  - **Le dépôt ne décide rien** : il appelle `transition.start(card, spec)`, donc le
    **dialogue commun de la fiche** (`TransitionDialog`) dès qu'il manque une information
    (motif, commentaire pour l'usager, assigné), et une application directe sinon
    (« Prendre en charge » sur son propre nom, mise en attente, retour à qualifier). La garde
    SQL reste seule juge : son refus s'affiche tel quel — dans le dialogue s'il est ouvert,
    en **bandeau** sinon (une transition directe n'a pas d'autre endroit où le porter).
    Rien ne bouge avant la confirmation : la carte n'est pas déplacée au dépôt, et
    « Annuler » la laisse dans sa colonne d'origine, statut inchangé.
  - ⚠️ **La SUITE d'une transition est la même que sur la fiche** (retour PO 2026-10-16) :
    `useClosureNotice` (`src/features/requests/useClosureNotice.ts`), partagé par la fiche,
    la fiche mobile et le tableau — une résolution déposée ici envoie l'avis de clôture à
    l'usager (sauf demande Clara), et un échec d'avis s'affiche dans son propre bandeau.
    Jusque-là le tableau résolvait sans prévenir l'usager, alors que son dialogue
    l'annonçait. Toute nouvelle suite d'une transition se pose dans ce hook, pas dans un
    écran.
  - **Pendant le déplacement, seules les colonnes acceptables s'ouvrent** : `dropTargets`
    indexe `allowedTransitionsFor(statut, droits du couple)` par statut d'arrivée ; les
    autres colonnes refusent le dépôt (pas de `preventDefault` → le curseur dit « interdit »)
    et portent la raison en `title`. Une carte que rien ne laisserait bouger n'est même pas
    `draggable`.
  - **Le glisser-déposer n'est jamais le seul chemin** : chaque carte porte un menu
    « Déplacer vers » avec les mêmes transitions — c'est la voie clavier et lecteur d'écran.
    ⚠️ Ce menu vit dans une colonne défilante : il utilise le mode `portal` de
    `src/components/ui/dropdown.tsx` (menu détaché dans le `body`, position fixe suivie au
    défilement), sans quoi le débordement de la colonne le rognerait.
  - **« Mes demandes »** (raccourci en tête de la barre de filtres, avec son volume) n'est
    PAS un cinquième critère : c'est le filtre **agent** posé sur le seul utilisateur courant
    (`toggleMine`), donc lisible et défaisable depuis le menu « Agent » comme n'importe quelle
    sélection. Il ne s'allume que si la sélection d'agents est EXACTEMENT lui (`isMineOnly`) :
    dès qu'un autre agent est coché, ce ne sont plus « mes demandes », et le bouton le dit.
  - **`tableau.ts`** (pur, testé — 29 cas) porte tout : colonnes, `boardCard` (identité figée
    au dépôt, urgence, agent, champ de recherche replié sans accents), filtres et facettes
    croisés (agent dont « Non affectée », organisme, démarche, urgence, recherche),
    `boardContent` (répartition + tri par date de dépôt, dans les deux sens), et
    `boardRightsResolver` — `rightsFor` + `isAdminOn` **mémoïsés par couple** (des centaines
    de cartes, une poignée de couples). Une demande au statut inconnu n'est pas perdue :
    `orphans` la signale.
  - **`useBoardRequests.ts`** : DEUX requêtes. Les demandes **en cours** se chargent toutes
    (plafond 400) — c'est le travail du service, il doit tenir entier sur le tableau ; les
    **statuts finaux**, qui s'accumulent sans fin, sont bornés aux 30 derniers jours
    (`closedSince`, stable sur la journée → clé de requête stable) et à 200 lignes. Les deux
    troncatures sont AFFICHÉES. Clé `["requests", "kanban", …]` À DESSEIN : c'est le préfixe
    qu'invalide `useApplyTransition`, donc le tableau se remet à jour après toute transition,
    la sienne comme celle d'une autre page.
