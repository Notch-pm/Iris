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
- **Parcours de création guidé** (`features/requests/creation/`, page `/demandes/nouvelle`,
  design Claude Design « Écran création demande citoyens » implémenté et vérifié en
  navigateur le 2026-08-21) : l'ancien dialogue générique est SUPPRIMÉ — plus aucun INSERT
  direct de demande depuis le navigateur. Page **pleine hauteur** (`useFullBleedLayout`,
  contexte `ShellLayoutContext` d'`AppShell`) : en-tête + stepper 4 étapes — 5 pour qui
  peut créer pour plusieurs organismes, cf. « Organisme d'abord » ci-dessous —, zone de
  saisie,
  **rail latéral** (fiche de la demande : progression/complétude ; demandes proches), pied
  d'actions. Étapes : **démarche** Socle active (`ProcedurePicker` : recherche, chips de
  catégories de démarches, cartes avec volume du mois ; obligatoire, cache du tenant) →
  **usager** (feature `contacts`) → **formulaire** (objet/priorité/description +
  `form_schema` : sections, choix, conditions visibleIf/requiredIf avec pastille
  « conditionnel », pièces en zone de dépôt avec formats/cardinalités ; `requester_config`
  respecté) → **récapitulatif** (groupes relisibles avec « Modifier », **organisme**
  en sélecteur inline, bannière de doublon
  probable) → **edge function `create-request-from-procedure`** → écran « Demande créée »
  (ouvrir la fiche, **récépissé imprimable** `.print-receipt`, nouvelle saisie).
  - **Organisme d'abord** (étape 0, décision PO du 2026-08-31 — backlog B4 ; modules purs
    `creation/organismes.ts`, `rights.creationOrganizations` / `creatableProceduresOn`,
    écran `OrganismePicker`) : quand l'agent détient le droit de **création sur plusieurs
    organisations**, le parcours s'ouvre par « Pour quel organisme créez-vous cette
    demande ? ». L'organisme retenu BORNE ensuite les démarches proposées — les droits
    étant des couples (organisation, démarche), l'ordre inverse offrirait des démarches
    refusées au bout du parcours (`user_has_request_right`, revérifié par
    `create-request-from-procedure`).
    - **QUATRE règles, et elles se cumulent** (spécification PO du 2026-08-31). Une
      démarche n'est proposée pour un organisme que si elle est **activée pour lui**
      dans le Socle, **en production**, **dans sa période de publication**, et **dans les
      droits** de l'agent. Les deux premières sont des règles de fond (gardes serveur), les
      deux autres non : la période ne fait que masquer, et les droits sont rejoués par le
      RLS. Le croisement vit dans un seul module — `creation/proposables.ts`
      (`creatableByOrganisation`) —, consommé par l'étape 0 comme par l'étape 1, pour que
      « quels organismes ? » et « quelles démarches ? » ne puissent pas diverger.
    - **L'activation par organisation** (`Socle.organization_procedures`, onglet
      « Démarches » de l'éditeur d'organisation) est miroitée dans
      `socle_procedure_organizations` et gardée par
      `t18_requests_require_procedure_active`. C'est un **OPT-IN STRICT** : une
      organisation absente du miroir n'a AUCUNE démarche, surtout pas « toutes ». Une
      organisation qui n'en propose aucune **disparaît de l'étape 0** — on ne propose pas
      un organisme pour lequel il n'y aurait rien à consigner.
      - ⚠️ **Le DTO Socle ne rend pas cette information en lecture.** La seule porte est
        le FILTRE `GET /v1/procedures?enabled_for=<org>`, **non récursif** : la synchro
        fait donc un appel par organisation du sous-arbre (8 pour ACCM). La route inverse
        `GET /v1/organization-procedures` a son sérialiseur écrit côté Socle mais n'est
        branchée sur aucun endpoint — le jour où elle le sera, c'est `OrgActivation`
        qu'elle remplira en un appel, et rien d'autre ne bougera.
      - ⚠️ **`procedures.is_active_global` est mort fonctionnellement** côté Socle : ne
        jamais le miroiter ni s'y fier.
      - ⚠️ **Une lecture d'activation manquée ne périme RIEN** : « aucune activation ici »
        et « le Socle n'a pas répondu » sont indiscernables, et comme t18 refuse ce qui
        n'est pas au miroir, périmer sur un silence fermerait le guichet. La synchro le
        signale en avertissement dans `sync_runs.counters`.
      - ⚠️ **Ordre de déploiement** : la table et la synchro d'abord, la garde ensuite
        (deux migrations distinctes, `20260831100000` puis `20260831100100`). Appliquer
        la garde sur un miroir vide interdit toute création. Rollback dédié dans
        `supabase/rollback/`.
    - **Le bornage n'est PAS un rattachement de la démarche à une commune** : dans le
      référentiel, une démarche appartient à **UNE** organisation — la **racine** —, et
      Iris ne miroite qu'elles (`buildSyncPlan` saute tout ce qui n'est pas
      `proc.organization_id === tenant.socleOrgId`). Ce qui varie d'un organisme à l'autre,
      c'est l'ACTIVATION, pas la propriété. Le libellé du sélecteur le dit :
      « Démarches disponibles · celles que vos droits vous ouvrent pour X », jamais
      « Démarches de X ».
    - **Les entrées vers la création croisent la même règle** (tableau de bord, bouton de
      la liste) : sans cela, elles ouvriraient un parcours vide.
    - ⚠️ **Le pré-remplissage par `snapshot.organization_id` est SUPPRIMÉ.** Ce n'était pas
      une commodité : les démarches d'une communauté d'agglomération pendent typiquement
      de la **racine**, si bien que le champ, enfoui dans le récapitulatif, retenait
      « ACCM » pour des demandes qui étaient celles d'une commune — et personne ne le
      lisait. Rien n'est pré-sélectionné quand la question se pose : un défaut se valide
      sans être lu.
    - **La question ne se pose que s'il y en a une** : un seul organisme admissible est
      retenu d'office (`soleOrganization`) et l'étape ne s'affiche pas — un agent de
      commune unique garde le parcours à quatre étapes qu'il connaît. Le numéro AFFICHÉ
      dans le stepper est le **rang**, pas l'identifiant d'étape (`CreationStepper`) : sans
      cela, un parcours sans organisme serait numéroté 2, 3, 4, 5.
    - **La page n'ouvre pas avant de connaître ce périmètre** (`perimeterReady`) : ouvrir
      avant, ce serait afficher un stepper qui se renumérote sous les yeux de l'agent.
      ⚠️ Corollaire à ne pas défaire : **le `useMemo` de la base de connaissances doit
      rester au-dessus des sorties anticipées** — sous elles, il n'était évalué que sur
      certains rendus (« Rendered more hooks than during the previous render », constaté en
      navigateur le 2026-08-31).
    - **Changer d'organisme peut RETIRER la démarche** déjà choisie (`chooseOrganisme`) :
      une démarche créable à Arles ne l'est pas forcément à Fontvieille. On la relâche
      franchement, avec un message, plutôt que de laisser courir une saisie refusée au bout.
      Même raison à la reprise d'un brouillon : l'organisme enregistré est **revérifié**, et
      s'il n'est plus admissible la reprise revient à l'étape 0 — un brouillon n'est pas un
      droit acquis.
    - **Choisir un organisme ENCHAÎNE sur la démarche** (2026-08-31), comme choisir une
      démarche enchaîne sur l'usager (`selectProcedure`) et désigner un usager sur le
      formulaire (`onResolve`). Désigner, c'est avoir répondu : cette étape était la seule
      à réclamer un « Continuer » derrière.
    - **Vocabulaire** : l'écran dit **« Organisme »** (décision du 2026-08-30), au guichet
      comme sur la liste, le tableau, la fiche (`ResumePane`) et le récépissé. Les clés de
      code restent `destinataire` / `destinationId`.
  - **Puces du stepper franchissables** (2026-08-31, `reachableSteps` dans `model.ts`, pur
    et testé) : la puce SUIVANTE s'ouvre exactement quand le bouton « Continuer » s'ouvre.
    Le voisinage se lit dans l'ORDRE DU TABLEAU d'étapes, jamais en arithmétique sur les
    numéros — l'étape « Organisme » (0) n'existe pas pour tout le monde.
    ⚠️ **Franchir depuis la puce appelle `next()`**, le geste du bouton : même validation du
    formulaire (`nextFromForm`), même suivi de `maxReached`. Deux chemins vers l'étape
    suivante, dont un sans contrôle, serait la porte à côté de la serrure. Concrètement, au
    Formulaire, cliquer « Récapitulatif » avec un champ obligatoire vide affiche les erreurs
    et ne bouge pas — exactement comme le bouton.
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
  - **Ce que le sélecteur propose, et ce qu'il en dit** (2026-08-30) : la liste ne contient
    que les démarches **externes**, dont le paramétrage est **en production** dans le Socle, et
    qui sont **dans leur période de publication** (`useSocleProcedureRows` : les deux premières
    en SQL, la période en JS via `isPublishedOn`). Le brouillon est une règle de fond — le Socle
    dit qu'une démarche en cours d'écriture n'est proposée nulle part —, doublée d'une **garde
    serveur** dans `create-request-from-procedure`, sur la démarche RECHARGÉE (jamais sur le
    cache, qui peut dater). L'exclusion des démarches **internes** est au contraire une décision
    d'affichage TEMPORAIRE (PO : « elles seront affichées ultérieurement ») : deux `.eq(…)` à
    retirer le jour venu, aucune garde à défaire.
    - ⚠️ **La période MASQUE, elle ne REFUSE pas** : pas de garde serveur, délibérément. Le
      brouillon est une règle que le Socle énonce ; la période décrit où et quand proposer **au
      public**. Un agent qui consigne un formulaire papier reçu pendant la période, deux jours
      après sa fin, doit pouvoir le faire — et la reprise d'un brouillon local portant une
      démarche sortie de période marche pour la même raison (`/v1/procedures/get` n'est pas
      filtrée).
    - **Le jour de référence est celui de l'AGENT** (`isoDay(new Date())`), et il entre dans la
      clé de requête — motif `closedSince` du tableau : stable toute la journée, il fait
      repartir la lecture au changement de date sur un onglet resté ouvert. Côté serveur c'est
      le jour de **Paris** (`FRANCE_TIME_ZONE`), le runtime des edge functions étant en UTC.
      Les bornes sont **incluses**, la comparaison **textuelle** (`AAAA-MM-JJ` : lexicographique
      = chronologique).
    - **Chaque carte ne dit de la publication que ce qui mérite d'être dit** : la pastille
      « Non visible portail » ne s'affiche que sur les démarches qui n'y sont PAS (décision PO
      2026-08-30 — `portalAbsenceLabel` rend `null` sinon : y être est la valeur par défaut du
      contrat, donc le cas ordinaire, et l'écrire sur chaque carte noierait l'exception), et la
      période seulement s'il y en a une (« Publiée du 01/01/2027 au 03/05/2027 », « à partir
      du », « jusqu'au » — bornes **incluses**). Une carte sans rien à signaler n'a donc pas de
      ligne du tout. Ce n'est pas un détail de gestion : une démarche absente du portail
      n'arrive au service que par le guichet, et une période close explique qu'un usager n'ait
      pas pu la déposer lui-même.
    - **Les règles du contrat sont lues UNE fois, à la frontière** — module pur
      `@fn/_shared/procedures/publication.ts`, partagé par la synchro, `socle-proxy` et
      l'écran : `communication_config` absent = valeurs par DÉFAUT (visible, sans période),
      et les dates que le Socle conserve quand le commutateur de période est éteint ne
      s'appliquent pas, donc ne s'affichent pas. Le cache porte la publication **effective**
      (`portal_visible`, `publication_start`, `publication_end`), pas le bloc brut.
    - ⚠️ **Le cache, lui, garde TOUT** (brouillons et démarches internes) : il est l'autorité
      de périmètre du tenant. Les facettes de la liste, du tableau et de la fiche usager, comme
      la matrice des profils de droits, continuent de les voir — elles décrivent ce qui EXISTE,
      pas ce qu'on peut créer.
    - ⚠️ **`status` vaut `brouillon` par défaut en base** (*fail closed*) : après la migration
      `20260830100000`, le sélecteur est vide tant qu'une synchro n'a pas déclaré des
      démarches en production. L'état vide le DIT et renvoie au référentiel, plutôt que de
      laisser croire à une panne. Détail : [`docs/data-model.md`](../../../docs/data-model.md)
      § « Publication des démarches ».
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
  - **Onglet « Procédure » du rail** (livré le 2026-08-28, différé depuis le 2026-08-21) :
    la base de connaissances de la démarche choisie, telle que le Socle la destine à
    l'agent. Elle arrive **avec la démarche** (`fetchProcedureSnapshot` — le proxy l'ajoute
    à la lecture complète), donc aucun appel supplémentaire au guichet. Voir la section
    « Base de connaissances » plus bas : le panneau est le MÊME qu'à l'instruction.
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
- ⚠️ **Vocabulaire d'écran : « Organisme »** (décision du 2026-08-30). L'organisation Socle
  qui a reçu et traite la demande s'appelle **Organisme** partout où un agent la lit sur la
  liste et sur le tableau — filtre, colonne, regroupement, export CSV, carte du tableau, et
  la valeur de repli « Sans organisme ». Les **clés** de code restent `destinataire` /
  `destinataires` / `NO_DESTINATAIRE` : elles ne s'affichent pas, elles circulent (état
  d'écran, `?destinataire=` de la liste), et les renommer casserait les liens existants. Un
  test de `listing.test.ts` fige le libellé. ⚠️ La variable d'e-mail
  `{{demande.destinataire}}` ne se renomme PAS non plus : son catalogue est FIGÉ, avec
  jumeau SQL et garde serveur `t03`.
