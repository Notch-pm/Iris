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
  - **Usager imposé** (`/demandes/nouvelle?usager=<id Socle>`, entrée « Nouvelle demande »
    de la fiche usager, 2026-08-23) : l'usager est relu depuis le Socle (`useSocleContact`),
    appliqué DÈS que la démarche est choisie, et l'étape 2 est **verrouillée**
    (`RequesterIdentification locked` : la fiche retenue, une pastille « Usager imposé », ni
    recherche ni « Modifier »). Le `requester_config` reste l'arbitre : public non proposé
    par la démarche, `contact_type` `administration` (aucun public Iris) ou fiche illisible →
    l'étape explique le refus, « Continuer » reste fermé, et un bouton « Désigner l'usager
    moi-même » retire le paramètre (parcours normal, saisie conservée) plutôt que de laisser
    une impasse. Pas de reprise de brouillon proposée dans ce mode (il porterait un autre
    usager) ; le verrou tient au point d'entrée, pas au brouillon.
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
  - **Usager : rapprocher, sinon CRÉER dans le Socle** (décision PO 2026-08-26) — voir
    [`src/features/contacts/CLAUDE.md`](../contacts/CLAUDE.md). « Poursuivre sans
    rapprochement » ne subsiste que comme sortie de secours sur panne AVÉRÉE, et la demande
    porte alors l'anomalie `usager_a_creer_dans_socle`, posée par le SERVEUR.
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
  description, **lieu d'intervention** (carte + itinéraire, ci-dessous), demandes liées via
  `useRequestSummaries`), Documents
  (pièces de la demande : vignette, taille, état de copie, « Voir » / « Télécharger » par URL
  signée ; pièces d'instruction ; courriers), Échanges, Notes internes (`request_messages`,
  bulles beurre, suppression auteur/admin), Activité (`activityItems` : journal `request_events`
  fusionné aux notes, plus récent en tête). **Rail** : prise en charge (urgence = `priority`
  via `useUpdatePriority`, agent instructeur via `useAssignRequest`, service instructeur),
  avancement (`buildStages` : étapes datées d'après le journal, attente « sautée », clôture
  avec motif ; bouton d'action principale), usager (`requesterView` : identité normalisée
  quelle que soit l'origine — contacts-api, publics Iris, clés partenaires conservées en
  clair —, **relue dans le Socle** quand la demande y est rattachée, correction sur place,
  autres demandes du même usager Socle via `useRequesterRequests`).
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
    OpenStreetMap ») et bouton **« Guider »** (itinéraire Google Maps, nouvel onglet, sur
    l'adresse — pas sur les coordonnées, donc valable même sans géocodage). Le géocodage
    (BAN) est un confort mis en cache par TanStack Query, jamais stocké : panne, adresse
    introuvable ou tuiles muettes laissent l'adresse et « Guider » intacts.
  - **Fonctionnalités à venir, visibles mais grisées** (`SOON` dans
    `src/components/ui/surface.tsx`, décision PO 2026-08-22) : contacter, demander une pièce,
    pièces d'instruction, courriers, exporter le journal, changer le service instructeur,
    et le canal **SMS** du composeur. Ne rien cacher : on les travaillera ensuite.
    (« Écrire à l'usager » et l'onglet Échanges sont livrés — voir ci-dessous.)
  - **« Voir la fiche »** du bloc Usager ouvre la **fiche usager** `/usagers/:contactId`
    (feature `contacts`) dès qu'un usager Socle est rapproché ; grisée sinon (identité
    déclarée sans rapprochement, ou dépôt anonyme).
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
- **Carte des interventions** (`features/requests/carte/`, route `/carte`, entrée de rail
  dédiée + bouton « Carte » de la liste, 2026-08-23) : les demandes **en cours**
  (`OPEN_STATUSES` = `a_traiter`/`en_instruction`/`en_attente`) dont la démarche porte un lieu
  d'intervention, posées sur une carte OpenStreetMap.
  - **`carte.ts`** (pur, testé) : `locatableRequests` (réutilise `instruction/lieu.ts` — même
    reconnaissance du bloc Socle), `distinctAddresses` (une adresse = un géocodage, quelles
    que soient les demandes qui la partagent), `filterRequests` / `procedureFacets` /
    `priorityCounts`, `spreadByPoint` (anneaux : deux demandes à la même adresse ne se
    superposent pas), `cardAnchor` (fiche de survol maintenue dans le cadre, basculée à
    gauche près du bord), `mapCard` (l'essentiel de la demande) et `locationHint` (le
    géocodeur rend TOUJOURS un candidat : réserve affichée dès que le point n'est pas un
    numéro sûr — jamais de point masqué pour autant).
  - ⚠️ **Piège vécu (2026-08-23)** : la clé de requête TanStack du géocodage en masse ne doit
    PAS être indexée sur les seules adresses manquantes. Le cache de session se remplissant
    dans le `queryFn`, la clé changeait au retour du service : la réponse atterrissait sur une
    entrée que plus personne n'observait, `dataUpdatedAt` du nouveau cache repartait à zéro,
    le mémo des points ne se recalculait jamais — la carte annonçait « aucune adresse
    localisée » alors que la BAN avait répondu 200 avec le bon point. La clé porte donc
    TOUTES les adresses (`geocodeBatchPlan`, pur et testé) ; seul le contenu du lot envoyé
    dépend du cache. Règle générale : **une clé de requête ne se dérive jamais d'un cache que
    la requête elle-même remplit.**
  - **Données** (`useMapRequests.ts`) : 500 demandes les plus récentes (`MAP_MAX_ROWS`,
    troncature signalée), sélection allégée `procedure_snapshot->form_schema` (le snapshot
    entier × 500 pèserait pour rien), puis **géocodage en masse** en UNE requête (endpoint
    CSV de la BAN) avec cache de session — un appel unitaire par demande saturerait le
    service. Aucun point n'est stocké côté Iris.
  - **`InterventionMap.tsx`** : `TileLayer` (brique partagée avec la fiche), épingles
    **colorées par urgence** (jaune `normale` → orange `haute` → rouge `urgente`, gris
    `basse` : sans urgence particulière), survol/focus → fiche (référence, statut, objet,
    adresse, usager, dépôt, urgence, démarche, catégorie, destinataire, agent instructeur,
    « Ouvrir la fiche »), clic = fiche épinglée, Échap ferme. Déplacement à la souris, zoom
    molette (listener non passif — sinon la roue est ignorée) et boutons, « Recadrer ».
    Recadrage automatique à l'arrivée des points et à chaque changement de filtre.
  - **Filtres** : démarches en **multi-sélection** (menu à cases, volumes) et urgences en
    pastilles colorées — la légende EST le filtre, puisque la couleur porte l'urgence.
  - Vérifié en navigateur le 2026-08-23 : d'abord sur harnais jetable (mosaïque, épingles,
    écartement, fiche y compris bascule au bord, déplacement, zoom, recadrage, géocodage en
    masse réel), puis **sur l'application réelle** avec la demande DEM-2026-000005
    (10 avenue de Frémeur, 44000 Nantes) — épingle posée, fiche de survol complète, et le
    bloc « Lieu d'intervention » de la fiche d'instruction (carte, « Numéro localisé »,
    « Guider »).
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
  - ⚠️ **Le nom du jeton n'est pas de confiance** (rien n'empêche d'écrire
    `@[Le Maire](uuid-d-un-autre)` à la main) : l'affichage préfère TOUJOURS le nom vivant de
    `mentionable_users`, le jeton ne servant que de repli si la personne n'est plus connue.
  - Une mention produit une notification **`mentioned`** (+ e-mail), et **prime sur
    `note_added`** : la personne citée qui est aussi l'affectataire ne reçoit qu'un message.
    Réglable dans « Mon compte ».
