# API d'ingestion — guide des systèmes sources

> **Public** : équipes intégrant un émetteur de demandes vers Iris (futur connecteur Clara,
> portail citoyen, partenaire tiers) · **Question traitée** : comment s'authentifier et créer
> des demandes dans Iris, sans rien modifier côté Iris ? · **Dernière mise à jour** : 2026-09-08

Iris expose une **API d'ingestion générique et multi-source** : la même enveloppe, le même
contrat et la même authentification pour toute application autorisée. Il n'existe **aucune
logique spécifique à un émetteur** — Clara, un portail citoyen ou un connecteur métier sont de
simples *sources enregistrées*.

| | |
|---|---|
| URL de base | `https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/requests-api` |
| Contrat (OpenAPI 3.1, **référence exclusive des endpoints**) | `GET {base}/v1/openapi.json` (public) |
| Documentation lisible | `https://<app-iris>/api-doc` — le même contrat rendu par Redoc, consultable **sans compte** (motif `/api-doc` du Socle) |
| Version | `2.0.0` (2026-09-08 : les pièces se **déposent** sur `POST /v1/uploads`, le mode `fetch_url` est retiré) — au sein d'une majeure : **évolutions additives uniquement** ; tolérez les champs de réponse inconnus. Historique : [`api-changelog.md`](api-changelog.md) |
| Erreurs | Enveloppe de gamme `{ "error": { code, message } }`, messages français ; hors périmètre = **404** |

## 1. S'authentifier

### Provisioning (une fois, par un admin plateforme Iris)

1. **Enregistrement de la source** : une ligne `integration_sources` rattachée au **tenant**
   (organisation racine Socle) — `code` (ex. `clara`, `portail-citoyen`, `connecteur-x`),
   nom, statut. Le `code` devient le `source_system` de toutes vos demandes. La **suspension**
   d'une source coupe l'ingestion sans révoquer les clés.
2. **Émission d'une clé** : une ligne `integration_credentials` — secret `irs_…` affiché
   **une seule fois** (SHA-256 en base, jamais en clair), **scopes** (`requests:write`,
   `requests:read`), **expiration obligatoire** (12 mois recommandés), révocable à tout
   moment. Plusieurs clés actives par source → **rotation par double clé** sans coupure.

### Utilisation

`Authorization: Bearer irs_…` sur chaque appel. Règles absolues :

- **Secret serveur uniquement** — jamais dans un navigateur, un bundle, une variable `VITE_*`
  ou un dépôt. (Même règle que les clés Socle dans toute la gamme.)
- **Le périmètre est porté par la clé**, pas par vos en-têtes ni votre payload : la clé est
  liée à une source, elle-même liée à UN tenant. Le `source_system` et le
  `socle_root_organization_id` que vous déclarez sont **vérifiés contre la clé** (403 en cas
  d'écart) — jamais pris pour argent comptant. Une intégration ne peut rien faire hors de son
  périmètre, et ne lit que **ses propres** demandes.

## 2. Créer une demande — `POST /v1/requests` (scope `requests:write`)

```json
{
  "source_system": "portail-citoyen",
  "external_id": "dossier-42",
  "idempotency_key": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "socle_root_organization_id": "<uuid racine Socle>",
  "socle_organization_id": "<uuid organisation destinataire, optionnel>",
  "socle_procedure_id": "<uuid démarche Socle — OBLIGATOIRE>",
  "socle_contact_id": "<uuid contact Socle, optionnel>",
  "subject": "Nid de poule rue des Lilas",
  "body": "Description libre.",
  "requester": { "last_name": "Dupont", "first_name": "Marie", "email": "marie@exemple.fr" },
  "form_data": { "urgence": "haute" },
  "attachments": [
    { "upload_id": "<uuid rendu par POST /v1/uploads>", "form_field_key": "photo_du_probleme" }
  ],
  "context": {
    "channel": "portail",
    "received_at": "2026-08-19T08:00:00Z",
    "external_url": "https://portail.exemple.fr/d/dossier-42"
  },
  "links": [{ "type": "dossier", "id": "dossier-42", "url": "https://portail.exemple.fr/d/dossier-42" }]
}
```

Points de contrat :

- **`socle_procedure_id` est OBLIGATOIRE** (contrat 1.1.0 — règle métier : *Iris ne gère
  aucune demande libre, toute demande est fondée sur une démarche Socle active*). La démarche
  doit être **active et appartenir au tenant de votre clé** — introuvable, obsolète ou hors
  périmètre → **400** explicite. Le **snapshot de la démarche est construit CÔTÉ SERVEUR**
  depuis Socle : vous ne pouvez pas l'imposer (une clé `procedure_snapshot` dans l'enveloppe
  → 400 whitelist). Si Socle est injoignable au dépôt, la demande n'est **pas** refusée :
  snapshot minimal + anomalie `referentiel_indisponible` à lever à la qualification.
