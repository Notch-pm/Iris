# Pièces justificatives : porte unique, qualification, ajout

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Aucun octet n'entre dans le bucket des pièces depuis un navigateur** (2026-09-08) : tout
  fichier — d'un agent, d'un partenaire, ou produit par Iris — passe par la **porte unique**
  `supabase/functions/_shared/files/receive.ts` (taille, **signature binaire contre une liste
  fermée** : PDF, images raster, HEIC, DOCX/XLSX/ODT/ODS — jamais SVG, HTML, archive ni
  Office à macros ; extension cohérente ; sha256), puis par la **zone d'attente**
  `attachment_uploads` que seules les RPC métier consomment (`consume_attachment_upload`).
  Le client ne désigne un fichier que par `upload_id` ; chemin, nom, type et empreinte sont
  relus en base. `request_attachments` et `storage.objects` n'ont **aucune policy d'écriture
  cliente** ; la lecture suit la demande du chemin. Les partenaires **déposent** (push,
  `POST /v1/uploads`, contrat 2.0.0) : Iris ne va jamais chercher un fichier chez eux. Pas
  d'antivirus (décision PO 2026-09-08) : la liste fermée est la défense. « Voir » n'est
  proposé que pour PDF et images (`inlineViewable`), tout le reste se télécharge.

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
  - **`attach_request_piece` est la porte unique** : le fichier est REÇU par l'edge function
    `request-attachments` POUR la demande (droit d'instruction vérifié avant de lire le corps,
    type réel vérifié, zone d'attente), puis la RPC reçoit l'`upload_id`, relit tout en base,
    déclare, remplace et journalise — en UNE transaction. Un INSERT client puis un UPDATE
    client laisserait, sur coupure, une pièce neuve à côté d'une ancienne encore active : une
    exigence bloquée inexplicable. (Depuis le 2026-09-08, `request_attachments` n'a d'ailleurs
    plus AUCUNE policy d'écriture cliente.)
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
