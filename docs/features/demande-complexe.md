# Demande complexe relayée à Clara

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Demande complexe** (`src/features/requests/complexe`, edge `relay-courrier-clara`, module
  pur `_shared/clara/relay.ts`, 2026-10-10) : chevron du bouton « Nouvelle demande » (liste,
  tableau, carte). Écran calqué sur le « Nouveau courrier » de Clara — deux étapes, onglets
  Importer des fichiers / Coller un texte (dictée **masquée** pour l'instant, décision PO) —, puis
  organisme, usager (`RequesterIdentification`) et consentements. Le serveur vérifie le droit
  de **création sur au moins une démarche de l'organisme** (`user_can_create_on_organization`),
  relit la fiche Socle, passe chaque fichier par la liste fermée, nomme l'agent, et transmet de
  serveur à serveur (`CLARA_IRIS_INTAKE_URL` / `CLARA_IRIS_INTAKE_KEY`). Rien n'est stocké ;
  idempotence par `submission_id` tiré à l'ouverture →
  [`src/features/requests/CLAUDE.md`](../../src/features/requests/CLAUDE.md).

- **Demande complexe relayée à Clara** (2026-10-10, `complexe/` : `DemandeComplexeDialog.tsx`,
  `useRelayToClara.ts` ; module pur `@fn/_shared/clara/relay.ts` — 16 cas ; edge
  `relay-courrier-clara` ; migration `20261010124124` ; porte `iris-courrier` du dépôt Clara) :
  l'agent saisit une demande qu'il ne sait pas rattacher à une démarche, et Iris la transmet à
  Clara, où elle devient un courrier entrant **« Relayé agent »** analysé par l'IA de Clara.
  - **Iris ne conserve RIEN** — ni ligne, ni octet au bucket, ni requête à invalider. C'est ce
    qui la rend compatible avec « aucune demande libre » : ce n'est pas une demande d'Iris.
  - **Action SECONDAIRE** : un chevron accolé au bouton « Nouvelle demande »
    (`NewRequestButton`, donc liste, tableau et carte), qui ouvre un menu au motif
    « Ajouter du courrier » de Clara. Un agent qui ne peut déposer QUE des demandes complexes
    (aucun couple activé) voit un bouton contour « Demande complexe » à la place.
  - **Écran = « Nouveau courrier » de Clara** : fenêtre `max-w-4xl` en deux étapes. Étape 1,
    onglets Importer des fichiers (zone de dépôt, aperçu image/PDF avec navigation, liste
    retirable) / Coller un texte. **Pas d'onglet Dicter** : masqué, pas grisé (décision PO
    2026-10-10) — la transcription viendrait par le guichet IA du Socle, comme dans Clara. Les deux contenus sont conservés et TOUS DEUX
    transmis, quel que soit l'onglet actif. Étape 2 : ce que Clara demande (titre, canal,
    tags, organisation gestionnaire) est fait par SON analyse ; Iris demande l'**organisme**
    (retenu d'office s'il n'y en a qu'un, jamais pré-sélectionné sinon), l'**usager**
    (`RequesterIdentification` avec `RELAY_REQUESTER_CONFIG` : trois publics, civilité ou
    raison sociale exigée, **pas d'anonymat** — Clara rappelle l'usager) et les deux
    **consentements** (`ConsentGroup`, exporté de `RequestSummary`).
  - **Droit** : création sur au moins une démarche — explicite ou par défaut — pour
    l'organisme visé. Reflet `relayOrganizationIds` (`rights.ts`) ; juge
    `user_can_create_on_organization` (SQL, service seulement).
  - **Le serveur décide** : organisme du miroir, consentements (`normalizeConsents`), fiche
    usager RELUE au Socle (seul l'id vient du navigateur ; saisie épurée en secours de panne),
    fichiers passés par `inspectUpload` (5 × 10 Mo, la liste fermée d'Iris — aucune raison
    qu'un fichier refusé à la porte passe par la fenêtre), agent nommé depuis `users`.
  - **Transport** : multipart vers Clara, `Authorization: Bearer CLARA_IRIS_INTAKE_KEY` —
    une clé par appelant, le canal se déduit de la PORTE côté Clara. `submission_id` tiré à
    l'ouverture et conservé entre deux tentatives : un rejeu rend le même courrier
    (`duplicate`). Un refus de Clara est traduit par `relayFailure` et dit toujours que
    **rien n'est parti** ; une clé refusée ne se raconte jamais à l'agent.
