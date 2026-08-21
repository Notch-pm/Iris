# Feature : contacts (`src/features/contacts`)

Chargé automatiquement quand on travaille dans ce dossier. Les invariants globaux du
`CLAUDE.md` racine (Socle source de vérité, snapshots construits côté serveur, RLS = vérité,
aucun miroir d'usagers, aucune demande libre) priment sur tout ce qui suit.

Identification du demandeur auprès du référentiel d'usagers Socle — **aucun miroir local**,
tout passe par `socle-proxy` (mutations TanStack sans cache). Vérifiée en navigateur le
2026-08-20 dans le parcours de création.

- **`rapprochement.ts`** (pur, testé) : critères de recherche (nom, prénom, date de
  naissance, e-mail, téléphone — refus sans discriminant), résumé des candidats (seules
  informations distinctives), libellés FR des raisons de rapprochement (raison inconnue
  affichée telle quelle), `isNameOnlyMatch` (**jamais de rapprochement sur le seul nom** —
  signalé « à vérifier », aucune sélection automatique), payload de création whitelisted,
  `duplicateCheckIdentity` (rejeu anti-doublon JUSTE avant création), résolutions
  `contact | sans_rapprochement | anonyme`.
- **`RequesterIdentification`** (décision PO 2026-08-21) : publics selon `requester_config`
  (champs masqué/visible/obligatoire respectés, grille large 3 colonnes) ; **recherche
  d'homonymes AUTOMATIQUE au fil de la saisie** (débounce 450 ms, `liveSearchIdentity` :
  identifiant fort ou nom ≥ 2 caractères, réponses périmées ignorées — aucun bouton
  « rechercher ») → candidats (score relatif + raisons, étiquette « Nom seul — à
  vérifier », **choix = clic explicite sur la fiche**, jamais automatique) ; sans
  correspondance : « Créer un nouvel usager » (contacts-api, rejeu anti-doublon juste avant :
  utiliser le candidat ou « créer quand même ») ou « Poursuivre sans rapprochement »
  (bouton explicite, plus de case d'assomption) ; **dépôt anonyme uniquement si la démarche
  ne rend aucune identité obligatoire** (`allowsAnonymous` du moteur partagé).
- Le `requester_snapshot` est construit CÔTÉ SERVEUR au dépôt (contact rapproché relu depuis
  Socle) — la résolution ne transporte que le choix de l'agent. `internal_notes` n'existe
  nulle part côté Iris (sanitisation proxy + whitelists).
