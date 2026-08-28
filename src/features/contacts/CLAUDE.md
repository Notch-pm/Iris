# Feature : contacts (`src/features/contacts`)

Chargé automatiquement quand on travaille dans ce dossier. Les invariants globaux du
`CLAUDE.md` racine (Socle source de vérité, snapshots construits côté serveur, RLS = vérité,
aucun miroir d'usagers, aucune demande libre) priment sur tout ce qui suit.

Identification du demandeur et fiche usager, auprès du référentiel d'usagers Socle —
**aucun miroir local** : tout passe par `socle-proxy`, sans rétention (mutations pour le
parcours de création, requête `gcTime: 0` pour la fiche). Identification vérifiée en
navigateur le 2026-08-20 dans le parcours de création.

- **`usager.ts`** (pur, testé) : tout ce qui se déduit d'une fiche Socle sanitisée pour la
  fiche usager (nom d'affichage, public, sous-titre, blocs identité / coordonnées /
  adresse — seuls les champs renseignés —, contraste du quartier) et les compteurs de ses
  demandes (`usagerStats`).
- **`rapprochement.ts`** (pur, testé) : critères de recherche (nom, prénom, e-mail,
  téléphone — refus sans discriminant), résumé des candidats (seules
  informations distinctives), libellés FR des raisons de rapprochement (raison inconnue
  affichée telle quelle), `isNameOnlyMatch` (**jamais de rapprochement sur le seul nom** —
  signalé « à vérifier », aucune sélection automatique), payload de création whitelisted,
  `duplicateCheckIdentity` (rejeu anti-doublon JUSTE avant création), résolutions
  `contact | sans_rapprochement | anonyme`.
- **`RequesterIdentification`** — mode `locked` (usager imposé par le point d'entrée) : la
  fiche retenue est affichée avec une pastille « Usager imposé » au lieu de « Modifier », et
  aucune recherche n'est proposée ; `lockedMessage`/`lockedAction` portent le refus et la
  sortie de secours. En mode normal (décision PO 2026-08-21) : publics selon `requester_config`
  (champs masqué/visible/obligatoire respectés — **exactement ceux du contrat Socle**, la
  « date de naissance » propre à Iris est abandonnée, PO 2026-08-22 — grille large 3 colonnes) ; **recherche
  d'homonymes AUTOMATIQUE au fil de la saisie** (débounce 450 ms, `liveSearchIdentity` :
  identifiant fort ou nom ≥ 2 caractères, réponses périmées ignorées — aucun bouton
  « rechercher ») → candidats (score relatif + raisons, étiquette « Nom seul — à
  vérifier », **choix = clic explicite sur la fiche**, jamais automatique) ; sans
  correspondance : **« Créer un nouvel usager »** (contacts-api, rejeu anti-doublon juste
  avant : utiliser le candidat ou « créer quand même ») ; **dépôt anonyme uniquement si la
  démarche ne rend aucune identité obligatoire** (`allowsAnonymous` du moteur partagé).
  - ⚠️ **« Poursuivre sans rapprochement » a été RETIRÉ du parcours normal** (décision PO
    2026-08-26) : sans correspondance, c'est une nouvelle personne, et une nouvelle personne
    se crée dans le Socle. Une demande instruite pendant des semaines contre une identité qui
    n'est nulle part dans le référentiel n'est rattrapable par personne.
  - **Sortie de secours, sur panne AVÉRÉE seulement** (`isSocleOutage`, pur/testé) : le bouton
    ne réapparaît qu'après un échec de création dû à une panne (`socle_unavailable`,
    `socle_auth_failed`, `socle_error`, ou une erreur sans code = l'edge function n'a pas
    répondu). Un **refus métier** du Socle (`bad_request`, `conflict` : SIRET déjà pris,
    invariant de type) ne l'ouvre JAMAIS — il se corrige au formulaire, sinon la porte se
    contourne à volonté. L'agent a un usager en face de lui : on ne le renvoie pas chez lui.
  - L'identité qui part alors vient du formulaire de **création** (`declaredFromNewContact`),
    pas de celui de recherche — c'est la saisie la plus complète et la plus récente. Le
    serveur pose l'anomalie `usager_a_creer_dans_socle` (jamais sur un drapeau du navigateur).
