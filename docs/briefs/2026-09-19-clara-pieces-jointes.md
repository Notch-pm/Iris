# Brief Clara — transmettre les pièces du courrier à Iris

> **Pour** : l'agent qui travaille dans le dépôt Clara (`clara-mailflow-hub`).
> **De** : Iris, 2026-09-19. **Demandeur** : PO.
> **Symptôme** : DEM-2026-000055 (Iris), créée depuis un courrier Clara qui portait une
> pièce jointe, est arrivée **sans aucune pièce**.

## 1. Le constat, vérifié en base Iris

- `request_attachments` : 0 ligne pour la demande ; `anomalies` vide ; un seul événement
  `created`.
- `integration_api_logs` à la minute du dépôt : **un seul appel** de Clara, `POST /v1/requests`
  → 201. Aucun `POST /v1/uploads`, aucun `POST /v1/requests/{id}/attachments`, rien en zone
  d'attente (`attachment_uploads`).
- Côté Clara, `supabase/functions/push-iris-request/index.ts` construit l'enveloppe
  (`_shared/iris-envelope.ts`) et la poste (`_shared/iris.ts`, `postIrisRequest`). **Aucune
  mention des documents du courrier** dans ce chemin : le connecteur (livré le 2026-08-23) est
  antérieur au contrat 2.0.0 d'Iris (2026-09-08), qui a imposé le **dépôt** des pièces.

Rien n'est perdu côté Iris : le fichier n'a jamais quitté Clara.

## 2. Ce qu'Iris attend — contrat 2.1.0, guide `docs/api-ingestion.md` § 3

Iris **ne va jamais chercher un fichier chez un partenaire** (décision d'architecture, aucune
URL signée n'est acceptée). Deux temps :

1. **Déposer chaque fichier** : `POST {api_base_url}/v1/uploads`, `multipart/form-data`, champ
   `file`, **un fichier par appel**, même clé `Bearer irs_…` que pour les demandes
   (scope `requests:write`).
   - Limites : **25 Mo** par fichier, **60 dépôts / minute / clé** (429 au-delà).
   - Iris lit le **contenu réel** : liste fermée — PDF, JPEG, PNG, WebP, HEIC, GIF, `.docx`,
     `.xlsx`, `.odt`, `.ods`. Refus **415** pour SVG, HTML, archives, Office à macros ;
     **422** si l'extension du nom ne correspond pas au contenu détecté.
   - Réponse : `{ "upload": { "upload_id", "file_name", "mime_type", "size_bytes",
     "checksum", "expires_at" } }` — `expires_at` = **24 h** ; un dépôt jamais référencé est
     purgé sans conséquence.
2. **Référencer** les `upload_id` :
   - soit dans l'enveloppe de `POST /v1/requests` : `"attachments": [{ "upload_id": "…" }]`
     (`form_field_key` facultatif : inutile pour un courrier, la pièce est « hors champ ») ;
   - soit **après coup** sur `POST /v1/requests/{id}/attachments` avec le même tableau — le
     chemin à utiliser pour les demandes **déjà déposées** sans pièces, dont DEM-2026-000055.
   Le rattachement est **synchrone** : la réponse porte `attachments_registered`. Un
   `upload_id` inconnu, expiré, déposé avec une autre clé ou déjà rattaché → **400**.

L'empreinte d'idempotence d'Iris **ignore** les `upload_id` : rejouer la même enveloppe avec
des pièces en plus ne provoque pas de 409.

## 3. Où ça se branche côté Clara (repères, à confirmer dans le code)

- **Source des fichiers** : table `courier_documents` (`storage_key`, `file_name`,
  `mime_type`, `file_size`, `document_type`), bucket **`clara-documents`** (c'est là que
  `fetch-inbound-emails` dépose les pièces d'un courriel entrant). Lire les octets avec le
  client `service_role` déjà présent dans `push-iris-request` (`supabaseAdmin`).
- **Client Iris** : `_shared/iris.ts` — `callIris` pose `Content-Type: application/json` dès
  qu'il y a un corps ; le dépôt multipart doit **ne pas** le poser (laisser `fetch` fixer le
  `boundary`). Ajouter un `uploadIrisFile(integration, { bytes, fileName, mimeType })` qui
  construit un `FormData` avec un `Blob`, et laisser `postIrisRequest` tel quel.
- **Enveloppe** : `_shared/iris-envelope.ts` — ajouter `attachments?: { upload_id: string;
  form_field_key?: string }[]` au type `IrisEnvelope` et au `buildIrisEnvelope`.
- **Orchestration** dans `push-iris-request` : déposer les fichiers **avant** l'enveloppe,
  collecter les `upload_id`, les glisser dans `attachments`, poster. Pour un ticket qui a
  déjà un `iris_request_id`, passer par `POST /v1/requests/{id}/attachments`.

## 4. Décisions à prendre (proposer un défaut, laisser le PO trancher)

- **Quels documents ?** Tous les `courier_documents` du courrier, ou seulement certains
  `document_type` (le scan du courrier papier compte-t-il comme une pièce ?). Défaut proposé :
  **tous**, sauf ce qui est manifestement une production interne de Clara.
- **Refus d'un fichier par Iris** (415/422/25 Mo) : déposer quand même la demande **sans
  cette pièce** et le dire sur le ticket (`iris_last_error` ou un champ dédié), plutôt que de
  bloquer le dépôt. Un fichier refusé n'est pas une panne — c'est un type qu'Iris n'admet pas.
- **Panne réseau sur un upload** : l'idempotence d'Iris rend le renvoi sûr ; garder le motif
  actuel « geste explicite (bouton Renvoyer), pas de boucle aveugle ».
- **Rattrapage** des demandes déjà déposées sans pièces (au moins DEM-2026-000055) : un
  bouton « Renvoyer les pièces » sur le ticket, ou un rattrapage unique par script.

## 5. Vérification attendue

- Un courrier avec un PDF et une image → demande Iris avec **2 pièces** dans l'onglet
  Documents (nature `demande`, « hors champ »), empreintes présentes, `attachments_registered:
  2` dans la réponse.
- Un fichier hors liste (ex. `.zip`) → demande créée, pièce absente, refus **visible** sur le
  ticket Clara.
- Journal Iris `integration_api_logs` : un `POST /v1/uploads` par fichier, puis le
  `POST /v1/requests`.
- Le guide complet et le schéma OpenAPI : `docs/api-ingestion.md` (Iris) et
  `GET {api_base_url}/v1/openapi.json`, rendu lisible sur `/api-doc` de l'application Iris.