- **Identité du demandeur** : `socle_contact_id`, **ou** `requester` (identité déclarée),
  **ou** `requester: { "anonymous": true }` (anonymat assumé). Au moins l'un des trois.
  - **Depuis la 1.2.0, Iris tient le référentiel à jour pour vous** : sans `socle_contact_id`,
    l'identité est rapprochée d'une fiche usager du Socle, et une fiche est **créée** à défaut.
    La demande revient en `identity_status: "rapprochee"`, avec le `socle_contact_id` obtenu.
  - ⚠️ **Envoyez un identifiant fort dès que vous en avez un** (`email`, un téléphone, ou
    `siret`) : c'est la seule chose qui permet de RÉUTILISER une fiche existante. Un nom
    identique ne suffit jamais — aucun agent n'arbitre les homonymes à l'ingestion, et
    rattacher la demande d'un habitant à son homonyme donnerait à l'un accès aux échanges de
    l'autre. Sans identifiant fort, une fiche est créée : c'est-à-dire, peut-être, un doublon.
  - L'identité déclarée reste conservée intégralement comme pièce du dossier, y compris les
    clés que le référentiel ne connaît pas.
  - Socle injoignable ⇒ **jamais un refus** : la demande passe, reste en `non_rapprochee`, et
    porte l'anomalie `usager_a_creer_dans_socle`.
- **`external_id`** = l'identifiant de la demande **chez vous** — l'unité qui devient UNE
  demande Iris (pour un futur connecteur Clara : l'id du *ticket d'action*, jamais celui du
  courrier — un courrier peut engendrer plusieurs demandes).