- **Fiche usager** (`/usagers/:contactId`, `UsagerPage.tsx`, 2026-08-22 — reprise de la
  représentation de la fiche contact de Clara) : pile verticale de cartes pleine largeur,
  sans onglets ni rail. **Carte d'identité** (icône du public, nom, badges public / statut
  non actif / « Référentiel Socle », grille libellé-valeur identité + coordonnées, puis
  adresse et quartier — pastille à la couleur libre du référentiel, texte adapté par
  `isDarkColor`) puis **carte « Demandes de cet usager »** (tableau référence / objet /
  démarche / statut / date, résumé « N visibles · N en cours · dernier dépôt le … »).
  - `:contactId` est l'**id Socle** (Iris n'a pas d'usagers à lui). La fiche est relue à
    chaque visite via `useSocleContact` (`socle-proxy /v1/contacts/get`, requête TanStack
    `gcTime: 0`/`staleTime: 0` : **aucune rétention**), les demandes viennent d'Iris
    (`useContactRequests`, bornées par le RLS — la fiche ne montre que le périmètre du
    lecteur, et c'est la règle).
  - **Adresse assistée (2026-08-28)** : la section « Adresse » du dialogue est un champ
    UNIQUE qui propose les adresses du référentiel, avec une carte de contrôle sous lui —
    détail et pièges dans [`src/features/requests/CLAUDE.md`](../requests/CLAUDE.md),
    § « Saisie d'adresse assistée ». Contacts-api n'ayant QU'UN complément (`address_line2`),
    « Plus de champs » n'y montre que lui : ni bâtiment ni appartement séparés, qui seraient
    un modèle que le Socle n'a pas. Le **pays reste hors du dépliant** — il est obligatoire,
    et un champ obligatoire ne se replie pas ; c'est lui qui décide si l'assistance
    s'applique, la BAN ne couvrant que la France (`isFranceCountry`).
  - **Modification (2026-08-23, `UsagerEditDialog` + `usagerEdit.ts` pur/testé)** : dialogue
    calqué sur `ContactFormDialog` de Clara (identité / coordonnées / adresse), restreint aux
    champs qu'Iris lit. L'écriture va **au Socle** (`socle-proxy /v1/contacts/update` →
    `PATCH /v1/contacts/{id}`, function v8) : **patch partiel** — seuls les champs réellement
    changés partent, un champ vidé part à `null` —, puis la fiche est **relue** depuis le
    Socle (jamais remplacée par la réponse). Le formulaire rejoue les règles du Socle pour
    fauter au bon champ (civilité obligatoire pour un citoyen, raison sociale pour une
    structure, SIRET à 14 chiffres, date ISO, pays jamais vidé, au moins un nom) ; l'autorité
    reste le Socle, dont les refus (SIRET déjà pris, invariants) s'affichent tels quels.
    Le **type d'usager** n'est pas modifiable (immuable côté Socle) et le **statut** non plus :
    l'**archivage/restauration d'un usager n'est pas livré** (backlog —
    [`docs/data-model.md`](../../../docs/data-model.md) § Écarts, point 7). Le quartier n'est
    pas saisi : le Socle le recalcule depuis l'adresse.
  - **Droit requis** : le même que « Nouvelle demande » (au moins une démarche créable) —
    c'est exactement la garde que `socle-proxy` applique déjà à toutes les routes
    `/v1/contacts/*`. L'UI ne fait que la refléter.
  - Les blocs Clara qui n'existent pas ici (consentements, rôles, références externes, notes
    internes, relations) sont ceux que la sanitisation du proxy ne transmet jamais — ils ne
    sont donc ni lus ni écrits. « Contacter » reste grisé (`SOON`).
  - **« Nouvelle demande »** ouvre le parcours de création avec l'usager IMPOSÉ
    (`/demandes/nouvelle?usager=<id Socle>` — l'identifiant seul transite, jamais l'identité) ;
    le bouton n'apparaît qu'avec un droit de création sur au moins une démarche du cache
    (reflet de confort, le serveur revalide). Verrouillage et cas de refus : voir
    [`src/features/requests/CLAUDE.md`](../requests/CLAUDE.md).
  - Entrées : bouton « Voir la fiche » du bloc Usager de la fiche d'instruction — et, depuis
    le 2026-08-26, le bouton **« Modifier »** du même bloc, qui ouvre `UsagerEditDialog`
    **sans quitter la demande** (la fiche demande relit le Socle avec `useSocleContact`,
    exactement comme cette page). Même droit, même autorité : la correction va au Socle, la
    fiche est relue, et le `requester_snapshot` de la demande — la pièce du dossier — ne
    bouge pas. Détail : [`src/features/requests/CLAUDE.md`](../requests/CLAUDE.md),
    « Identité vivante de l'usager ».