- **Pages** : `RequestsListPage` (filtres statut/organisme/démarche/priorité/source,
  pagination 20, filtre initial depuis `?status=`, bouton « Nouvelle demande » →
  `/demandes/nouvelle`), le **tableau des demandes** `/demandes/tableau` et la **fiche
  d'instruction** ci-dessous. Les trois vues d'une même sélection — liste, tableau, carte —
  ont chacune leur **entrée de rail** (le tableau juste au-dessus de la liste) et se
  renvoient l'une à l'autre par des boutons d'en-tête.
  ⚠️ Deux entrées partagent désormais le préfixe `/demandes` : l'activation du rail ne peut
  plus venir de `NavLink` (qui allumerait les deux sur `/demandes/tableau`, `aria-current`
  compris, sans laisser l'appelant le contredire). Elle vient de
  `src/components/layout/nav.ts` — `isNavRouteActive`, pur et testé, avec la liste `except`
  des sous-chemins qui ont leur propre entrée. **Toute future route sous une entrée
  existante se déclare là.**
- **Fiche d'instruction de la demande** (`RequestDetailPage` + `instruction/`, design Claude
  Design « Suivi demande » implémenté le 2026-08-22) : page pleine hauteur. **En-tête** : fil
  d'Ariane (Demandes / statut / référence mono), objet, statut (pastille à point), échéance
  (`due_at` : « dans N jours » / « en retard »), sous-titre usager · canal · date · échéance,
  **action principale** (transition « vers l'avant » : `splitTransitions`) + menu « ⋯ » (autres
  transitions, copier la référence). **Onglets** : Résumé (clôture, informations saisies
  étiquetées par `procedure_snapshot.form_schema` avec conditions rejouées — `formAnswers` —,
  description, **lieu d'intervention** (carte + itinéraire, ci-dessous), demandes liées via
  `useRequestSummaries`), Documents
  (pièces de la demande **groupées par exigence du formulaire**, avec leur qualification et
  l'historique de leurs remplacements — vignette, taille, état de copie, « Voir » /
  « Télécharger » par URL signée, « Qualifier », « Remplacer la pièce » ;
  pièces d'instruction ; courriers), Échanges, Notes internes (`request_messages`,
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
      exécutable, et un lien `javascript:` retombe en texte.
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
      ⚠️ `trimForSend` ne renvoie **jamais** un tour en erreur — sinon le modèle relit « Le
      plafond est atteint » comme sa propre réponse et enchaîne dessus.
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
    pièces d'instruction, courriers, exporter le journal, changer le service instructeur,
    et le canal **SMS** du composeur. Ne rien cacher : on les travaillera ensuite.
    (« Écrire à l'usager » et l'onglet Échanges sont livrés — voir ci-dessous.)
  - **« Voir la fiche »** du bloc Usager ouvre la **fiche usager** `/usagers/:contactId`
    (feature `contacts`) dès qu'un usager Socle est rapproché ; grisée sinon (identité
    déclarée sans rapprochement, ou dépôt anonyme).
  - **`instruction/instruction.ts`** (pur, testé) porte TOUTE la déduction (échéance,
    sous-titre, identité, réponses, étapes, activité, vignettes) ; les composants affichent.
  - **`TransitionActions.tsx`** = `useTransitionRunner` (transition active, application
    directe ou dialogue, erreur) + `TransitionDialog` (motif / commentaire pour l'usager / assigné),
    monté une fois par fiche. Le dialogue ne dépend que de `TransitionDialogRunner` — le
    strict nécessaire — pour que le tableau des demandes, où la demande visée change à chaque
    geste, monte LE MÊME dialogue avec son propre runner et un `subtitle` qui nomme la demande. Les refus de la garde SQL sont affichés tels quels (bandeau
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
  - **Cadrage sur le TERRITOIRE** (2026-08-31, arbitrage PO de l'entrée B1 du backlog) : la
    carte s'ouvre sur l'**étendue des quartiers** publiés par le Socle — tout le découpage
    tient dans le cadre, et rien d'autre ne le décide (`quartiersBounds` dans
    `src/lib/quartiers.ts` + `fitBox` dans `src/lib/carto.ts`, purs et testés). Les épingles
    n'entrent PAS dans ce calcul : une demande égarée à 600 km n'élargit plus la vue, et
    cocher un filtre ne renvoie plus l'agent au cadre initial (`frameKey` : le cadre ne se
    refait que quand le CADRE change, pas quand la sélection change).
    - **Repli, dans cet ordre**, quand le référentiel ne publie pas de quartiers : le
      **siège** de la collectivité (`socle-proxy /v1/organizations/root`, géocodé à la BAN —
      `useOrganisationAnchor` ; `fitAround` impose le centre et n'ajuste que le zoom, mesuré
      **en symétrique** autour de lui) ; puis les **épingles seules** (`fitBounds`, le
      cadrage d'origine — celui qui plantait le centre en **Corrèze** pour une demande à
      Nantes et le reste autour d'Arles).
      ⚠️ Ne PAS « corriger » `fitBounds` en remplaçant son centre : son zoom est calculé pour
      SON centre, le déplacer pousse hors cadre les points d'en face. C'est tout l'objet de
      `fitAround`.
    - **Deux planchers de zoom, à ne pas confondre.** `MIN_ZOOM` (**4**, l'échelle d'un
      continent) borne ce que l'AGENT peut demander à la molette : c'est ce qui rend enfin
      atteignable une demande hors territoire. `TERRITORY_ZOOM` (12, l'ancien `MIN_ZOOM`)
      borne ce que la carte s'accorde TOUTE SEULE à partir de ses épingles, pour qu'une
      épingle lointaine n'ouvre pas la vue sur l'Europe. Le cadrage sur le territoire, lui,
      descend jusqu'à `MIN_ZOOM` : une intercommunalité (ACCM fait 60 km d'est en ouest) ne
      tient pas dans un écran au zoom 12.
    - ⚠️ **Ne rien cadrer tant qu'on ne sait pas** (`framePending`) : `useQuartiers` et
      `useOrganisationAnchor` distinguent « pas de quartiers / pas de siège » de « pas encore
      répondu ». Sans cette distinction, la carte se posait d'abord sur ses épingles — en
      Corrèze — puis sautait sur le territoire une seconde plus tard, sous les yeux de
      l'agent. Mieux vaut une carte qui arrive un peu après qu'une carte qui arrive fausse.
    - ⚠️ Le cadrage suit le territoire même quand les limites ne sont pas **dessinées**
      (bascule « Afficher les quartiers ») : basculer l'affichage ne déplace pas la carte.
    - ⚠️ **Un confort, jamais une dépendance** : route absente, Socle muet, pas d'adresse de
      siège ⇒ on descend d'un cran dans le repli, jamais une erreur. Iris ne stocke ni la
      géométrie, ni l'adresse, ni aucun point.
    - **Ce qui reste ouvert** (question de fond de B1, jamais tranchée) : une demande **hors
      territoire** reste hors du cadre initial — elle s'atteint en reculant. Est-ce un
      cadrage à élargir, ou une **anomalie à signaler** ?
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
  - **Quartiers** (2026-08-28) : le découpage du territoire se superpose aux épingles,
    chaque quartier tracé et **nommé en son centre** à la couleur du référentiel
    (`QuartierLayer`, brique partagée avec la carte du champ d'adresse). Bascule
    « Afficher les quartiers » **active par défaut** — c'est une option d'AFFICHAGE, pas un
    filtre : elle ne change pas la sélection de demandes, seulement ce qu'on voit dessous,
    d'où sa place à droite de la barre, séparée des filtres. Absente quand le référentiel ne
    publie aucun quartier. Le recadrage continue de suivre les DEMANDES, jamais les
    quartiers : c'est la sélection filtrée qu'on vient regarder.
  - Vérifié en navigateur le 2026-08-23 : d'abord sur harnais jetable (mosaïque, épingles,
    écartement, fiche y compris bascule au bord, déplacement, zoom, recadrage, géocodage en
    masse réel), puis **sur l'application réelle** avec la demande DEM-2026-000005
    (10 avenue de Frémeur, 44000 Nantes) — épingle posée, fiche de survol complète, et le
    bloc « Lieu d'intervention » de la fiche d'instruction (carte, « Numéro localisé »,
    « Guider »).
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
- **Saisie d'adresse assistée** (2026-08-28, `src/lib/adresse.ts` pur/testé — 22 cas —,
  `src/components/address/`) : les trois endroits où l'on écrit une adresse — bloc **lieu
  d'intervention** du formulaire de démarche, **création d'usager**, **fiche usager** —
  partagent un même champ. Jusqu'ici Iris n'aidait à saisir nulle part : `autocomplete=0`
  était même forcé côté BAN, et la seule validation d'adresse du dépôt était « le pays ne peut
  pas être vidé ». Une adresse fausse ne se voyait qu'après : pas d'épingle sur `/carte`,
  « Guider » sans destination, et un **quartier recalculé faux** côté Socle.
  - **Il propose, il ne garde pas la porte.** Retenir une proposition est TOUJOURS facultatif :
    le texte libre est conservé, « Adresse introuvable ? » ouvre la saisie manuelle, une panne
    du géocodeur se dit en une ligne discrète. La BAN ignore les adresses neuves et tout ce qui
    n'est pas en France — d'où le retrait de l'assistance dès que le pays d'un contact n'est
    pas la France (`isFranceCountry`).
  - **Le clavier fait tout** : combobox ARIA (`aria-expanded`/`aria-controls`/
    `aria-activedescendant`, `aria-live` annonçant le nombre de propositions), ↑ ↓ pour
    parcourir, **Entrée choisit et NE SOUMET PAS**, Échap ferme — motif repris de
    `MentionTextarea`. Jetons `autoComplete` corrects (`street-address`, `postal-code`,
    `address-level2`) pour que l'autofill du navigateur fonctionne.
  - **« Plus de champs » ne montre que ce que le contrat porte.** Le bloc d'intervention a
    `complement`/`appartement` (+ `batiment` quand la démarche le pose) ; contacts-api n'a
    qu'`address_line2`. Y écrire un bâtiment séparé inventerait un modèle que le Socle n'a
    pas. Déplié d'office si l'un des champs est déjà rempli.
  - **`batiment` est reconnu depuis le 2026-08-28** (`lieu.ts`, clé `intervention_batiment` +
    libellés « bâtiment »/« immeuble ») et rejoint les précisions d'accès : **jamais dans la
    requête envoyée au GPS**, comme complément et appartement.
  - **La reconnaissance du bloc est UNE** : `interventionFields(schema, candidates)` sert la
    LECTURE (`interventionLocation`, champs visibles) et la SAISIE (`ProcedureFormFields`, tout
    le schéma). Sans quoi un bloc reconnu à l'écriture pourrait ne plus l'être à la relecture.
  - **`fitStreetParts`** répartit la ligne sur les champs que le bloc porte VRAIMENT : un BTQ
    que la liste fermée ne sait pas dire (« 2 A »), ou un numéro sans champ, rejoignent la
    **voie** plutôt que d'être perdus.
  - ⚠️ **Piège vécu (2026-08-28)** : la ligne affichée ne peut PAS être recomposée depuis les
    champs séparés PENDANT la frappe. Le découpage normalise les espaces, si bien qu'un « 12 »
    suivi d'une espace redevient « 12 » et que la lettre suivante se recolle — la saisie
    donnait « 12 Bisruedeslilasarles ». `InterventionAddress` garde donc la ligne TAPÉE en
    état local tant que l'agent tape, et ne rend la main aux champs qu'une fois une
    proposition retenue. **Règle générale : un champ contrôlé ne se dérive jamais d'une
    transformation à perte de ce qui vient d'être tapé.**
  - **La carte** (`AddressMap`) réutilise `TileLayer` et le motif de `LieuIntervention` : le
    point, la réserve du géocodeur (`PRECISION_LABELS` — même vocabulaire que la carte des
    interventions), le zoom ±. Elle MONTRE, elle ne saisit pas : le point n'est pas
    déplaçable, puisque Iris ne stocke aucune coordonnée — seule l'adresse est enregistrée.
    ⚠️ **`useElementSize` mesure au MONTAGE** : `AddressMap` n'est monté qu'une fois le point
    connu (un conteneur rendu conditionnellement plus tard n'est jamais mesuré, et sa mosaïque
    reste vide — vécu le 2026-08-28).
  - **Débit** : la Géoplateforme annonce 50 appels/IP/s, mais une collectivité sort par UNE
    IP — debounce 300 ms, 3 caractères minimum, une requête en vol, `retry: false` (pendant la
    frappe, un échec se remplace tout seul au caractère suivant).
  - **Quartiers** (`src/lib/quartiers.ts` géométrie pure/testée, `src/features/socle/
    quartiers.ts` contrat, route `socle-proxy /v1/quartiers/list`) : la carte superpose les
    limites du territoire et nomme celui où l'adresse tombe. Livré et vérifié le 2026-08-28
    sur ACCM (5 quartiers, `MultiPolygon`, couleurs `hsl(...)` du référentiel).
  - ⚠️ **Le contrat public-api demande DEUX paramètres, sans quoi il ne rend rien d'utile**
    (aller-retour du 2026-08-28) :
    - **`geometry=true`** — par défaut `GET /v1/quartiers` rend les quartiers **sans
      polygone** ; la plupart des consommateurs ne veulent que les libellés ;
    - **`organization_id`** — **exigé des clés PLATEFORME** (celle d'Iris) pour les
      géométries ; le Socle en prend la racine, et les quartiers n'existent que sur les
      organisations principales. `tenant.socleOrgId` EST cette racine, vérifiée par
      `resolveTenant` : jamais une valeur venue du client.
    - Le champ s'appelle **`geometry`** (GeoJSON de `ST_AsGeoJSON`), **pas `geom`** — ça,
      c'est le nom de la colonne PostGIS, binaire, qui ne sort jamais. Confondre les deux
      faisait rendre `geom: null` sur des quartiers qui avaient tous leur polygone
      (la colonne est `not null` côté Socle).
  - **`quartierAt`** (lancer de rayon, pur/testé) répond à « quel quartier CONTIENT ce
    point ? » — vérifié contre `ST_Contains` du Socle : même verdict. Ce n'est PAS forcément
    le quartier affiché sur la fiche de l'usager : le Socle laisse **forcer** un rattachement
    à la main (`quartier_auto = false`), et un contact sans coordonnées n'en a aucun de
    calculé. Les deux peuvent donc légitimement différer — d'où « d'après les limites du
    référentiel », qui dit d'où vient CE verdict-ci plutôt que de laisser croire à une
    contradiction.
  - La couche reste FACULTATIVE par construction : pas de géométrie exploitable ⇒ pas de
    couche, et rien d'autre ne bouge. Le rendu vit dans `src/components/map/QuartierLayer.tsx`,
    partagé avec la **carte des interventions** : remplissage léger (la carte doit rester
    lisible dessous), trait appuyé (la question est « de quel côté de la limite suis-je ? »),
    étiquettes au centre de gravité du plus grand anneau (`quartierLabelPoint`) — coupées sur
    la vignette d'un champ d'adresse, où le nom du quartier est déjà écrit en toutes lettres.
  - Vérifié en navigateur réel le 2026-08-28 : autocomplétion et sélection au clavier sur les
    trois écrans, carte et tuiles réelles, « Plus de champs » limité aux champs de la démarche,
    et le récapitulatif portant bien les clés `intervention_*` attendues.
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

- **Qualification des pièces justificatives** (2026-08-28, `instruction/conformite.ts`
  pur/testé — 31 cas —, `QualificationDialog.tsx`, `useQualifyAttachment.ts`, onglet Documents) :
  l'agent déclare chaque pièce **conforme** ou **non conforme**, avec un motif pris dans un
  catalogue **fermé de cinq** et une précision libre facultative.
  - **L'onglet Documents groupe désormais PAR EXIGENCE du formulaire**, plus par fichier. Une
    pièce se juge par rapport à ce qui était demandé : « le justificatif de domicile est-il en
    règle ? » a un sens, « ce PDF-là est-il en règle ? » beaucoup moins — surtout quand un champ
    accepte plusieurs fichiers, et que le motif « la pièce est incomplète » ne veut rien dire
    autrement. C'est aussi la seule façon de montrer une exigence **obligatoire jamais honorée**
    (`manquante`) : elle n'a aucune ligne à afficher, et c'est justement ce qu'il faut voir.
    Le verdict, lui, s'écrit fichier par fichier.
  - **Seule la résolution POSITIVE est fermée** par une pièce obligatoire non conforme (décision
    PO 2026-08-28). Mise en attente, annulation et résolution négative restent ouvertes : on
    refuse souvent PARCE QU'une pièce manque, et une pièce qui cloche doit pouvoir mettre le
    dossier en attente. Le blocage se reflète dans l'en-tête, le menu « ⋯ » **et** le bouton de
    l'Avancement (`blockedReason`), toujours avec le motif écrit — un bouton grisé sans
    explication est le pire des deux mondes.
  - **Une pièce non conforme place la demande « En attente d'information »**, côté SERVEUR, dans
    la même transaction que le verdict. Le statut `en_attente` porte déjà exactement ce libellé :
    aucun 8ᵉ statut, l'invariant du workflow fixe tient. Depuis « À traiter » la matrice interdit
    la transition — la RPC le **dit** (`status_changed: false`) au lieu de laisser l'écran le
    deviner, et le toast annonce ce qui s'est passé, pas ce qu'on espérait.
  - **Le retour en instruction reste un geste d'agent** : quand tout est redevenu conforme, un
    bandeau le PROPOSE (`readyToResume`), il ne le fait pas à sa place.
  - **« Signaler à l'usager » n'envoie rien** : il dépose un brouillon (`buildNonConformityEmail`)
    dans le composeur de l'onglet Échanges — objet, salutation, liste des pièces avec motif et
    précision — que l'agent relit, amende et envoie lui-même. Ce texte parle au nom de la
    collectivité. Le brouillon voyage par la prop `draft` d'`EchangesPane`, appliquée une fois
    par nouvel OBJET puis rendue au parent (`onDraftApplied`) : sans cela, un rendu de plus
    écraserait ce que l'agent vient de corriger.
  - Le courriel **ne cite QUE les pièces non conformes**, jamais les manquantes : réclamer une
    pièce jamais déposée est un autre geste (« Demander une pièce », encore `SOON`), avec ses
    propres mots. Mélanger les deux ferait un courriel qui reproche à l'usager quelque chose
    qu'il n'a pas fait. Une valeur absente est **omise**, jamais remplacée par un repli — même
    règle que `requestTemplateValues` (`identity.known ? identity.name : null`).
  - ⚠️ **`conformite.ts` est un JUMEAU SQL.** La vérité vit dans `form_attachment_requirements`,
    la garde `t17_requests_require_pieces_conformes` et la RPC `qualify_request_attachment`
    (migrations `20260828100000` / `20260828100100`). Toute évolution de la règle se répercute
    dans les DEUX, plus `conformite.test.ts` et `supabase/tests/qualification-pieces.test.sql`,
    dont les 14 premiers cas sont littéralement jumeaux.
  - ⚠️ **`request_attachments` n'a aucune policy UPDATE cliente** (elle n'en a jamais eu) : un
    UPDATE direct depuis le navigateur ne toucherait **aucune ligne, silencieusement**. La seule
    porte est la RPC, qui vérifie le droit d'**instruction**.
  - Le journal nomme le geste (`piece_qualifiee` → « Pièce déclarée conforme / non conforme »,
    fichier et motif). Le catalogue de motifs est **injecté** dans `activityItems`
    (`motifLabel`), comme `nameOf` : `conformite.ts` lit déjà `formSchemaFrom` d'`instruction.ts`,
    l'importer en retour ferait un cycle.
  - `attachmentFieldLabels` a été **supprimée** : `pieceFields` la remplace en mieux (elle rejoue
    la visibilité et rend l'exigence, pas seulement le libellé).
  - Vérifié en navigateur le 2026-08-28 sur DEM-2026-000007 (« Acte de naissance », justificatif
    de domicile obligatoire) : blocage affiché avec son motif, qualification non conforme →
    bascule en attente + journal, brouillon de signalement pré-rempli, requalification conforme →
    bandeau de reprise, reprise → résolution positive rouverte.

- **Avis de clôture à l'usager** (2026-08-28, `@fn/_shared/email/cloture.ts` pur/testé — 16 cas —,
  `useSendClosureEmail`, mode `kind: "cloture"` de l'edge `send-request-email`) : résoudre une
  demande PRÉVIENT l'usager par courriel, et l'échange est enregistré comme tous les autres.
  - **Le commentaire devient FACULTATIF** (décision PO). `needsClosureText` est devenu
    `asksClosureText` : le dialogue propose le champ, la garde SQL ne l'exige plus
    (migration `20260828120000`, qui réémet `requests_guard_write` moins une ligne).
    `buildTransitionUpdate` écrit `closure_text: null` quand il est vide, **explicitement** :
    sur une demande rouverte puis reclose, omettre la colonne y laisserait le commentaire de la
    clôture précédente — que l'usager recevrait comme s'il venait d'être écrit.
  - **Le serveur compose TOUT** : le navigateur n'envoie que l'identifiant de la demande. C'est
    ce qui permet au mode d'exiger le droit de **clôture** plutôt que l'instruction — celui qui
    vient d'autoriser la transition. Les deux décisions vont ensemble : ouvrir la fonction à la
    clôture SANS composition serveur ferait d'Iris un relais ouvert pour quiconque peut clore.
  - Le dialogue **annonce l'objet exact** que recevra l'usager (`CLOSURE_NOTICE`, cité depuis
    `CLOSURE_SUBJECTS`) : l'agent doit reconnaître le message dans l'onglet Échanges.
  - ⚠️ **L'envoi SUIT la transition, il ne la conditionne pas.** La demande est résolue quoi
    qu'il arrive. Un `no_recipient` est annoncé comme un fait (« aucun courriel : la demande ne
    porte pas d'adresse »), pas comme une erreur ; tout autre échec s'affiche en bandeau, en
    disant explicitement que la clôture, elle, a bien eu lieu.
  - ⚠️ **Le motif de clôture ne sort jamais** — il n'est même pas une entrée de `closureEmail`.
  - ⚠️ **La civilité se normalise avant de sortir.** Le Socle la stocke en minuscules : le
    premier envoi réel a produit « monsieur Laurent Jacquot, » pendant que l'écran affichait
    « Monsieur ». `civilityLabel` vit désormais dans `@fn/_shared/identity/declared` et
    `src/features/contacts/usager.ts` le RÉEXPORTE — un seul catalogue pour l'écran et le serveur.
  - `salutation()` et `quotedSubject()` vivent dans `@fn/_shared/email/adresse.ts`, partagés
    avec le signalement de non-conformité : deux courriels d'Iris ne doivent pas saluer
    différemment.
  - Résidu connu : si le navigateur meurt entre la transition et l'appel, l'avis ne part pas et
    rien n'est tracé. Sortie le jour venu : une boîte d'envoi drainée sur cron (motif
    `notifications-mailer`), pas un envoi synchrone « plus robuste ».
  - Vérifié en envoi RÉEL le 2026-08-28 (avec l'accord explicite du PO) sur DEM-2026-000004,
    résolue positivement SANS commentaire : courriel reçu, échange enregistré dans l'onglet
    Échanges avec le corps exact. C'est cet envoi qui a révélé le défaut de civilité, corrigé
    et couvert par un test.

- **Ajouter une pièce, modifier les réponses** (2026-08-28, `instruction/formulaire.ts`
  pur/testé — 15 cas —, `AjouterPieceDialog.tsx`, `FormulaireEditDialog.tsx`,
  `useEditRequestForm.ts`) : les deux gestes qui manquaient pour qu'une non-conformité se
  résolve depuis la fiche.
  - **« Remplacer la pièce » / « Déposer la pièce »** n'apparaît que sur une exigence
    `non_conforme` ou `manquante` — une exigence conforme n'appelle pas de pièce de plus.
  - **« La plus récente fait foi »** (décision PO) : la pièce déposée REMPLACE celles qui
    étaient actives sur l'exigence (`superseded_by`). Elles restent au dossier, sous un
    dépliant « N pièces remplacées », barrées, avec leur verdict et leur motif — et toujours
    téléchargeables. Rien n'est supprimé.
    ⚠️ **Conséquence signalée au PO avant sa décision** : sur le motif « la pièce est
    incomplète », la page manquante ne s'ajoute pas, elle remplace. Le dialogue l'ANNONCE avant
    l'envoi (« remplacera les N pièces déjà déposées »), et le module distingue déjà `attachments`
    (actives) de `superseded` : rouvrir un mode « compléter » ne changerait que la liste des
    lignes que la RPC marque.
  - **`attach_request_piece` est la porte unique** : téléversement navigateur (policy storage =
    droit d'instruction), puis RPC qui revérifie le chemin, déclare, remplace et journalise —
    en UNE transaction. Un INSERT client puis un UPDATE client laisserait, sur coupure, une
    pièce neuve à côté d'une ancienne encore active : une exigence bloquée inexplicable.
  - **« Modifier » les réponses** (onglet Résumé) rejoue le `form_schema` **FIGÉ** du
    `procedure_snapshot` dans `ProcedureFormFields` (prop `attachmentsReadOnly` : les champs
    « pièce » sont rappelés, non déposables — elles se gèrent dans Documents). Le bouton
    compte les modifications réelles (`changedAnswerKeys`) et reste fermé s'il n'y en a aucune.
  - ⚠️ **On modifie les RÉPONSES, jamais la démarche.** Sa définition vit dans le Socle
    (invariant), et le snapshot est la pièce du dossier : le formulaire rejoué est celui
    présenté au dépôt, pas celui d'aujourd'hui. Aucune relecture Socle ici, contrairement à la
    création.
  - ⚠️ **`validateAnswers` ÉCARTE les erreurs de pièces** — `validateFormSubmission` refuse une
    pièce obligatoire absente, ce qui est juste à la création mais absurde ici : bloquer la
    correction d'une date de naissance parce qu'un justificatif n'est pas arrivé n'a aucun sens.
    Le manque est un fait du dossier, que Documents affiche et que `t17` sanctionne au bon
    moment. Le geste reste un simple UPDATE : `requests_guard_write` exige déjà l'instruction.
  - Modifier une réponse peut rendre une pièce obligatoire, ou cesser de l'exiger (`requiredIf`) :
    le dialogue le dit. Corollaire connu et documenté dans `data-model.md` : un agent peut donc
    desserrer `t17` en éditant `form_data` — ce n'est pas une escalade (il pourrait tout aussi
    bien déclarer la pièce conforme) et les deux gestes sont journalisés.
  - Le journal nomme les deux gestes : `piece_ajoutee` (« Pièce ajoutée » / « Pièce remplacée »
    avec le compte) et `form_data_updated` (« Réponses du formulaire modifiées » — le nombre,
    jamais les valeurs : une réponse peut porter des données personnelles et le journal est
    immuable).
  - Vérifié en navigateur le 2026-08-28 sur DEM-2026-000007 : prénom corrigé et journalisé,
    remplacement annoncé puis effectué (« 1 pièce remplacée »), ancienne barrée avec son motif,
    nouvelle qualifiée conforme, résolution positive rouverte.

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
  ordre alphabétique trompeur), **« Grouper par »** statut / organisme / démarche /
  priorité / source (regroupement client de la page courante, avec pré-tri serveur sur la
  clé de groupe pour des groupes contigus entre pages ; groupes repliables), **export CSV**
  de TOUTE la sélection filtrée dans l'ordre affiché (`fetchRequestsForExport`, lots de 1000,
  borné à 5000 lignes — tronçon signalé ; `src/lib/csv.ts` : `;`, BOM UTF-8 Excel FR).
  En-tête triable `src/components/ui/sortable-header.tsx` (+ `aria-sort`).
  La page est en **gabarit large** (`useWideLayout`) : le tableau prend toute la largeur
  de l'écran, seule la barre de filtres reste bornée (1240px) pour que les listes déroulantes
  gardent une taille utile.
