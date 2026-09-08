# Journal du contrat d'ingestion (`requests-api`)

Public : **les équipes qui émettent vers Iris**. Une entrée par version publiée du contrat
OpenAPI (`/v1/openapi.json`, rendu humain sur `/api-doc`).

Ce document est **append-only** : on ajoute en tête, on ne réécrit jamais une entrée publiée.
La politique v1 reste celle annoncée dans le contrat — **évolutions additives uniquement**, et
les consommateurs doivent tolérer les champs de réponse inconnus.

---

## 2.0.0 — 2026-09-08 — les pièces jointes se DÉPOSENT, Iris ne va plus les chercher

**Rupture — mais sur un mode qui n'a jamais été mis en service.** Le contrat 1.x décrivait des
pièces « par URL signée » (`fetch_url`) qu'un worker viendrait copier ; ce worker n'a jamais
existé, et le contrat lui-même disait « n'envoyez pas encore de pièces en production ». Si
vous n'envoyiez pas de pièces, **rien ne change pour vous** : l'enveloppe, les routes (toujours
sous `/v1`), l'idempotence et les réponses sont inchangées.

### Ce qui change

- **Nouvelle route `POST /v1/uploads`** (scope `requests:write`) : un fichier par appel, en
  `multipart/form-data` (champ `file`), 25 Mo maximum, 60 dépôts par minute et par clé. Iris
  vérifie le **contenu réel** du fichier (signature binaire contre une liste fermée : PDF, JPEG,
  PNG, WebP, HEIC, GIF, Word `.docx`, Excel `.xlsx`, OpenDocument `.odt`/`.ods` — jamais de
  SVG, d'HTML, d'archive ni de document à macros), exige une extension cohérente, calcule le
  sha256, et rend un `upload_id` valable **24 heures**. Le `mime_type` rendu est celui
  **détecté**, pas celui que vous annonciez.
- **`AttachmentRef` devient `{ upload_id, form_field_key? }`.** `file_name`, `mime_type`,
  `size_bytes`, `checksum` et `fetch_url` ne sont plus acceptés (400 avec un message qui
  renvoie vers `/v1/uploads`) : Iris tient ces valeurs de sa propre vérification.
- **Le rattachement est synchrone.** La réponse de `POST /v1/requests` porte
  `attachments_registered` (le nombre de pièces réellement au dossier) à la place
  d'`attachments_pending`. Plus aucun état `copy_status: pending`.
- **Nouveaux refus** : `413 payload_too_large`, `415 unsupported_media_type`,
  `422 unprocessable` (extension incohérente avec le contenu), `429 too_many_requests`,
  `502 bad_gateway` (stockage indisponible).

### Ce que ça implique pour vous

- Déposez les fichiers **avant** l'enveloppe, gardez les `upload_id`, référencez-les. Un
  fichier jamais référencé est purgé sans conséquence au bout de 24 h.
- **L'idempotence ignore les `upload_id`** : elle porte sur le contenu des fichiers (nom, type
  détecté, taille, sha256, clé de champ). Rejouer une enveloppe avec de **nouveaux**
  téléversements des mêmes fichiers est un rejeu identique → `200`. Un rejeu à l'identique
  après un `502` rattache les pièces qui manquaient.
- Un `upload_id` inconnu, expiré, déposé avec une autre clé ou déjà rattaché → `400`.

Détail : `docs/api-ingestion.md` § 3 et le contrat OpenAPI.

---

## 1.2.0 — 2026-08-26 — l'usager déclaré entre dans le référentiel

**Additif. Aucune enveloppe valide en 1.1.0 ne devient invalide.** Rien à changer chez vous ;
la lecture ci-dessous explique seulement ce qui change dans les demandes que vous recevez en
retour.

### Ce qui change

Jusqu'ici, une enveloppe portant une identité (`requester`) sans `socle_contact_id` produisait
une demande en `identity_status: "non_rapprochee"` : l'usager restait inconnu du référentiel,
et la demande n'était rattachable à rien.

Désormais, Iris **rapproche cette identité d'une fiche usager du Socle, et en crée une à
défaut** (décision PO du 2026-08-26 : sans correspondance, c'est une nouvelle personne). La
demande revient alors avec `identity_status: "rapprochee"` et le `socle_contact_id` obtenu.

### Ce que ça implique pour vous

- **Envoyez un identifiant fort dès que vous en avez un** — `email`, un téléphone, ou `siret`.
  La réutilisation d'une fiche existante n'a lieu que sur l'un d'eux. Un nom identique ne
  suffit **jamais** : aucun agent n'arbitre les homonymes à l'ingestion, et rattacher la
  demande d'un habitant à son homonyme donnerait à l'un accès aux échanges de l'autre. Sans
  identifiant fort, une nouvelle fiche est créée — c'est-à-dire, potentiellement, un doublon.
- `identity_status` que vous receviez à `non_rapprochee` passera le plus souvent à
  `rapprochee`, et `socle_contact_id` sera renseigné là où il était `null`. Si vous stockez
  ces champs, attendez-vous à ce changement.
- **Le Socle injoignable ne fait jamais échouer une ingestion** (même doctrine que le snapshot
  de démarche) : la demande est acceptée, reste en `non_rapprochee`, et porte l'anomalie
  `usager_a_creer_dans_socle` — à régulariser côté Iris.
- Un dépôt anonyme (`requester: { "anonymous": true }`) est inchangé : c'est un choix assumé,
  pas une identité incomplète. Une identité que rien ne nomme (un courriel seul, par exemple)
  ne crée pas de fiche non plus.
- Les clés d'identité acceptées sont désormais **documentées et plus larges** (plusieurs
  écritures par champ — `last_name`/`nom_naissance`/`nom`…). Les clés inconnues restent
  conservées telles quelles dans le dossier, et ne sont pas envoyées au référentiel.

Détail des champs : `requester` dans le contrat OpenAPI.

---

## 1.1.0 — 2026-08-20 — la démarche devient obligatoire

`socle_procedure_id` est **requis** : Iris ne gère aucune demande libre (règle impérative PO du
2026-08-20). Une démarche introuvable, obsolète ou hors du périmètre du tenant est refusée en
400. Le `procedure_snapshot` est construit **côté serveur** depuis le Socle — un émetteur ne
peut jamais l'imposer ; si le Socle est injoignable, un snapshot minimal du cache est posé avec
l'anomalie `referentiel_indisponible`, jamais un refus.

## 1.0.0 — première publication

Ingestion générique serveur-à-serveur : authentification par clé d'intégration, périmètre
dérivé de la clé, idempotence par `(source, external_id)` et `idempotency_key` (rejeu identique
→ 200, divergent → 409), pièces jointes par URL signée.
