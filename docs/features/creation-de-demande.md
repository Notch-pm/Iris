# Parcours de création guidé

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

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
  - **Fiche démarche** (2026-09-18, maquette Claude Design « Écran agent — fiche
    démarche » ; `procedure/FicheDemarcheDialog.tsx`, module pur `procedure/ficheDemarche.ts`,
    hook `useProcedureFiche`) : un bouton **« i »** sur chaque carte de l'étape Démarche —
    et la touche `i` sur une carte — ouvre une fenêtre de 1 080 px en trois familles :
    **Côté usager** (ce que la collectivité écrit pour ses usagers, contrat Socle 1.24.0 :
    descriptif, délai d'instruction annoncé, public, pièces annoncées, FAQ usager),
    **Interne — agent** (la part agent de la base de connaissances, une rubrique par bloc
    NON VIDE) et **Aide** (l'assistant, en mode démarche seule). « Choisir cette démarche »
    en pied fait le même geste que la carte. Relue dans le Socle à l'ouverture, rien de
    conservé.
    - ⚠️ **La carte n'est plus un `<button>`** (un bouton n'en contient pas un autre) : un
      `<li>` cliquable à la souris, et deux vrais boutons, « i » et « Choisir », qui
      arrêtent la propagation — le clavier n'a jamais dépendu du clic sur la carte.
    - ⚠️ **Les pièges du contrat sont tenus À L'ÉCRAN** : « Temps de saisie du formulaire »
      et « Délai d'instruction annoncé » nommés pour ne pas se confondre, et aucune carte
      quand la valeur manque ; la note sur le public est dite « ne restreint pas le dépôt »
      à côté des publics admis ; pièces ANNONCÉES et pièces du FORMULAIRE en deux listes,
      jamais fusionnées ; « FAQ usager » et « FAQ agent » dans deux familles.
    - **Rien d'écrit ≠ non relayé** : `user_communication: null` dit que la collectivité
      n'a rien écrit ; une clé ABSENTE dit que `socle-proxy` n'est pas à jour — l'écran ne
      confond pas les deux (`userCommunicationRelayed`).
    - **Fil d'assistant** : quand la démarche consultée est la démarche CHOISIE, la fiche
      reprend le fil de la page (celui du rail) ; sinon elle ouvre le sien, qui disparaît à
      sa fermeture.
    - **Rubriques partagées** : `procedure/FicheSections.tsx` (taille `dialog` ici, `page`
      dans la Base de connaissances — `src/features/knowledge/`). Une rubrique corrigée
      l'est pour les deux écrans.
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
      laisser croire à une panne. Détail : [`docs/data-model.md`](../data-model.md)
      § « Publication des démarches ».
  - **Consentements RGPD au récapitulatif** (2026-09-20, `ConsentGroup` dans
    `RequestSummary.tsx`, catalogue `@fn/_shared/consents/catalog` pur/testé) : les **deux**
    questions posées à l'usager, quelle que soit la démarche — traitement (obligatoire) et
    partage avec les services de l'organisme principal (facultatif, **coché** d'office). L'agent les
    lit à l'usager et coche ; sans l'obligatoire, « Créer la demande » et « Créer et imprimer »
    restent fermés, avec la raison en pied d'écran.
    - **Leur place est au RÉCAPITULATIF**, pas au formulaire : c'est le moment du dépôt, pas
      celui de la saisie. Et surtout **pas dans `form_schema`** : un consentement qu'un service
      pourrait décocher dans son paramétrage ne vaudrait rien — le catalogue est fermé, en code.
    - **L'écran affiche la phrase que le SERVEUR consignera**, à l'identique
      (`consentStatement(kind, current.organizationName)` ↔ `organizations.name`, que la synchro
      tient égal au nom de la racine Socle). Le navigateur n'envoie que `kind` et `granted` — un
      `statement` venu d'un client est refusé par `normalizeConsents`, qui est la vraie garde.
    - ⚠️ **Non persistés dans le brouillon**, et `DRAFT_VERSION` reste à 1 : un consentement est
      un acte de l'usager présent à cet instant. Le restaurer d'une session vieille de trois
      jours ferait valider un dépôt sur une case que personne n'a cochée. À la reprise, la
      question est reposée — c'est le prix, et il est juste.
    - **Le parcours MOBILE pose les mêmes questions**, au même catalogue, dans un bloc propre
      au-dessus des doublons (`MobileNewRequestPage`) : il crée de vraies demandes, il ne peut
      pas sauter la garde.
    - Écriture : `requests.consents` (immuable, `t10`) **et** le référentiel Socle quand
      l'usager y a une fiche (`POST /v1/contacts/{id}/consents`, idempotent par demande).
      Échec côté Socle ⇒ anomalie `consentement_non_transmis_au_socle`, jamais un refus.
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
    ⚠️ **À ne pas confondre avec les « demandes liées » (même incident)** — chantier
    [`docs/demandes-liees.md`](../demandes-liees.md), lot L1 livré le 2026-10-16 :
    groupes `request_groups` (RPC `link_requests` / `unlink_request`), démarches
    mutualisables (`procedure_link_settings`, section « Demandes liées » des Paramètres,
    `src/features/linking/`), lieu recopié `request_locations` ; lot L2 : recherche serveur
    `find_similar_requests[_for]`, carte « Même incident » de l'onglet Résumé (slot `incident`
    de `ResumePane`, recherche sur bouton seulement) et section « Signalements similaires » du
    rail de création (slot `incident` de `CreationRail`, automatique au récapitulatif, liaison
    après création) ; lot L3 : résolution commune — `TransitionDialog` accepte une section
    `extra(spec)` et `useTransitionRunner.onDone` reçoit désormais `(spec, input)` ; la fiche y
    monte `useGroupResolution` (`src/features/linking/GroupResolution.tsx`), comme le tableau
    (`useBoardTransition.onDone(card, spec, input)`, demande visée suivie par une référence) et
    la feuille Statut du mobile (`MobileStatusSheet.extra`) ; lot L5 : pastilles de la liste
    (`LinkHintBadges`, `useLinkHints` — un appel `request_link_hints` par page, appelé AVANT
    le retour anticipé de `RequestsListPage`) et carte « Même incident » sur la fiche mobile
    (hors intervenant). Les « demandes proches »
    rapprochent un même USAGER ; les demandes liées, des usagers DIFFÉRENTS pour un même lieu.
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
    ⚠️ **Un type de champ inconnu vide TOUT le schéma** — à l'écran, dans l'edge function
    ET dans le jumeau SQL (`form_field_valid`, dont dépend la garde t17 des pièces
    obligatoires). Tout nouveau type du contrat Socle se déclare aux **trois** endroits (+ un
    test chacun) **avant** d'être publié côté Socle. Vécu à blanc avec `location` (1.29.0) :
    sans le miroir, une démarche publiée avec ce champ aurait cassé la création guichet et
    ouvert la clôture positive sans pièce.
  - **Usager : rapprocher, sinon CRÉER dans le Socle** (décision PO 2026-08-26) — voir
    [`src/features/contacts/CLAUDE.md`](../../src/features/contacts/CLAUDE.md). « Poursuivre sans
    rapprochement » ne subsiste que comme sortie de secours sur panne AVÉRÉE, et la demande
    porte alors l'anomalie `usager_a_creer_dans_socle`, posée par le SERVEUR.
  - **`create-request-from-procedure`** (edge, JWT + rôle agent/administrateur en code, CORS
    allowlist) : cache du tenant = périmètre, démarche rechargée depuis Socle (503/502 si
    injoignable — contrairement à l'ingestion, jamais refusée), snapshots construits côté
    serveur (toute clé `procedure_snapshot`/inconnue dans le payload → 400), contact
    rapproché **relu depuis contacts-api** (identité de vérité), écriture ATOMIQUE via la
    RPC `create_request_from_procedure` (demande + pièces + événement
    `request_created_from_procedure`, attribution à l'agent — tout ou rien). Pièces
    (2026-09-08) : REÇUES d'abord par l'edge function `request-attachments` (porte unique :
    type réel, taille, sha256 → zone d'attente `attachment_uploads`, objet sous
    `{org}/_staging/`), puis référencées par `upload_id` ; l'edge function les DÉPLACE sous
    la demande et la RPC relit tout en base. **Plus aucun octet du navigateur vers le bucket.**
