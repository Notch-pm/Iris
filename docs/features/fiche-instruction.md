# Fiche d'instruction et mentions

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Fiche d'instruction de la demande** (`RequestDetailPage` + `instruction/`, design Claude
  Design « Suivi demande » implémenté le 2026-08-22) : page pleine hauteur. **En-tête** : fil
  d'Ariane (Demandes / statut / référence mono), objet, statut (pastille à point), échéance
  (`due_at` : « dans N jours » / « en retard »), sous-titre usager · canal · date · échéance,
  **action principale** (transition « vers l'avant » : `splitTransitions`) + menu « ⋯ » (autres
  transitions, copier la référence). **Onglets** : Résumé (clôture, informations saisies
  étiquetées par `procedure_snapshot.form_schema` avec conditions rejouées — `formAnswers` —,
  description, **lieu d'intervention** (carte + itinéraire, ci-dessous), demandes liées via
  `useRequestSummaries` — ⚠️ la ligne « Ressource d'origine » (`external_ref` +
  `external_url`) **s'efface dès qu'un lien externe mène au même endroit** (`originResource`,
  pur/testé, 2026-09-19) : Clara envoie `external_id` = son ticket d'ACTION et
  `links = [courrier]` avec le même permalien, et l'agent lisait deux lignes pour un seul
  courrier (DEM-2026-000054). Sans lien qui la couvre, la ligne reste : c'est la seule trace
  de l'origine pour un partenaire qui ne déclare que son identifiant), **et — depuis le
  2026-09-20 — « Consentements au dépôt »** : la trace IMMUABLE de `requests.consents`, avec la
  phrase soumise ce jour-là. Elle ne double pas la carte de la fiche usager, qui montre l'état
  COURANT du référentiel ; elle existe pour le cas où il n'y a PAS de fiche — dépôt anonyme,
  identité non rapprochée —, où elle est la seule preuve. Bloc absent sur les demandes
  antérieures à la migration (`[]`)), Documents
  (pièces de la demande **groupées par exigence du formulaire**, avec leur qualification et
  l'historique de leurs remplacements — vignette, taille, état de copie, « Voir » (PDF et
  images raster seulement : `inlineViewable`, une seule liste avec la reconnaissance des
  types côté serveur) / « Télécharger » par URL signée, « Qualifier », « Remplacer la
  pièce » ; pièces d'instruction ; courriers), Échanges, Notes internes (`request_messages`,
  bulles beurre, suppression auteur/admin), Activité (`activityItems` : journal `request_events`
  fusionné aux notes, plus récent en tête). **Rail** : prise en charge (urgence = `priority`
  via `useUpdatePriority`, agent instructeur via `useAssignRequest`, **organisme responsable**
  via `useTransferRequest` — voir « Transfert d'organisme » plus bas),
  avancement (`buildStages` : étapes datées d'après le journal, attente « sautée », clôture
  avec motif ; bouton d'action principale), usager (`requesterView` : identité normalisée
  quelle que soit l'origine — contacts-api, publics Iris, clés partenaires conservées en
  clair —, **relue dans le Socle** quand la demande y est rattachée, correction sur place,
  autres demandes du même usager Socle via `useRequesterRequests`).
  - ⚠️ **Piège vécu (2026-08-31) — la barre d'onglets disparaissait sur « Échanges ».**
    Elle porte `overflow-x-auto` (les onglets doivent pouvoir défiler sur un écran
    étroit) ; or dès qu'un axe d'`overflow` n'est plus `visible`, la **taille minimale
    automatique de l'autre axe tombe à 0**. Dans la colonne de gauche, qui est un flex
    vertical à hauteur contrainte (`lg:min-h-0 lg:overflow-y-auto`), la barre devenait
    donc le seul enfant capable de céder — le panneau, lui, ne peut pas descendre sous
    la hauteur de son contenu. Sur un panneau plus haut que la colonne (Échanges et son
    composeur), elle était écrasée à **1 px** : il ne restait que sa bordure, et elle ne
    « revenait » qu'au changement de zoom, le temps d'une remise en page. Correctif :
    `shrink-0`. **Règle générale : tout enfant d'un flex à hauteur contrainte qui porte
    un `overflow-*` doit porter `shrink-0`, sauf s'il est justement celui qui doit
    absorber la place.** `RailTabs` n'a pas d'`overflow` et n'est donc pas concerné.
    Depuis le 2026-09-19 (retour PO), **le défilement vit dans le `tabpanel`**
    (`lg:min-h-0 lg:flex-1 lg:overflow-y-auto`) et plus dans la colonne : la barre
    d'onglets reste fixe et seul le contenu défile sous elle — le même partage qu'à
    droite entre `RailTabs` et son contenu. La règle du `shrink-0` sur la barre tient
    toujours : la colonne reste un flex à hauteur contrainte.
  - **Lieu d'intervention** (`instruction/lieu.ts` pur/testé, `LieuIntervention.tsx`,
    `useGeocode.ts`, 2026-08-23) : affiché **uniquement si la démarche pose la question**.
    Le Socle propose un bloc prêt à l'emploi qui est une **section ORDINAIRE** du
    `form_schema` (aucun type dédié dans le contrat), pré-remplie de champs
    `intervention_numero|btq|voie|complement|appartement|code_postal|ville` — tout y reste
    renommable ensuite. Reconnaissance en cascade : clés du contrat, puis section titrée
    « Lieu d'intervention » dont les champs restants sont mappés par libellé (couvre le
    `key: ""` du builder Socle, où `form_data` est indexé par id), puis, sans schéma
    exploitable (snapshot dégradé), les seules clés du contrat. Conditions de visibilité
    rejouées comme pour les autres réponses ; les clés retenues (`lieu.keys`) sont
    **retirées des « Informations saisies »** pour ne pas répéter l'adresse. Affichage :
    adresse postale + précisions d'accès (complément, appartement — jamais envoyées au
    GPS), **carte OpenStreetMap statique** (tuiles composées par `src/lib/carto.ts`,
    marqueur au centre, zoom ±, attribution ODbL obligatoire, « Ouvrir dans
    OpenStreetMap ») et bouton **« Guider »** (itinéraire Google Maps, nouvel onglet). Le
    géocodage (BAN) est un confort mis en cache par TanStack Query, jamais stocké : panne,
    adresse introuvable ou tuiles muettes laissent l'adresse et « Guider » intacts.
    - **Seconde forme, depuis Socle 1.29.0 (2026-09-22) : le champ `location`.** UN champ
      (clé par défaut `intervention_lieu`), reconnu **par son `type`** (`locationField`),
      jamais par sa clé ; sa valeur est `{ address, lat, lon, precision, adjusted }` — la
      valeur normalisée par `parseLocationValue` (procedureForm.ts, chaîne nue élevée en
      adresse sans point). Elle est portée par `InterventionLocation.point` et **prime sur
      tout géocodage** : `LieuIntervention` désactive `useGeocode` (requête vide), la carte
      des interventions ne l'envoie pas au lot CSV (`distinctAddresses` saute les demandes
      avec point), la pastille dit « Point déclaré par l'usager » / « Point ajusté par
      l'usager (150 m au plus) ». **« Guider »** vise les **coordonnées** quand `adjusted`
      (`directionsTarget`) — c'est l'usager qui a dit « pas à la porte, ici » — et l'adresse
      sinon (valable même sans point). Sur un snapshot dégradé ou un schéma que le moteur n'a
      pas su lire (`content: []`), `fromRawData` relit `intervention_lieu`, puis toute valeur
      qui a la forme d'un lieu, puis les sept clés de l'ancien bloc. L'ancien bloc reste lu
      tel quel : rien n'est migré côté Socle.
  - **Base de connaissances de la démarche** (`procedure/`, 2026-08-28) : le rail bascule
    entre deux onglets — « Demande » (prise en charge, avancement, usager) et
    « Procédure » —, par `RailTabs` (pastille tant que l'onglet n'a pas été ouvert et que
    la démarche a quelque chose à dire). Le panneau `ProcedurePane` est **partagé avec le
    parcours de création** : mêmes cartes, même vocabulaire, deux moments.
    - **Ce qui est affiché** : points de vigilance (garde-fous, en tête — ce sont eux qui
      changent une décision), consignes pour l'agent, procédure de traitement, questions
      fréquentes (dépliables), documents d'aide, liens utiles. Les deux textes sont du
      **Markdown** rendu par `src/lib/markdown.ts` (pur, testé) + `components/ui/markdown.tsx` :
      aucune dépendance, **aucun HTML injecté** — un champ du référentiel ne devient jamais
      exécutable, et un lien `javascript:` retombe en texte. Depuis le 2026-09-19, les
      **listes lisent leur profondeur dans l'indentation** (`ListItem.depth`, 2 à 4 espaces =
      un cran, plafonné à 3, rendu en marge) et une ligne indentée sans puce est la SUITE de
      l'élément précédent, pas un paragraphe orphelin — l'assistant IA écrit couramment les
      deux, et ses puces arrivaient à plat.
    - **Ce qui n'est PAS affiché** : `trainingDocuments` et `aiSources` — la matière de
      l'assistant IA, retirée par la whitelist serveur `parseAgentKnowledge`. Elle est lue
      côté serveur seulement, par `@fn/_shared/ai/knowledge.ts` (`parseAiKnowledge`), que
      `socle-proxy` n'importe JAMAIS — un test lit son source pour le vérifier.
    - **L'onglet « Assistant »** (livré le 2026-08-29, `assistant/`) : conversation avec
      l'assistant Mistral. Le fil est **hissé dans la PAGE** (`AssistantThreadProvider`) et
      non dans le panneau, qui est démonté à chaque bascule d'onglet du rail — sans cela
      l'agent perdrait sa conversation en consultant l'avancement. Il disparaît au
      rechargement, **par décision** (conversation éphémère), et le panneau le dit.
      ⚠️ `useAssistant` est une `useMutation` SANS `queryKey` : ranger le fil dans le cache
      TanStack « pour qu'il survive » serait une porte dérobée de persistance.
      Depuis le 2026-09-18, l'assistant lit aussi **ce que la collectivité publie pour ses
      usagers** (`user_communication` + `user_description`, Socle 1.24.0) — pastille
      « communication usager » quand il l'a lu. Le panneau « Procédure » ne l'affiche pas ;
      c'est la **Fiche démarche** du guichet qui le montre à l'agent (ci-dessus), relayé par
      `sanitizeProcedureFull` avec la whitelist partagée
      `@fn/_shared/procedures/userCommunication.ts`. Détail :
      [`docs/assistant-ia.md`](../assistant-ia.md) §2.
      ⚠️ `trimForSend` ne renvoie **jamais** un tour en erreur — sinon le modèle relit « Le
      plafond est atteint » comme sa propre réponse et enchaîne dessus. Depuis le 2026-09-19,
      c'est une **liste blanche** (`user` et `assistant` seuls) : une carte de proposition
      n'est pas un tour de conversation et ne repart jamais au serveur.
      **Répondre d'abord, proposer ensuite** (décision PO 2026-09-19) : quand la base ne suffit
      pas, l'assistant PROPOSE de consulter les sources que la collectivité a déclarées pour
      l'IA (sources en ligne et documents d'entraînement de la démarche, sources recommandées
      de la collectivité). Une **carte** dans le fil les nomme et dit ce que « Consulter »
      implique ; l'agent approuve ou refuse. L'accord vaut pour la SUITE de la conversation —
      `consulted` dans `AssistantThreadProvider`, renvoyé en identifiants à chaque question,
      relu côté serveur à chaque tour — et se retire (« Ne plus consulter », « Effacer »,
      changement de démarche, ou n'importe quel échec pendant une consultation, pour qu'une
      source cassée ne fasse pas tomber toutes les questions suivantes). Une nouvelle question
      fait **expirer** une carte laissée ouverte. Sous la réponse : pastille « N sources
      consultées », liens des pages lues, et « Non lues : X (motif) ».
      ⚠️ Le serveur ne rend au navigateur que des **identifiants opaques**, des libellés et
      l'adresse d'une page — jamais le chemin d'un document, jamais son URL signée, jamais le
      texte lu. Détail : [`docs/assistant-ia.md`](../assistant-ia.md) §2.
      **Défilement** (retour PO 2026-09-19) : une réponse se lit depuis sa PREMIÈRE ligne —
      son début est calé en haut du fil, jamais sa fin en bas ; on ne suit le bas du fil
      qu'à l'envoi d'une question, pendant l'attente et sur une erreur. Réglé sur le
      `scrollTop` du conteneur, jamais par `scrollIntoView` (qui ferait sauter la fiche).
      La mention « Socle » en haut à droite du panneau Procédure a été retirée le même jour.
    - **Rien n'est stocké** : `useProcedureKnowledge` relit le Socle à chaque visite
      (`socle-proxy /v1/procedures/get`, 5 min de fraîcheur). La base de connaissances
      n'entre pas dans le `procedure_snapshot` — le snapshot fige le *formulaire du dépôt*,
      une consigne d'instruction doit au contraire suivre son service.
    - **Documents** : le bucket est celui du **Socle**. `useProcedureDocumentUrl` demande
      une URL signée à `socle-proxy /v1/procedures/document-url`, qui vérifie que le chemin
      est cité par les `agentDocuments` de la démarche rechargée. Le navigateur ne désigne
      rien qu'il ait inventé.
    - Une démarche non documentée, un Socle muet ou une demande historique **sans démarche**
      ont chacun leur état expliqué : le panneau est une aide, jamais une condition.
  - **Fonctionnalités à venir, visibles mais grisées** (`SOON` dans
    `src/components/ui/surface.tsx`, décision PO 2026-08-22) : contacter, demander une pièce,
    pièces d'instruction, courriers, exporter le journal,
    et le canal **SMS** du composeur. Ne rien cacher : on les travaillera ensuite.
    (« Changer le service instructeur » a quitté cette liste le 2026-09-01 : c'est le
    **transfert d'organisme responsable**, livré — voir plus bas.)
    (« Écrire à l'usager » et l'onglet Échanges sont livrés — voir ci-dessous.)
  - **« Voir la fiche »** du bloc Usager ouvre la **fiche usager** `/usagers/:contactId`
    (feature `contacts`) dès qu'un usager Socle est rapproché ; grisée sinon (identité
    déclarée sans rapprochement, ou dépôt anonyme).
  - **`instruction/instruction.ts`** (pur, testé) porte TOUTE la déduction (échéance,
    sous-titre, identité, réponses, étapes, activité, vignettes) ; les composants affichent.
    ⚠️ **Le canal de réception est un texte libre du contrat** (`context.channel`) : chaque
    émetteur y met ses codes. Le catalogue `CHANNEL_PHRASES` / `CHANNEL_LABELS` connaît ceux
    d'Iris, ceux de **Clara** (`paper` = courrier papier scanné, `email`, `portal`, `manual`
    = saisi par un agent) et celui du portail (`portail`) ; un code inconnu s'affiche entre
    guillemets (« déposée via paper » mélangeait les langues, DEM-2026-000053, 2026-09-19).
    Une demande **ingérée** nomme aussi son émetteur (`SOURCE_LABELS`, décision PO) :
    « reçue par courrier via Clara le … », « reçue de Clara le … » sans canal, et le portail
    une seule fois (« reçue sur le portail usagers le … ») ; une demande d'Iris reste
    « déposée au guichet le … ».
    Un nouvel émetteur = ses codes à ajouter ICI, pas une normalisation à l'ingestion (la
    valeur reçue reste celle de l'émetteur, comme `source`).
  - **`TransitionActions.tsx`** = `useTransitionRunner` (transition active, application
    directe ou dialogue, erreur) + `TransitionDialog` (motif / commentaire pour l'usager / assigné),
    monté une fois par fiche. Le dialogue ne dépend que de `TransitionDialogRunner` — le
    strict nécessaire — pour que le tableau des demandes, où la demande visée change à chaque
    geste, monte LE MÊME dialogue avec son propre runner et un `subtitle` qui nomme la demande. Les refus de la garde SQL sont affichés tels quels (bandeau
    d'en-tête ou dialogue). `src/components/ui/dropdown.tsx` = menu flottant minimal (`ar-pop`).

- **Mentions dans les notes internes** (2026-08-24, `instruction/mentions.ts` pur/testé —
  28 cas — + `MentionTextarea.tsx`) : « @ » ouvre un menu, ↑ ↓ pour parcourir, Entrée ou Tab
  pour choisir, Échap pour fermer. Tant que le menu est ouvert **Entrée choisit et ne soumet
  pas** — l'inverse enverrait des notes à moitié écrites.
  - **Encodage dans le corps** : `@[Nom affiché](uuid)`. La note reste auto-portante — la base
    valide et notifie depuis le seul corps, sans table satellite — et le motif est le jumeau
    exact de `public.message_mentions` (SQL). Le corps n'étant rendu qu'à un seul endroit
    (`NotesPane`), le jeton ne fuit nulle part.
  - **On ne mentionne que qui peut CONSULTER la demande.** `mentionable_users(request_id)`
    alimente le menu, mais c'est le trigger `t03_request_messages_guard_mentions` qui décide :
    une mention d'un non-consultant fait échouer l'insertion, écran contourné ou non.
  - **Un rond par personne** : photo (URL signée) ou initiales, dans le menu comme dans la
    pastille d'une note déjà écrite — et sur l'avatar de l'auteur de la note. Les URLs signées
    sont demandées **en un seul aller-retour** (`useAvatarUrls`, `createSignedUrls`) : une
    requête par ligne de menu serait absurde. Une photo qui ne charge pas retombe sur les
    initiales (`Avatar` gère `onError`).
  - **On ne se propose pas soi-même** (`withoutSelf`, testée) : se citer ne notifie rien, la
    règle « jamais pour son propre geste » faisant taire la notification.
    ⚠️ L'exclusion est faite à l'ÉCRAN, pas dans la RPC : `mentionable_users` sert aussi à
    résoudre les noms et photos des mentions **déjà écrites**, les siennes comprises —
    l'amputer ferait retomber sa propre mention sur le nom figé du jeton.
  - ⚠️ **Le jeton `@[Nom](uuid)` ne s'affiche NULLE PART tel quel** : partout où un corps de
    note est rendu hors de `NotesPane` — l'onglet Activité (`activityItems`), les notes de la
    fiche mobile —, il passe par `plainBody` (« @Nom »). Constaté le 2026-09-19 : l'Activité
    montrait `@[jacquotlaurent@gmail.com](d7dc…)`. Un compte **sans prénom ni nom** est
    désigné par son **adresse** (`user_display_name`, côté serveur, et donc le jeton) : c'est
    le repli voulu, pas un défaut d'affichage.
  - ⚠️ **Le nom du jeton n'est pas de confiance** (rien n'empêche d'écrire
    `@[Le Maire](uuid-d-un-autre)` à la main) : l'affichage préfère TOUJOURS le nom vivant de
    `mentionable_users`, le jeton ne servant que de repli si la personne n'est plus connue.
  - Une mention produit une notification **`mentioned`** (+ e-mail), et **prime sur
    `note_added`** : la personne citée qui est aussi l'affectataire ne reçoit qu'un message.
    Réglable dans « Mon compte ».