- **`form_data`** n'est jamais validé à l'ingestion (la complétude est un problème
  d'instruction, pas un motif de rejet). Clé machine des champs = `key` (règle Socle).
- **`attachments[].form_field_key`** (optionnel, ≤ 120 caractères) rattache une pièce au champ
  « pièce justificative » correspondant du `form_schema` de la démarche ; omis = pièce hors
  formulaire.
- **Whitelist stricte** : toute clé inconnue → 400.

### Réponse

`201` à la création, avec tout ce qu'il faut afficher immédiatement à votre utilisateur :

```json
{
  "created": true,
  "request": {
    "id": "<uuid Iris>", "reference": "DEM-2026-000123",
    "status": "a_traiter", "version": 1,
    "url": "https://<app-iris>/demandes/<uuid>", "…": "…"
  },
  "attachments_registered": 1
}
```

`status` appartient à la liste **fermée** `a_traiter · en_instruction · en_attente · annulee ·
resolue_positive · resolue_negative · archivee` — avec `closure_motif`, ce sont les seules
clés stables sur lesquelles coder.

### Idempotence et conflits (comportement garanti, testé)

| Situation | Résultat |
|---|---|
| Rejeu du même `(source_system, external_id)` avec un **contenu identique** | **200** `{ created: false }` + la demande existante — le rejeu sur timeout réseau est le cas nominal, pas une erreur |
| Même `external_id` (ou même `idempotency_key`) avec un **contenu divergent** | **409 conflict** explicite — rien n'est écrasé ; corrigez l'`external_id` ou rejouez à l'identique |
| Deux rejeux simultanés | L'unicité en base tranche, un seul enregistrement, l'autre appel reçoit la demande existante |

L'empreinte de contenu ignore `idempotency_key` et les `upload_id` des pièces : ce qui compte,
c'est le **contenu** des fichiers (nom, type détecté, taille, sha256, clé de champ). Rejouer
avec de nouveaux téléversements des mêmes fichiers est un rejeu identique → 200 — et si un
premier passage a échoué en `502` au rattachement, ce rejeu rattache ce qui manquait.

## 3. Pièces jointes — déposées d'abord, référencées ensuite (contrat 2.0.0)

Le contenu de fichier **n'entre jamais** dans une enveloppe JSON (clé inconnue → 400), et Iris
**ne va jamais chercher un fichier chez vous** : le mode « URL signée » du contrat 1.x, jamais
mis en service, a été retiré (voir [`api-changelog.md`](api-changelog.md)).

1. **Déposez chaque fichier** — `POST /v1/uploads`, `multipart/form-data`, champ `file`, un
   fichier par appel, **25 Mo** maximum, **60 dépôts par minute et par clé** (429 au-delà).
   Iris vérifie le **contenu réel** : signature binaire contre une liste **fermée** (PDF, JPEG,
   PNG, WebP, HEIC, GIF, Word `.docx`, Excel `.xlsx`, OpenDocument `.odt`/`.ods`), extension du
   nom cohérente avec ce contenu (422 sinon), sha256. Jamais de SVG, d'HTML, d'archive, ni de
   document Office à macros (415). La réponse porte `upload_id`, le `mime_type` **détecté**,
   `size_bytes`, `checksum`, et `expires_at` (**24 h**).
   ```
   POST /v1/uploads
   Authorization: Bearer irs_…
   Content-Type: multipart/form-data; boundary=…

   --…
   Content-Disposition: form-data; name="file"; filename="justificatif.pdf"
   Content-Type: application/pdf

   %PDF-1.7 …
   ```
   ```json
   { "upload": { "upload_id": "…", "file_name": "justificatif.pdf", "mime_type": "application/pdf",
                 "size_bytes": 184233, "checksum": "…sha256…", "expires_at": "2026-09-09T10:00:00Z" } }
   ```
2. **Référencez-les** — `attachments: [{ "upload_id", "form_field_key"? }]` dans l'enveloppe,
   ou après coup sur `POST /v1/requests/{id}/attachments`. Le rattachement est **synchrone** :
   à la réponse (`attachments_registered`), les pièces sont dans le dossier, vérifiées, avec
   leur empreinte. Un `upload_id` inconnu, expiré, déposé avec une autre clé ou déjà rattaché
   → 400.

Un fichier déposé et jamais référencé est purgé après 24 h, sans conséquence. Iris **copie, il
ne référence pas** : une fois rattachée, la pièce ne dépend plus de rien chez vous.

## 4. Suivre ses demandes (scope `requests:read`)

- `GET /v1/requests/{id}` — relecture. **404** si la demande n'est pas de votre source ou de
  votre tenant (l'existence n'est jamais révélée).
- `GET /v1/requests?updated_since=<ISO>&limit=<1..500>` — réconciliation périodique (tri
  `updated_at` croissant). Le champ `version` est **monotone** : n'appliquez une mise à jour
  chez vous que si `version` est supérieure à celle déjà connue — cela absorbe rejeux et
  désordre. (Le push d'événements signés viendra en complément — phase 4 du plan.)

## 5. Traçabilité

Chaque appel est journalisé (`integration_api_logs` : clé, méthode, chemin, statut — jamais le
contenu). Chaque demande porte son journal d'événements immuable (`request_events`), vos liens
(`request_links` : plusieurs liens externes par demande — la référence primaire restant
`external_id`), et les échecs de livraison sortants seront visibles dans
`integration_deliveries`.

## 6. Exemples de raccordement (sans rien modifier côté Iris)

- **Futur connecteur Clara** : source `clara` enregistrée sur le tenant, clé
  `requests:write`+`requests:read` en secret d'edge function Clara ; à la création d'une
  action externe, POST de l'enveloppe avec `external_id` = id du ticket d'action, `links` =
  `[{type: "courrier", id: <chrono>, url: <permalien>}]`, pièces par URL signées du bucket
  Clara ; réconciliation quotidienne par `GET ?updated_since=`.
- **Portail citoyen** : source `portail-citoyen`, clé côté serveur du portail ; dépôt à la
  soumission du formulaire avec `requester` déclaré (ou `socle_contact_id` si le compte est
  rapproché) et `form_data`.
- **Partenaire tiers** : source dédiée `connecteur-x`, clé scopée `requests:write` seul si le
  suivi ne passe pas par lui. Un partenaire **n'obtient jamais** de clé Socle : Iris est son
  unique point de contact.

## Vérifications (2026-08-20)

Contrat 1.0.0 prouvé de bout en bout contre la fonction déployée — **18/18 scénarios HTTP** :
authentification (401 absente/révoquée, 403 scope), isolation (usurpation de racine → 403,
usurpation de source → 403, lecture cross-tenant → 404, numérotation indépendante par tenant),
idempotence (rejeu identique → 200 même id), conflit (contenu divergent → 409), pièces (référence
signée → 201 pending, inline → 400), version du contrat (OpenAPI public), 405/404.
Effets vérifiés en base : journal d'audit (dont appels refusés), événements `created`, pièces
`pending`, liens externes, identité déclarée conservée. Données de test intégralement purgées.

Contrat **1.1.0** (règle démarche) prouvé le même jour — **7/7 scénarios HTTP** : enveloppe sans
`socle_procedure_id` → 400 explicite · démarche inconnue du tenant → 400 · `procedure_snapshot`
dans l'enveloppe → 400 whitelist · dépôt valide avec démarche hors Socle (cache en avance) →
201 avec snapshot **dégradé** + anomalie `referentiel_indisponible` + `form_field_key`
persisté · rejeu identique → 200 · rejeu divergent → 409 · dépôt sur démarche Socle **réelle**
→ 201 avec snapshot serveur complet (`form_schema` présent, jamais de `knowledge_base`),
libellés démarche/catégorie issus du cache. Données de test intégralement purgées.
Logique pure couverte par vitest (`_shared/*.test.ts` : validation, empreinte, sérialisation
whitelist, snapshot de démarche, version du contrat).

**Documentation lisible livrée le 2026-08-23** — route publique `/api-doc` de l'app Iris
(Redoc pointé sur le contrat, motif du Socle : la passerelle Supabase interdisant un rendu
HTML depuis une edge function). Le contrat gagne au passage ses groupes d'opérations, ses
exemples d'enveloppe (vérifiés par test : ils passent la validation réelle) et une URL de
serveur en `https` (l'origine vue par la function est en clair). Seules les deux routes de
documentation (`/` et `/v1/openapi.json`) portent des en-têtes CORS ; les routes
authentifiées n'en portent aucun — cette API ne se consomme pas depuis un navigateur.