- **Liste des usagers** (`/usagers`, `UsagersListPage.tsx` + `usagers.ts` pur/testé +
  `useUsagers.ts`, 2026-08-23 — reprise de l'annuaire des contacts de Clara) : entrée de rail
  dédiée, recherche par mot-clé, filtres, tri par colonne, export CSV de toute la sélection
  filtrée. Les filtres du **fichier domiciliaire** de Clara (grands anniversaires, mariages)
  ne sont **pas** repris : hors sujet ici.
  - **Gabarit large** (`useWideLayout`, comme la liste des demandes) : le tableau prend
    toute la largeur de l'écran ; chapeau et barre de filtres restent bornés (largeur de
    lecture / listes déroulantes de taille utile).
  - **Deux sources qu'aucun serveur ne joint** : les fiches viennent du Socle
    (`socle-proxy /v1/contacts/list`, pagination par `offset`, aucune rétention —
    `gcTime: 0`, comme la fiche usager), les compteurs de demandes viennent d'Iris
    (RPC `contact_request_counts`, `SECURITY INVOKER` : **bornée par le RLS au périmètre du
    lecteur**, d'où la colonne « Demandes » et non « toutes ses demandes »). Le
    rapprochement, le tri, les filtres et la pagination sont donc **client**, sur l'ensemble
    rapatrié — plafonné à `USAGERS_MAX` (5 000) avec **mention explicite** de la troncature,
    jamais silencieuse.
  - **Filtres** (décision d'implémentation 2026-08-23) : nombre de demandes et nombre de
    demandes en cours par **paliers** (« aucune », « au moins 1 », « 2 et plus »…) — les
    mêmes grandeurs étant aussi des **colonnes triables**, ce qui couvre le « qui en a le
    plus » —, quartier (observé dans les fiches rapatriées, plus « Sans quartier » ; le
    référentiel des quartiers vit dans le Socle et n'est pas mis en cache), type d'usager,
    actifs / archivés / tous, et recherche par mot-clé.
  - **`status` est le SEUL filtre servi par le Socle** : il change ce qui est chargé (les
    fiches archivées ne sont pas rapatriées tant qu'on ne les demande pas), donc la clé de
    requête. Tous les autres filtrent en mémoire, sans aller-retour.
  - **Recherche** (`matchesSearch`, pur) : accents et casse ignorés, TOUS les mots exigés
    dans n'importe quel ordre, sur identité / courriel / téléphones / adresse / commune /
    code postal / quartier / SIRET. Un mot fait de chiffres est aussi cherché sur les seuls
    chiffres de la fiche (« 06 12 34 » trouve `0612345678`).
  - **Droit requis** : le même que « Nouvelle demande » et que la fiche usager — au moins une
    démarche créable (`useCanBrowseUsagers`), qui est exactement la garde de `socle-proxy`
    sur `/v1/contacts/*`. L'entrée de rail n'apparaît que dans ce cas et la page explique le
    refus si on y arrive par l'URL ; l'edge function reste l'autorité.
  - Pas de création d'usager depuis cette page : elle se fait dans le parcours de création de
    demande (rejeu anti-doublon compris). Ligne cliquable → fiche usager.
- Le `requester_snapshot` est construit CÔTÉ SERVEUR au dépôt (contact rapproché relu depuis
  Socle) — la résolution ne transporte que le choix de l'agent. `internal_notes` n'existe
  nulle part côté Iris (sanitisation proxy + whitelists). Immuable ne veut pas dire seul
  affiché : la fiche demande montre l'identité **relue** et garde le dépôt à côté (voir
  « Identité vivante de l'usager »). La whitelist `contactIdentitySnapshot`
  (`@fn/_shared/identity/declared.ts`) sert aux DEUX — construire le snapshot au dépôt, et
  normaliser la fiche du jour : une seule table de clés, donc des écarts comparables champ par
  champ. Ce module porte aussi `DECLARED_KEYS`, la **seule** table de synonymes de clés
  (contacts-api / publics Iris / formats partenaires), partagée par l'affichage
  (`requesterIdentity`) et par l'écriture dans le Socle (ingestion) — deux listes
  divergeraient au premier format partenaire un peu exotique.
