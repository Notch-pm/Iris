# Usagers : référentiel Socle et identité du demandeur

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Aucun miroir local d'usagers** : les contacts vivent dans le Socle (contacts-api), Iris
  les lit/rapproche/crée/**corrige** via `socle-proxy`. **Une identité sans correspondance est
  une nouvelle personne : on la CRÉE dans le Socle** (décision PO 2026-08-26) — parcours agent
  comme ingestion partenaire. À l'ingestion, une fiche existante n'est réutilisée que sur un
  **identifiant fort** (courriel, téléphone, SIRET) : personne n'y arbitre les homonymes.
  Un **nom d'usage seul suffit** à créer une personne (règle du Socle, qui n'exige que la
  civilité — un dépôt Nora sans nom de naissance restait orphelin jusqu'au 2026-09-23).
  « Sans rapprochement » ne subsiste que comme sortie de secours — panne ou refus du
  référentiel, identité déclarée impossible à nommer — et **jamais en silence** : anomalie
  `usager_a_creer_dans_socle`. Iris ne conserve par demande que le
  `requester_snapshot` (identité retenue au dépôt, immuable). *Immuable* ne veut pas dire
  *seul affiché* : la fiche d'une demande relit la fiche Socle et montre l'identité du jour,
  le dépôt et leurs écarts restant lisibles à côté (`requesterView`) — et le destinataire d'un
  e-mail à l'usager suit la fiche relue, résolu côté serveur. Le snapshot, lui, n'est jamais
  réécrit — et il n'est pas une commodité d'affichage : pour une identité **non rapprochée** ou
  un dépôt anonyme, c'est la **seule** identité qui existe. Coût mesuré : ~250 octets par
  demande, cinq fois moins que `procedure_snapshot` (justification, chiffres et leviers
  écartés : [`docs/data-model.md`](../data-model.md), § « Pourquoi figer l'identité au
  dépôt »).

- **Identité vivante de l'usager** (2026-08-26, `requesterView` dans `instruction.ts`,
  pur/testé) : le `requester_snapshot` reste **immuable** — c'est la pièce du dossier, ce qui a
  été retenu AU DÉPÔT — mais ce n'est pas ce qu'un agent doit lire un mois plus tard. Le Socle
  est la source de vérité des usagers : une adresse ajoutée, un déménagement, un nom corrigé
  après le dépôt doivent se voir dans la demande.
  - La fiche **relit** `socle-proxy /v1/contacts/get` (`useSocleContact`, `gcTime: 0` — aucune
    rétention, exactement comme `/usagers/:contactId`) et affiche l'identité du jour.
    `requesterView` rend les DEUX : `identity` (ce qu'on montre), `deposited` (le dépôt) et
    `changes` (les écarts champ par champ ; un champ apparu depuis a `before: null`, un champ
    vidé `after: null`).
  - Le bloc Usager du rail porte donc un dépliant **« N champs modifiés depuis le dépôt »** qui
    montre les valeurs du dépôt. Ne pas le retirer : l'écart est lui-même une information
    (« ce n'est pas cette adresse-là qui figurait au dossier »).
  - **Bouton « Modifier »** (le même `UsagerEditDialog` que la fiche usager) : l'écriture va au
    SOCLE, la fiche est relue, le snapshot de la demande ne bouge pas. Reflet de
    `useCanBrowseUsagers` (droit de création dans le tenant) — la garde réelle est
    `socle-proxy`.
  - **Toute panne retombe sur le dépôt**, sans erreur ni trou : Socle injoignable, fiche
    illisible, lecteur sans droit de création. `requesterView` ignore aussi une réponse
    inexploitable plutôt que d'effacer un nom connu.
  - Conséquence : `identity` alimente l'en-tête, les variables des modèles d'e-mail et le
    destinataire affiché dans Échanges — tout suit la fiche du jour.
  - **L'attente est EXPLICITE** (PO, 2026-08-26) : pendant la relecture, le bloc Usager
    affiche un squelette et « Lecture de la fiche dans le Socle… », et l'en-tête **omet le
    nom** (`headerSubtitle` accepte `requesterName: null`). Montrer le dépôt puis basculer
    faisait clignoter exactement les champs qui ont changé — c'est-à-dire les seuls qui
    comptent ici —, y compris le nom dans le titre de la page. Mieux vaut pas de nom du tout
    qu'un nom remplacé sous les yeux.
  - Le bouton « Modifier » est **posé dès le départ et désactivé** tant que la fiche n'est pas
    là : le faire surgir en cours de chargement déplacerait l'en-tête de la carte.
  - ⚠️ Le drapeau est `socleContact.isLoading`, **pas** `isPending` : TanStack le laisse à faux
    pour une requête désactivée (lecteur sans droit de création → aucune relecture, aucun
    squelette) comme pour un rafraîchissement avec données en cache (retour d'un
    enregistrement → pas de squelette non plus). C'est exactement le comportement voulu. Le message qui annonçait
    une identité « figée, impossible à compléter après coup » n'a donc plus lieu d'être : il ne
    reste que pour une identité déclarée **sans rapprochement**, seul cas où il n'existe
    aucune fiche à corriger.
