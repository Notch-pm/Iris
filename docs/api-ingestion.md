# API d'ingestion — guide des systèmes sources

> **Public** : équipes intégrant un émetteur de demandes vers Iris (futur connecteur Clara,
> portail citoyen, partenaire tiers) · **Question traitée** : comment s'authentifier et créer
> des demandes dans Iris, sans rien modifier côté Iris ? · **Dernière mise à jour** : 2026-09-23

Iris expose une **API d'ingestion générique et multi-source** : la même enveloppe, le même
contrat et la même authentification pour toute application autorisée. Il n'existe **aucune
logique spécifique à un émetteur** — Clara, un portail citoyen ou un connecteur métier sont de
simples *sources enregistrées*.

| | |
|---|---|
| URL de base | `https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/requests-api` |
| Contrat (OpenAPI 3.1, **référence exclusive des endpoints**) | `GET {base}/v1/openapi.json` (public) |
| Documentation lisible | `https://<app-iris>/api-doc` — le même contrat rendu par Redoc, consultable **sans compte** (motif `/api-doc` du Socle) |
| Version | `2.5.0` (2026-09-23 : fil d'une demande `GET /v1/requests/{id}/timeline`, scope `requests:read_tenant`) — précédemment `2.4.0` (2026-09-23 : filtre `socle_contact_id` et scope **`requests:read_tenant`** — les demandes d'un usager, toutes sources) — précédemment `2.3.0` (2026-09-22 : **clé plateforme** et en-tête `X-Socle-Root-Organization-Id`), `2.2.0` (2026-09-20 : **consentements RGPD** facultatifs dans l'enveloppe), `2.1.0` (2026-09-10 : un permalien qui ne résout que sur votre réseau est ignoré ; 2026-09-08 : les pièces se **déposent** sur `POST /v1/uploads`, le mode `fetch_url` est retiré) — au sein d'une majeure : **évolutions additives uniquement** ; tolérez les champs de réponse inconnus. Historique : [`api-changelog.md`](api-changelog.md) |
| Erreurs | Enveloppe de gamme `{ "error": { code, message } }`, messages français ; hors périmètre = **404** |

## 1. S'authentifier

### Provisioning (une fois, par un admin plateforme Iris)

1. **Enregistrement de la source** : une ligne `integration_sources` rattachée au **tenant**
   (organisation racine Socle) — `code` (ex. `clara`, `portail-citoyen`, `connecteur-x`),
   nom, statut. Le `code` devient le `source_system` de toutes vos demandes. La **suspension**
   d'une source coupe l'ingestion sans révoquer les clés.
2. **Émission d'une clé** : une ligne `integration_credentials` — secret `irs_…` affiché
   **une seule fois** (SHA-256 en base, jamais en clair), **scopes** (`requests:write`,
   `requests:read`, `requests:read_tenant` — voir § 4), **expiration obligatoire** (12 mois recommandés), révocable à tout
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

### Clé plateforme — une application de la gamme qui sert toutes les collectivités (2.3.0)

Le modèle « une source, un tenant, une clé » est le bon pour un partenaire tiers : il ne dépose
que chez lui. Il ne l'est pas pour une application de la gamme qui sert **toutes** les
collectivités depuis une seule instance — le portail usagers (Nora), qui parle déjà au Socle
avec une clé plateforme. Constaté le 2026-09-22 : une clé Iris par collectivité, à reposer
toutes ensemble dans un secret d'edge function que personne ne peut relire, n'est pas tenable.

Une **source plateforme** est une ligne `integration_sources` **sans `organization_id`**. Sa clé
authentifie mais ne désigne aucun tenant : **chaque appel nomme la collectivité** par l'en-tête
`X-Socle-Root-Organization-Id` (UUID Socle de la racine) — le symétrique exact de ce qu'Iris
fait lui-même vers le Socle (clé plateforme + `X-Organization-Id`). Iris exige alors que cette
collectivité ait **une source active du même code** : c'est l'interrupteur par collectivité
(suspendre la source coupe le portail pour elle seule), et le journal `integration_api_logs`
reste tenu **par collectivité** — la clé est plateforme, la trace ne l'est pas.

| Situation | Réponse |
|---|---|
| en-tête absent ou mal formé avec une clé plateforme | `400` |
| collectivité inconnue du miroir d'Iris (lancer `sync-socle-referentiel`) | `403` |
| collectivité sans source de ce code, ou source suspendue | `403` |
| en-tête envoyé avec une clé de tenant, et différent de son périmètre | `403` |

Provisioning : une seule ligne `integration_sources` (organisation nulle) et sa clé ; puis, par
collectivité raccordée, une ligne `integration_sources` du même code **sans clé**. Ajouter une
collectivité ne touche plus à aucun secret.

```sql
insert into integration_sources (organization_id, code, name, status)
values (null, 'portail-citoyen', 'Portail usagers (Nora) — plateforme', 'active');
-- puis la clé, comme pour toute source (integration_credentials, SHA-256 du clair)
```

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
  "consents": [
    { "kind": "traitement", "granted": true },
    { "kind": "partage", "granted": false }
  ],
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
  - Pour **créer** une personne, un nom suffit : nom de naissance (`nom_naissance`,
    `last_name`…) **ou** nom d'usage seul (`nom_usuel`, `usage_name`) ; le Socle exige en
    outre la civilité. Une structure demande sa raison sociale.
  - Socle injoignable, fiche refusée par le Socle, ou identité impossible à rattacher (un
    prénom seul, un courriel sans nom et sans fiche existante) ⇒ **jamais un refus** : la
    demande passe, reste en `non_rapprochee`, et porte l'anomalie `usager_a_creer_dans_socle`.
- **`context.external_url` et `links[].url` doivent être PUBLICS** (contrat 2.1.0). Iris rend
  ces adresses cliquables dans la fiche de la demande, sous les yeux d'un agent. Une adresse
  qui ne résout que sur votre réseau — `localhost`, `127.0.0.1`, `::1`, plages privées
  (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`), TLD réservés (`.local`, `.internal`,
  `.intranet`, `.home.arpa`) ou hôte sans point — est **ignorée** : la demande passe, sans ce
  permalien, et porte l'anomalie `permalien_non_public`. Le lien lui-même survit (`type`,
  `id`, `label`), seulement privé de son URL. Iris ne réécrit jamais votre adresse : il ne
  sait pas où vous vivez. ⚠️ **Le coupable est presque toujours la variable d'environnement
  d'où vous tirez votre origine publique**, pas votre code — un `http://localhost:8080/…`
  poussé depuis un poste de développement désigne, une fois cliqué, la machine de l'agent.
- **`consents` — les deux consentements RGPD de l'usager** (contrat 2.2.0). Ils sont posés
  systématiquement, quelle que soit la démarche, et ne font **pas** partie de `form_data` :

  | `kind` | Ce que l'usager accepte | Régime |
  |---|---|---|
  | `traitement` | Que les informations fournies servent à instruire sa demande | **Obligatoire** — un dépôt ne se valide pas sans lui |
  | `partage` | Que ces informations soient partagées aux services de la collectivité, pour cette demande et les suivantes | Facultatif, à proposer **coché** |

  - **N'envoyez que `kind` et `granted`.** La phrase exacte consignée est recomposée par Iris
    depuis le nom de l'organisme principal ; un `statement` fourni est **refusé** (400). C'est
    ce qui garantit que ce qui est archivé est bien ce qui a été lu.
  - **Un `kind` du catalogue omis vaut REFUS.** L'absence de case cochée n'est jamais un
    consentement. `traitement` présent avec `granted: false` → 400.
  - **Facultatif, et ça le restera** : une enveloppe sans `consents` est acceptée (le contrat
    2.x n'évolue qu'en additif — l'exiger casserait toutes les intégrations en place). La
    demande porte alors l'anomalie **`consentement_absent`** : l'agent voit que la question
    n'a pas été posée, plutôt que de le supposer.
  - **Ils entrent dans l'empreinte d'idempotence** : rejouer un dépôt en ayant changé une
    réponse est un **409**, pas un 200 silencieux.
  - Quand l'usager est rapproché d'une fiche, ils sont **aussi consignés au référentiel
    Socle**, sous VOTRE code d'émetteur (`source_app`) et avec votre `external_id` comme
    référence — c'est vous qui avez affiché la case. L'échec de cette écriture ne refuse
    jamais la demande : anomalie `consentement_non_transmis_au_socle`.
- **`external_id`** = l'identifiant de la demande **chez vous** — l'unité qui devient UNE
  demande Iris (pour un futur connecteur Clara : l'id du *ticket d'action*, jamais celui du
  courrier — un courrier peut engendrer plusieurs demandes).
- **`form_data`** n'est jamais validé à l'ingestion (la complétude est un problème
  d'instruction, pas un motif de rejet). Clé machine des champs = `key` (règle Socle). Un champ
  de type `location` (lieu d'intervention, Socle 1.29.0) attend l'objet du Socle
  `{ address, lat, lon, precision, adjusted }` : Iris le stocke tel quel et situe la demande
  par ce point sans le géocoder ; une chaîne nue y est lue comme une adresse sans point.
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

### Refus d'une garde métier — `400` avec la raison

Une demande peut être refusée par une **garde serveur** d'Iris après validation de l'enveloppe :
le cas rencontré le 2026-09-08 est une **démarche non activée pour l'organisme** transmis
(`socle_organization_id`, ou la racine du tenant si vous n'en transmettez pas — miroir
`Socle.organization_procedures`, opt-in strict). La réponse est un `400 bad_request` dont le
message est celui de la garde (« Cette démarche n'est pas activée pour cet organisme dans le
référentiel Socle. ») — pas une panne, rien à rejouer : c'est le couple (démarche, organisme)
qu'il faut corriger, ou l'activation dans le Socle. Les pièces déjà déposées restent en attente
24 h et peuvent être référencées par un nouvel envoi corrigé.

## 4. Suivre ses demandes (scope `requests:read`)

- `GET /v1/requests/{id}` — relecture. **404** si la demande n'est pas de votre source ou de
  votre tenant (l'existence n'est jamais révélée).
- `GET /v1/requests?updated_since=<ISO>&limit=<1..500>` — réconciliation périodique (tri
  `updated_at` croissant). Le champ `version` est **monotone** : n'appliquez une mise à jour
  chez vous que si `version` est supérieure à celle déjà connue — cela absorbe rejeux et
  désordre. (Le push d'événements signés viendra en complément — phase 4 du plan.)
- `GET /v1/requests?socle_contact_id=<UUID Socle>` — **les demandes d'un usager** (2.4.0).
  Avec `requests:read` seul, limitées à votre source. Avec **`requests:read_tenant`** en plus,
  **toutes sources du tenant** : c'est la vue usager d'une application de la gamme (Clara :
  fiche contact, espace élu), qui doit montrer aussi ce qui est arrivé par le portail ou le
  guichet. Le scope ne vaut **que si un usager est nommé** — sans `socle_contact_id`, la liste
  reste celle de votre source : pas d'aspiration du tenant. Même liste blanche de champs
  (ni notes internes, ni `form_data`) ; `GET /v1/requests/{id}` reste limité à votre source.
  Un scope réservé aux applications de la gamme : un partenaire tiers ne le reçoit pas.
- `GET /v1/requests/{id}/timeline` — **le fil d'une demande** (2.5.0), scopes `requests:read`
  **et** `requests:read_tenant`. Toutes sources du tenant. Rend le texte de la demande
  (`body`), l'activité, les **notes internes** et les interventions, par une liste blanche
  dédiée (`_shared/timeline.ts`) : détails d'événements filtrés par type, personnes **nommées**
  (jamais d'e-mail ni d'identifiant d'agent). Premier consommateur : Clara (détail d'une
  demande depuis la fiche usager et l'espace élu). Les notes internes ne sortent **que** par
  cette route, donc que vers une application de la gamme : un partenaire reçoit 403.

## 5. Traçabilité

Chaque appel est journalisé (`integration_api_logs` : clé, méthode, chemin, statut — jamais le
contenu). Chaque demande porte son journal d'événements immuable (`request_events`), vos liens
(`request_links` : plusieurs liens externes par demande — la référence primaire restant
`external_id`), et les échecs de livraison sortants seront visibles dans
`integration_deliveries`.

## 6. Exemples de raccordement (sans rien modifier côté Iris)

- **Connecteur Clara** (livré côté Clara le 2026-08-23) : source `clara` enregistrée sur le
  tenant, clé `requests:write`+`requests:read` en secret d'edge function Clara ; à la
  création d'une action externe, POST de l'enveloppe avec `external_id` = id du ticket
  d'action, `links` = `[{type: "courrier", id: <chrono>, url: <permalien>}]` ;
  réconciliation par `GET ?updated_since=`. ⚠️ **Les pièces du courrier ne sont pas encore
  transmises** (constat du 2026-09-19, DEM-2026-000055) : le connecteur est antérieur au
  contrat 2.0.0 et ne dépose rien sur `POST /v1/uploads`. La suite attendue côté Clara est le
  parcours du § 3 — un dépôt par fichier, puis `attachments: [{ upload_id }]` dans
  l'enveloppe. Le mode « URL signée du bucket Clara » de la première version de ce guide n'a
  jamais été mis en service.
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
