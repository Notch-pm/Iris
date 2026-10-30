# Échanges avec l'usager et avis de clôture

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **La messagerie de l'usager est FERMÉE par défaut** (décision PO 2026-10-25) : l'usager
  n'écrit sur sa demande (portail, suivi par code) que quand le service attend sa réponse —
  ouverte par une pièce **non conforme**, par « Attendre une réponse de l'usager » à l'envoi
  d'un message, ou par le bouton de l'onglet Échanges (droit d'instruction) ; **une ouverture =
  une réponse**, la réponse la referme, la clôture aussi. Gardé en base
  (`request_citizen_reply_state`, `record_citizen_message` refuse en `P0423`), reflété par
  `replies_open` dans la vue usager (contrat 2.11.0) — jamais une règle d'écran seule.

- **Échanges avec l'usager** (2026-08-26, `instruction/courriel.ts` pur/testé — 28 cas —,
  `EchangesPane.tsx`, `useSendRequestEmail.ts`, edge `send-request-email`) : depuis l'onglet
  **Échanges**, l'agent écrit un e-mail à l'usager, avec un modèle ou à la main, pièces
  jointes comprises. L'échange est enregistré dans `request_emails` (expéditeur, date et heure
  d'envoi, objet, corps réellement parti, pièces, modèle utilisé).
  - **M2 — publié dans l'espace usager** (B12, lot L4c-3, 2026-10-25, `instruction/remise.ts`
    pur/testé) : quand la collectivité a allumé ses avis à l'usager et qu'un canal en ligne
    VOIT la demande (compte du portail, suivi par code), le message n'est plus envoyé en
    entier : `send-request-email` le **publie** (`publish_citizen_message`, `delivery =
    'espace'`, pièces comprises) et un avis avec extrait l'annonce 10 min plus tard. C'est le
    SERVEUR qui décide ; le composeur (bureau et mobile) l'**annonce** d'avance par
    `kind: "apercu"` (`useEmailDeliveryPreview`), et la confirmation dit ce que le serveur a
    réellement fait (`sentNotice`). Le fil marque « Avis automatique » / « Publié dans
    l'espace usager », et montre — au bureau seulement — les avis **non partis** avec leur
    raison (`citizen_notices`, `unsentNotices`, `NOTICE_REASON_LABELS`, jumeau de
    `SKIP_REASONS`).
  - **Messagerie de l'usager fermée par défaut** (décision PO 2026-10-25, `instruction/
    messagerie.ts` pur/testé, `useCitizenReplyState` / `useSetCitizenReplies`, migration
    `20261025160000`) : un bandeau en tête de l'onglet dit si l'usager peut écrire en ligne et
    pourquoi, avec **« Ouvrir / Fermer la messagerie »** (RPC `set_citizen_replies_open`,
    droit d'instruction) ; le composeur — bureau et feuille mobile — porte la case
    **« Attendre une réponse de l'usager »**, décochée par défaut et proposée seulement
    messagerie fermée (`replies_open` vers `send-request-email`, qui ouvre APRÈS l'envoi et
    le dit dans sa réponse). Une pièce déclarée non conforme l'ouvre aussi, quel que soit le
    statut (`replies_opened`, annoncé par le toast). **Une ouverture = une réponse** : la
    réponse de l'usager la referme, la clôture aussi, la réouverture d'une demande ne la
    rouvre pas. Bandeau et case n'existent que sur une demande `citizen_visible`. L'avis
    courriel d'un message ne dit « … et y répondre » que messagerie ouverte.
  - **Accusé de réception automatique** (2026-10-09) : le fil peut porter un échange **sans
    agent** (`sent_by` NULL) — l'accusé envoyé par Iris au dépôt (hors demandes issues de
    Clara). `exchangeAuthor` (`courriel.ts`) l'affiche « Iris · envoi automatique », jamais
    « Système / intégration · agent ». Détail : [`docs/emails.md`](../emails.md).
  - **Rédaction assistée** (2026-09-24, `EmailAssistantPanel.tsx`, `useEmailAssistant.ts`,
    edge `request-email-assistant`, modules purs `_shared/ai/emailDraft.ts` et
    `pseudonymize.ts`) : devant un message **vide**, bandeau repliable « Assistant IA » à
    l'ergonomie de Clara — pastilles **Accusé de réception / Suivi** (pas de clôture : l'avis
    de clôture est composé par le serveur), instructions complémentaires, « Générer la
    réponse » ; le corps est rempli, l'objet seulement s'il est vide. Devant un message
    écrit, **« Améliorer mon message »** corrige la langue sans changer le sens, et
    « Annuler l'amélioration » le défait tant que l'agent n'a rien retouché. Le brouillon
    connaît le dossier, la démarche, les **interventions** (sans nom) et les échanges déjà
    envoyés — **jamais les notes internes**. Droit exigé : instruction (celui d'envoyer).
    Détail et garanties : [`docs/assistant-ia.md`](../assistant-ia.md) § 9.
  - **Mise en page du fil** (2026-09-19, maquette Claude Design « Échange usager »,
    projet `da078641-cb80-4cff-ac9c-b26ba5009fec`) : les envois se lisent en ordre
    **chronologique**, chacun est un **tour** (`ThreadItem`) — gouttière d'avatar 36 px et
    **rail vertical continu**, ligne de méta « Nom · agent · envoyé le … · à adresse »,
    message encadré — et **le composeur est le dernier tour du fil**, avatar de l'agent
    cerclé, méta « Vous · adresse » : plus de carte détachée. Le composeur porte en barre
    haute le **menu « Insérer une variable… »** (chaque option : libellé et valeur résolue —
    il remplace les puces depuis le 2026-10-16, qui prenaient trop de place), le sélecteur de modèle, le
    bouton « Pièce jointe » et, s'il y en a, les documents du dossier ; objet et message
    sans cadre propre (le cadre, c'est le composeur) ; pied « Variables fusionnées avec la
    fiche de … » + « Envoyer l'échange ». Un envoi impossible (anonyme, sans adresse,
    archivée, sans droit) occupe la place du composeur, avec sa raison. Ce qui n'est PAS
    repris de la maquette : les accusés de lecture et les réponses de l'usager (Iris n'a ni
    l'un ni l'autre — l'usager ne peut pas répondre).
  - **Le composeur résout les variables à l'INSERTION, pas à l'envoi.** Choisir un modèle
    remplit l'objet et le corps déjà personnalisés ; choisir une variable insère la **valeur**
    au curseur, pas le jeton `{{…}}`. C'est la différence assumée avec l'éditeur de modèles des
    Paramètres : ici l'agent rédige le message final, le voit tel qu'il partira, et c'est ce
    texte-là qui part. Un trou — variable sans valeur pour cette demande — se voit donc tout de
    suite. Le menu ne propose d'ailleurs **que** les variables qui ont une valeur.
  - ⚠️ **Une valeur absente ⇒ la clé est OMISE** (`requestTemplateValues`), jamais un repli.
    « Identité déclarée », « Utilisateur », « Système / intégration », « date inconnue », et
    l'e-mail de l'agent que `useTenantMembers` met à défaut de nom : ce sont des mots d'écran
    de gestion, aucun ne doit atteindre un usager. `renderTemplate` rend alors du vide.
  - **Le droit d'INSTRUCTION** est exigé — miroir de `request_right_for(…, 'instruction')` dans
    l'edge function, qui reste l'autorité, et déjà le droit qu'exigent la policy d'insertion de
    `request_attachments` et la policy storage du bucket.
  - **Le serveur résout ce qu'un navigateur ne peut pas se voir confier** : le destinataire
    (jamais accepté du payload — sinon Iris devient un relais ouvert) et les pièces — depuis
    le 2026-09-08, le navigateur n'envoie que des `upload_id` (fichiers reçus par
    `request-attachments` pour cette demande) et des `attachment_id` (documents du dossier) ;
    chemin, nom, type et nature sont relus en base, et `send-request-email` ne télécharge
    jamais hors du préfixe `{organization_id}/{request_id}/`.
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
  - **« Verser au dossier »** (2026-10-24, backlog B10, `versement.ts` pur/testé,
    `VerserPieceDialog.tsx`, `useFileCitizenPiece`) : une pièce jointe par l'usager à une
    réponse en ligne (`citizen_message_id`) reste dans l'échange ; l'agent qui instruit peut
    en faire une pièce de la demande, rattachée à une exigence qu'il CHOISIT (rien de
    présélectionné quand il y a le choix), remplacement annoncé avant d'agir. RPC
    `file_citizen_piece` : une ligne de plus, même fichier, `source_attachment_id` vers
    l'original — le motif inverse de « joindre un document à un e-mail ». Une fois versée,
    la pièce est marquée « Versée au dossier » dans son message.
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
  - ⚠️ **Aucun avis pour une demande issue de Clara** (décision PO 2026-10-16, jumelle de
    l'exclusion de l'accusé de réception) : `closureNoticeApplies(source)` — la fiche et la
    fiche mobile n'appellent pas, le dialogue dit `NO_CLOSURE_NOTICE` au lieu d'annoncer un
    envoi, et `send-request-email` refuse (`409 clara_origin`) pour un onglet resté sur une
    version antérieure. Le commentaire de clôture reste au dossier (et lisible par l'API).
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