- **Échanges avec l'usager** (2026-08-26, `instruction/courriel.ts` pur/testé — 28 cas —,
  `EchangesPane.tsx`, `useSendRequestEmail.ts`, edge `send-request-email`) : depuis l'onglet
  **Échanges**, l'agent écrit un e-mail à l'usager, avec un modèle ou à la main, pièces
  jointes comprises. L'échange est enregistré dans `request_emails` (expéditeur, date et heure
  d'envoi, objet, corps réellement parti, pièces, modèle utilisé).
  - **Le composeur résout les variables à l'INSERTION, pas à l'envoi.** Choisir un modèle
    remplit l'objet et le corps déjà personnalisés ; cliquer une pastille insère la **valeur**
    au curseur, pas le jeton `{{…}}`. C'est la différence assumée avec l'éditeur de modèles des
    Paramètres : ici l'agent rédige le message final, le voit tel qu'il partira, et c'est ce
    texte-là qui part. Un trou — variable sans valeur pour cette demande — se voit donc tout de
    suite. Les pastilles ne proposent d'ailleurs **que** les variables qui ont une valeur.
  - ⚠️ **Une valeur absente ⇒ la clé est OMISE** (`requestTemplateValues`), jamais un repli.
    « Identité déclarée », « Utilisateur », « Système / intégration », « date inconnue », et
    l'e-mail de l'agent que `useTenantMembers` met à défaut de nom : ce sont des mots d'écran
    de gestion, aucun ne doit atteindre un usager. `renderTemplate` rend alors du vide.
  - **Le droit d'INSTRUCTION** est exigé — miroir de `request_right_for(…, 'instruction')` dans
    l'edge function, qui reste l'autorité, et déjà le droit qu'exigent la policy d'insertion de
    `request_attachments` et la policy storage du bucket.
  - **Le serveur résout ce qu'un navigateur ne peut pas se voir confier** : le destinataire
    (jamais accepté du payload — sinon Iris devient un relais ouvert) et les chemins de pièces
    (préfixés `{organization_id}/{request_id}/`).
  - **L'adresse est celle de la fiche SOCLE d'aujourd'hui** (2026-08-26, voir « Identité
    vivante » plus bas) : `send-request-email` relit `contacts-api` avec la clé de service dès
    que la demande porte un `socle_contact_id`, et retombe sur le `requester_snapshot` pour une
    identité déclarée **sans rapprochement** ou si le Socle est muet (dégradé, jamais un
    refus). Une fiche lue **sans** adresse vaut réponse : on ne ressuscite pas une adresse que
    l'usager a fait retirer du référentiel.
    ⚠️ Résidu connu : un agent purement **instructeur** (sans droit de création) ne peut pas
    relire la fiche depuis le navigateur — `socle-proxy /v1/contacts/*` exige la création — et
    voit donc encore l'adresse du dépôt, quand le serveur, lui, enverra à celle du Socle. Le
    jour où ça gêne, la sortie est une route de proxy bornée à la demande, pas un
    assouplissement de la garde.
  - **Les pièces d'un échange sortant portent `request_attachments.email_id`** et sont donc
    retirées de « Pièces de la demande » (onglet Documents) : les mêler ferait passer un envoi
    du service pour un dépôt de l'usager.
  - ⚠️ `demande.date_instruction` = **premier** passage en instruction (`firstInstructionAt`).
    `buildStages()` fait un calcul voisin qu'on ne peut PAS réutiliser : son `visited.set`
    écrase, donc il retient le *dernier* passage après une réouverture. Deux besoins, deux
    fonctions.
  - `requesterIdentity()` expose désormais `civility` / `firstName` / `lastName` / `legalName` /
    `address`. La **civilité était purement perdue** : `civility`/`civilite` figuraient dans
    `KNOWN_IDENTITY_KEYS` — donc exclues des lignes « clés inconnues » — sans qu'aucun `pick()`
    ne les lise. Les cascades de clés restent dans cette seule fonction : les recopier dans un
    résolveur ferait deux vérités qui divergeraient au premier format partenaire.
  - Vérifié en navigateur le 2026-08-26 sur DEM-2026-000002 : modèle appliqué avec variables
    résolues, insertion d'une valeur au curseur, pièce jointe téléversée et jointe, envoi réel
    par le relais Mailjet du tenant (`envoye` + `sent_at`), fiche d'échange complète, exclusion
    de la pièce des « Pièces de la demande », et porte « aucune adresse » sur DEM-2026-000005.
    Les quatre gardes serveur ont été éprouvées **hors interface** (404 demande introuvable,
    400 objet vide, 400 pièce hors demande, 400 aucun destinataire).

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

- **Liste : tri, regroupement, export** (2026-08-22, motif des listes Clara) — logique pure
  `listing.ts` (testée) : **tri serveur** par colonne (référence = année puis numéro ; dates du
  plus récent d'abord ; jamais de retour à « non trié » ; la priorité n'est pas triable —
  ordre alphabétique trompeur), **« Grouper par »** statut / destinataire / démarche /
  priorité / source (regroupement client de la page courante, avec pré-tri serveur sur la
  clé de groupe pour des groupes contigus entre pages ; groupes repliables), **export CSV**
  de TOUTE la sélection filtrée dans l'ordre affiché (`fetchRequestsForExport`, lots de 1000,
  borné à 5000 lignes — tronçon signalé ; `src/lib/csv.ts` : `;`, BOM UTF-8 Excel FR).
  En-tête triable `src/components/ui/sortable-header.tsx` (+ `aria-sort`).
  La page est en **gabarit large** (`useWideLayout`) : le tableau prend toute la largeur
  de l'écran, seule la barre de filtres reste bornée (1240px) pour que les listes déroulantes
  gardent une taille utile.
