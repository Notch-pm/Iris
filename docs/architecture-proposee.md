# Architecture proposée — Iris

> **Statut : PROPOSITION — en attente de validation. Aucun projet, aucune migration, aucun code créé.**
> Cadrage du 2026-08-20, produit par l'équipe (analyse métier, architecture, base de données,
> sécurité), **révisé le 2026-08-20 après retours PO** : workflow **fixe** (non paramétrable au
> MVP), organisations **façon Clara** (tout vient du Socle, visibilité limitée au sous-arbre),
> clarification du vocabulaire (« catégorie » désigne exclusivement les catégories de démarches
> du Socle).
> Sources : documentation Socle (`CLAUDE.md`, `docs/architecture.md`, `docs/data-model.md`,
> `docs/integration.md`) et Clara (`docs/product-user-flows.md`, `docs/data-model.md`,
> `docs/partenaires-integration.md`, `docs/garde-transitions-workflow.md`, `docs/security.md`,
> `docs/database-rls.md`, `docs/edge-functions.md`), plus vérification du code Clara
> (`courier_links`, `action_tickets`) là où le contrat en dépend.

## 0. Positionnement et principes

**Iris est le système transactionnel des demandes d'usagers** de la gamme Edilumen. Une demande
est créée dans Iris par un agent, ou ingérée depuis Clara (action externe issue d'un courrier) ou
depuis une application partenaire, puis qualifiée, instruite et close, avec une traçabilité
opposable. Iris répond à « où en est cette demande, qui en est responsable, quand sera-t-elle
traitée ? », là où Clara répond à « où en est ce courrier ? ».

Principes non négociables :

1. **Socle** reste propriétaire des organisations, démarches, catégories (de démarches), types
   de pièces, quartiers et contacts/usagers. **Clara** reste propriétaire des courriers.
   **Iris** est propriétaire exclusif des demandes, de leur statut et de leurs pièces.
2. **Pas de miroir complet des données Socle** : Iris ne réplique que ce que Clara réplique déjà
   pour les mêmes raisons — la **hiérarchie d'organisations** (miroir léger synchronisé, motif
   `socle_organizations` de Clara) — plus un snapshot figé par demande et un cache léger des
   démarches (§7).
3. **Jamais de clé Socle (ni d'aucun projet) dans le navigateur** : toutes les clés
   inter-projets vivent en secrets d'edge functions, jamais en `VITE_*` (§8).
4. **Aucune clé étrangère ne franchit une frontière de projet** : toute référence croisée est un
   UUID nu + discriminant textuel, sans FK, sans cascade. **Aucun flux base-à-base** : les trois
   projets Supabase ne se parlent que par HTTP.
5. Même stack que la gamme : projet Supabase distinct, Vite + React + TypeScript, TanStack
   Query, RLS Postgres comme unique frontière de sécurité de l'UI, design system Notch/Ariane,
   textes en français, OpenAPI + Redoc + `api-changelog.md` append-only dès le jour 1.

### Vocabulaire (pour lever toute ambiguïté)

| Terme | Sens dans ce document |
|---|---|
| **Catégorie** | Uniquement le sens Socle : **groupement de démarches** (`categories` du Socle). Snapshotée en libellé sur la demande (`category_label`). Jamais autre chose. |
| **Statut** | Position d'une demande dans son cycle de vie — **liste fixe de 7 valeurs**, produit Iris, non paramétrable au MVP (§3). |
| **Organisation** | Toujours une organisation **Socle** (racine = client/tenant, sous-organisations = services). Iris n'a aucune organisation en propre. |

---

## 1. Modèle de données Iris minimal

### 1.1 Multi-tenancy et organisations — façon Clara

- **Tenant Iris = organisation racine Socle** (les racines sont les clients, comme Clara).
  Table locale `organizations` mappée 1-1 par `socle_org_id` — nécessaire parce qu'Iris a son
  propre `auth.users` et qu'il faut un point d'ancrage local pour le RLS.
- **La hiérarchie vient du Socle** : miroir léger `socle_organizations` (sous-arbre du
  `socle_org_id` mappé, racine incluse), synchronisé par cron nocturne + rafraîchissement
  manuel — exactement le motif Clara. Les champs Socle sont réécrasés par la sync ; Iris pourra
  y attacher plus tard ses propres colonnes de configuration (délais cibles, affectations par
  défaut) sans jamais recopier davantage de champs Socle.
- **Unité de traitement** d'une demande = un nœud de ce sous-arbre :
  `demandes.socle_organization_id` est une **FK vers la ligne miroir locale** (comme
  `couriers.socle_organization_id` chez Clara). Les API externes, elles, parlent toujours en
  **UUID Socle** (`socle_organizations.socle_id`) — la traduction se fait à l'ingestion.
- **Visibilité par sous-arbre** : un utilisateur est affecté à une ou plusieurs organisations du
  miroir (`socle_organization_members`, motif Clara) et **ne voit que les demandes de ces
  organisations et de leur descendance**. Un administrateur ne voit que son arbre ; l'admin
  affecté à la racine voit tout le tenant. Différence assumée avec Clara : Clara applique ce
  filtre côté application (`useUserServiceFilter`), Iris étant un projet neuf le porte **dans le
  RLS** (§4), conformément à la doctrine de la gamme (les droits ne sont jamais appliqués côté
  client).

### 1.2 Tables (DDL indicatif, pas une migration)

**Identité et tenants**

```sql
organizations (
  id uuid PK, socle_org_id uuid NOT NULL UNIQUE,   -- racine Socle, sans FK
  name text NOT NULL,                               -- snapshot, réécrasé par la sync
  status text CHECK (status IN ('active','obsolete')) DEFAULT 'active',
  created_at, updated_at
)

users (
  id uuid PK,                    -- = auth.users.id (trigger handle_new_user)
  email text NOT NULL UNIQUE, first_name, last_name,
  is_platform_admin boolean NOT NULL DEFAULT false, -- trigger anti-escalade
  created_at
)

organization_members (           -- appartenance au TENANT + rôle fonctionnel
  organization_id uuid NOT NULL FK, user_id uuid NOT NULL FK,
  role text NOT NULL CHECK (role IN ('admin','superviseur','agent','lecteur')),
  PRIMARY KEY (organization_id, user_id)
)
```

**Miroir des organisations Socle** (motif Clara `socle_organizations` / `socle_organization_members`)

```sql
socle_organizations (
  id uuid PK,                          -- PK locale (cible des FK internes Iris)
  organization_id uuid NOT NULL FK,    -- tenant
  socle_id uuid NOT NULL,              -- UUID Socle (clé d'idempotence de la sync)
  socle_parent_id uuid,                -- hiérarchie logique socle→socle, sans FK
                                       -- (racine du tenant : neutralisé à NULL, motif Clara)
  name text NOT NULL, status text,     -- statut Socle active|obsolete
  synced_at timestamptz, obsoleted_at timestamptz,  -- disparue du périmètre = soft-delete
  UNIQUE (organization_id, socle_id)
)
-- Écriture : service_role uniquement (edge sync-socle-referentiel). Lecture : membres du tenant.

socle_organization_members (         -- périmètre de visibilité d'un utilisateur
  socle_organization_id uuid NOT NULL FK → socle_organizations(id),
  user_id uuid NOT NULL FK → users(id),
  UNIQUE (socle_organization_id, user_id)
)
-- Un utilisateur voit les demandes de ses organisations affectées ET de leur descendance.
-- Géré par les admins, dans la limite de leur propre sous-arbre.
```

Correction volontaire vs Socle : colonnes `NOT NULL` + contraintes composites partout (les
colonnes nullables de `user_organizations` sont un point de vigilance documenté par Socle).

**Cœur métier**

```sql
demande_sequences (organization_id FK, year int, last_value int,
                   PRIMARY KEY (organization_id, year))

demandes (
  id uuid PK,                                  -- UUID v4, jamais séquentiel (anti-énumération)
  organization_id uuid NOT NULL FK ON DELETE RESTRICT,  -- jamais CASCADE : pièce administrative

  -- numéro lisible, posé par trigger BEFORE INSERT (§1.4)
  numero text NOT NULL,                        -- 'DEM-2026-000123'
  numero_annee int, numero_ordre int, UNIQUE (organization_id, numero_annee, numero_ordre),

  -- unité de traitement : FK vers le miroir local (motif Clara couriers.socle_organization_id)
  socle_organization_id uuid NOT NULL FK → socle_organizations(id),
  socle_organization_label text NOT NULL,      -- libellé figé à la création

  -- démarche Socle : nullable (demande libre ou à qualifier)
  socle_procedure_id uuid,                     -- UUID Socle, sans FK
  socle_procedure_label text,
  category_label text,                         -- catégorie de démarche Socle, libellé figé
  procedure_snapshot jsonb,                    -- form_schema + requester_config FIGÉS (§7.A)

  -- demandeur : trois blocs distincts (§7.A)
  socle_contact_id uuid,                       -- référence Socle, sans FK
  contact_snapshot jsonb,                      -- MINIMAL : display_name + canal retenu (+ commune)
  requester_declared jsonb,                    -- identité DÉCLARÉE par la source, intégrale (pièce du dossier)
  identity_status text NOT NULL CHECK (identity_status IN
    ('rapprochee','non_rapprochee','anonyme')) DEFAULT 'non_rapprochee',

  -- origine
  source text NOT NULL,                        -- registre FERMÉ : 'iris','clara','arpege','portail',…
  external_ref text,                           -- id côté source ; NULL si née dans Iris
  external_url text,                           -- permalien vers la ressource d'origine (courrier)
  received_at timestamptz NOT NULL,            -- date de réception D'ORIGINE — ne change JAMAIS
  channel text,                                -- courrier, email, portail, guichet, téléphone…

  -- instruction — STATUT FIXE (§3), pas de tables de workflow au MVP
  subject text NOT NULL, body text,
  form_data jsonb NOT NULL DEFAULT '{}',       -- réponses au form_schema snapshoté (clé machine = key)
  status text NOT NULL CHECK (status IN
    ('a_traiter','en_instruction','en_attente','annulee',
     'resolue_positive','resolue_negative','archivee')) DEFAULT 'a_traiter',
  closure_motif text CHECK (closure_motif IN
    ('irrecevable','abandon','retrait_usager','doublon','reorientation')),  -- optionnel
  closure_text text,                           -- texte de clôture DESTINÉ À L'USAGER
  master_demande_id uuid FK,                   -- obligatoire si closure_motif = 'doublon'
  priority text CHECK (priority IN ('basse','normale','haute','urgente')) DEFAULT 'normale',
  assigned_to uuid FK users ON DELETE SET NULL,
  anomalies jsonb NOT NULL DEFAULT '[]',       -- 'demarche_inactive', 'dossier_incomplet',
                                               -- 'referentiel_indisponible', 'a_requalifier'…
  attachments_status text CHECK (... IN ('none','pending','complete','partial')),
  version int NOT NULL DEFAULT 1,              -- monotone, incrémenté à chaque écriture — idempotence webhook (§6)

  due_at timestamptz, closed_at timestamptz,
  retention_until timestamptz, purged_at timestamptz,   -- RGPD dès la 1re migration (§8)
  created_at, updated_at
)

-- Idempotence d'ingestion (§5)
UNIQUE INDEX (organization_id, source, external_ref) WHERE external_ref IS NOT NULL
-- Index de travail : (org, status), (org, socle_organization_id), (org, socle_procedure_id),
-- (org, created_at DESC), (org, assigned_to)
```

Triggers sur `demandes` (tous `SECURITY DEFINER`, `EXECUTE` révoqué de `anon`/`authenticated`) :

- `demandes_prevent_immutable_change` — bloque toute modification de `numero`,
  `organization_id`, `source`, `external_ref`, `received_at`, `created_at` après insertion
  (motif Clara `action_tickets_prevent_courier_change`).
- `demandes_enforce_transition` — la **garde serveur** du cycle de vie (§3.3) : `status` ne
  change que selon la matrice fixe ; `closure_text` et cohérence du `closure_motif` vérifiés en
  clôture ; pose `closed_at` ; incrémente `version` ; insère la ligne `demande_events`. Bypass
  explicite et tracé pour le `service_role` (ingestion, péremption automatique, reprise) — la
  leçon Clara (`garde-transitions-workflow.md`) : une garde uniquement UI ne protège rien, et
  une garde sans contournement système bloque ses propres automatismes.
- `set_demande_numero` — numérotation chrono (§1.4).

**Journal, pièces, notes**

```sql
demande_events (   -- journal d'audit IMMUABLE
  id uuid PK, demande_id FK ON DELETE CASCADE,
  organization_id uuid NOT NULL,             -- dénormalisé pour la RLS
  socle_organization_id uuid NOT NULL,       -- dénormalisé pour la visibilité sous-arbre
  event_type text NOT NULL,                  -- varchar libre par conception (motif courier_events) :
                                             -- 'ingested','status_changed','assigned','transferred',
                                             -- 'note_added','document_added','identity_matched','split','merged'…
  payload jsonb, created_by uuid FK,         -- NULL = système ; les écritures d'intégration
                                             -- sont attribuées à la SOURCE, jamais à un agent
  created_at
)  -- écrit UNIQUEMENT par triggers SECURITY DEFINER + service_role ; aucune policy INSERT client

demande_documents (
  id uuid PK, demande_id FK, organization_id uuid NOT NULL,
  socle_organization_id uuid NOT NULL,       -- dénormalisé (visibilité sous-arbre)
  storage_path text NOT NULL,                -- '{organization_id}/{demande_id}/{uuid}-{slug}'
  file_name, mime_type, file_size bigint, checksum text,
  document_type_socle_id uuid, document_type_label text,   -- référence + libellé figé
  copy_status text CHECK (... IN ('copied','pending','error')),  -- copie asynchrone (§5)
  uploaded_by uuid FK,                       -- NULL = ingestion
  created_at
)

demande_notes (id, demande_id FK, organization_id, socle_organization_id, author_id FK,
               body text NOT NULL, created_at, updated_at)
-- UPDATE/DELETE : auteur ou admin seulement (durcissement volontaire vs Clara).
-- Les notes ne quittent JAMAIS Iris (miroir de la règle internal_notes du Socle).
```

**Intégrations (surface serveur d'Iris)**

```sql
api_keys (             -- clés des CONSOMMATEURS d'Iris (Clara, partenaires) — motif Socle amélioré
  id uuid PK, organization_id uuid FK,       -- NULL = clé plateforme (Clara)
  name, key_prefix, key_hash text,           -- SHA-256, jamais en clair
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['demandes:read','demandes:write']),  -- CHECK dès le départ
  expires_at timestamptz NOT NULL,           -- systématique, 12 mois
  revoked_at, last_used_at, created_by, created_at
)

api_request_log (      -- journal d'appels par clé (append-only) — capacité de forensic absente chez Socle
  id, api_key_id, organization_id, method, path, status, created_at
)  -- jamais le contenu des payloads

attachment_jobs (      -- file de copie des PJ (motif courier_analysis_jobs)
  id, organization_id, demande_document_id FK, fetch_url text, status, attempts, last_error,
  scheduled_at, started_at, finished_at
)  -- index UNIQUE partiel sur les jobs actifs ; claim réservé au service_role

webhook_deliveries (   -- outbox du retour d'état (§6)
  id, organization_id, demande_id, event_id uuid UNIQUE, event_type, payload jsonb,
  target text,         -- 'clara' (extensible partenaires)
  status, attempts, next_attempt_at, last_error, created_at, delivered_at
)

socle_procedure_cache (socle_id PK, socle_organization_socle_id, name, category_socle_id,
                       category_name, type, is_enabled, synced_at)
-- cache LÉGER des démarches uniquement (§7.C) — soft-delete des disparus, jamais de DELETE
sync_runs (journal des synchronisations, motif socle_sync_runs)
```

### 1.3 Exclusions volontaires du MVP

**Workflows paramétrables par organisation** (décision PO : statut fixe à 7 valeurs ; le
`status text CHECK` permet une migration additive vers des tables de workflow plus tard sans
rupture) · miroir complet du référentiel Socle au-delà des organisations (démarches =
snapshot + proxy + cache léger) · notifications in-app · pipeline OCR/analyse LLM ·
sous-tâches/contributions inter-organisations (le passage `en_attente` couvre le besoin
initial) · historique d'affectation dédié (capturé par `demande_events`) · dédoublonnage
automatique (délégué à `contacts-api /match`, décision humaine) · signature d'actes (question
ouverte Q8) · antivirus des PJ (décision à acter, §8).

> **⚠️ Exclusion levée le 2026-08-29 (décision PO) : « pipeline OCR/analyse LLM ».** Iris
> porte désormais un **plafond d'utilisation de jetons** (superadmin) et un **assistant IA
> d'instruction** (Mistral). Ce que le MVP excluait reste vrai pour le reste : aucune analyse
> automatique de demande, aucune décision prise par le modèle, aucune écriture de l'assistant
> dans la demande. Le périmètre exact, ce qui part chez le fournisseur et ce qui n'en part
> pas : [`assistant-ia.md`](assistant-ia.md).

### 1.4 Numérotation chrono

Trigger `BEFORE INSERT` sur `demandes` : `INSERT … ON CONFLICT DO UPDATE … RETURNING` sur
`demande_sequences (organization_id, year)` — atomique, sans race. La contention se limite au
même tenant la même année (négligeable au volume d'une collectivité). Format `DEM-2026-000123`.
Séquence Postgres globale écartée : pas de remise à zéro annuelle propre, et l'espacement des
numéros fuiterait le volume global entre tenants. Le numéro sera cité aux usagers : c'est un
contrat de fait (granularité par tenant ou par organisation → question ouverte Q7).

---

## 2. Frontières exactes Socle / Iris / Clara

### 2.1 Propriété des données

| Donnée | Propriétaire | Clara détient | Iris détient |
|---|---|---|---|
| Organisations (arbre, coordonnées, statut) | **Socle** | Miroir + config Clara | **Miroir léger** (id, parent, nom, statut) + libellé figé par demande |
| Démarches (catalogue, `form_schema`, `requester_config`, `knowledge_base`) | **Socle** | Copie en base (besoin IA) | UUID nu + cache léger + **snapshot figé par demande** |
| Catégories de démarches, types de PJ | **Socle** | Miroirs | Libellé snapshoté sur la demande |
| Quartiers | **Socle** | Objet `quartier` résolu | Idem, via proxy |
| Contacts / usagers | **Socle** | `socle_contact_id` (UUID, sans FK) | `socle_contact_id` + snapshot minimal + identité déclarée |
| Courriers, participants, réponses, workflow courrier | **Clara** | Propriétaire | `source='clara'` + `external_ref` (UUID, sans FK) |
| PJ de courrier | **Clara** (`clara-documents`) | Propriétaire | **Copie** dans le bucket Iris |
| **Demandes, statuts, instruction, PJ de demande, journal** | **Iris** | `courier_links.external_id/external_status` (cache d'affichage) | Propriétaire exclusif |

### 2.2 Flux

```
        ┌───────────────────── SOCLE (projet Supabase A) ─────────────────────┐
        │ organizations · procedures · categories · document_types · quartiers │
        │ contacts        public-api (scope read) · contacts-api (scope contacts) │
        └────────▲────────────────────────────────────────────────▲───────────┘
                 │ (F1) clé plateforme CLARA                       │ (F2) clé plateforme IRIS
                 │ sync nocturne + proxy socle-contacts            │ socle-proxy + sync miroir/cache
     ┌───────────┴──────────────┐                    ┌─────────────┴──────────────┐
     │ CLARA (projet B)         │────── (F3) ───────▶│ IRIS (projet C)            │
     │ couriers, action_tickets │  POST /v1/demandes │ demandes, statuts, docs    │
     │ courier_links            │  clé Iris de Clara │ outbox webhook             │
     │ iris-webhook (edge)      │◀───── (F4) ────────│ demandes-api (edge)        │
     └──────────────────────────┘  webhook HMAC      └────────────▲───────────────┘
                 ▲    │ (F5) cron réconciliation                  │ (F6) POST /v1/demandes
                 └────┘ GET ?updated_since=          ┌────────────┴──────────────┐
                                                     │ Partenaires (portail, …)  │
                                                     │ clé IRIS scopée à une org │
                                                     └───────────────────────────┘
```

| Flux | Sens | Auth | Déclencheur |
|---|---|---|---|
| F1 | Socle → Clara | Clé plateforme Clara (existant) | Sync nocturne + gestes agent |
| F2 | Socle ↔ Iris | **Clé plateforme Socle propre à Iris** (secret edge, jamais navigateur) | Proxy à la demande + sync miroir orgs / cache démarches 1×/jour |
| F3 | Clara → Iris | Clé **Iris** de Clara (plateforme) | Geste agent « créer une action externe Iris » |
| F4 | Iris → Clara | Webhook signé HMAC | Changement de statut, at-least-once |
| F5 | Clara → Iris | Clé Iris de Clara | Cron de rattrapage quotidien |
| F6 | Partenaire → Iris | Clé Iris **liée à une organisation** | Événementiel côté partenaire |

Règles de frontière :

- Les **partenaires n'obtiennent jamais de clé Socle** : Iris est leur unique point de contact.
- **Iris ne modifie jamais l'état d'un courrier Clara** : il publie des faits, Clara décide
  (transition automatique possible uniquement si l'organisation l'a paramétrée côté Clara).
- **Iris est la seule source de vérité du statut d'une demande** : Clara affiche « dernier état
  connu » + `last_sync_at`, comme elle le fait déjà pour Arpège.
- Le MVP ne demande **aucune évolution du Socle** — seule une clé plateforme dédiée Iris est à
  générer (phase 0). Côté Clara : une seule migration (`courier_links.external_version int`),
  `external_type='iris'` étant déjà une valeur libre acceptée (vérifié dans le code).

---

## 3. Cycle de vie et transitions des demandes

**Décision PO : workflow fixe, non paramétrable au MVP.** Sept statuts, libellés produits
identiques pour toutes les organisations. La liste fixe **est** le contrat stable exposé aux
intégrations (plus besoin d'un double niveau état/regroupement). Le paramétrage par organisation
reste une évolution possible plus tard (le `CHECK` sur `status` migre alors vers des tables de
workflow, de façon additive).

### 3.1 Les 7 statuts

| Code | Libellé | Terminal | Délai | Projection Clara (`workflow_category`) |
|---|---|---|---|---|
| `a_traiter` | À traiter | non | délai de prise en charge court | `pending` |
| `en_instruction` | En cours d'instruction | non | délai de traitement court | `processing` |
| `en_attente` | En attente d'information | non | **suspendu** (l'usager ou un tiers est en défaut) | `processing` |
| `annulee` | Annulée | oui | arrêté | `processed` |
| `resolue_positive` | Résolue positivement | oui | arrêté | `processed` |
| `resolue_negative` | Résolue négativement | oui | arrêté | `processed` |
| `archivee` | Archivée | oui (post-clôture) | — | `archived` |

En clôture, un **motif optionnel** (`closure_motif` : irrecevable, abandon, retrait usager,
doublon — avec référence de la demande maître obligatoire —, réorientation) affine le
reporting sans ajouter de statut, et un **texte de clôture destiné à l'usager**
(`closure_text`) est exigé pour les résolutions (réutilisé par Clara comme brouillon de
réponse).

### 3.2 Matrice des transitions (fixe, portée par la garde serveur)

Acteurs : **A** agent · **S** superviseur · **Adm** admin · **Sys** système/intégration.

| Depuis | Vers | Déclencheurs | Conditions |
|---|---|---|---|
| ∅ | `a_traiter` | Sys, A | Organisation traitante jamais nulle ; démarche OU objet libre ; identité déclarée OU anonymat assumé |
| `a_traiter` | `en_instruction` | A (auto-prise en charge), S (affectation) | **Agent assigné obligatoire** ; démarche confirmée ou objet qualifié |
| `a_traiter` | `resolue_negative` | A (si autorisé), S | Irrecevabilité : motif obligatoire (`irrecevable`, `doublon`, `reorientation`) |
| `a_traiter` | `annulee` | A, S, Sys (retrait par l'usager) | Motif |
| `en_instruction` | `en_attente` | A | Motif d'attente + **échéance de relance** ; suspend le décompte |
| `en_instruction` | `resolue_positive` / `resolue_negative` | A, S | `closure_text` obligatoire ; garde « dossier complet » activable |
| `en_instruction` | `annulee` | A, S | Motif |
| `en_instruction` | `a_traiter` | S | Retour à qualifier (réaffectation d'organisation, anomalie) |
| `en_attente` | `en_instruction` | A, S, **Sys** (réponse usager reçue) | Élément reçu journalisé |
| `en_attente` | `annulee` | **Sys** (péremption auto), S | Échéance dépassée + N relances (motif `abandon`) |
| `annulee` / `resolue_*` | `en_instruction` | **S uniquement** (réouverture) | Motif ; délai paramétré ; événement émis vers les intégrations |
| `annulee` / `resolue_*` | `archivee` | Sys (lot après N jours), Adm | Aucune modification possible ensuite |
| `archivee` | statut terminal précédent | Adm (désarchivage) | Motif tracé ; prérequis à toute réouverture |

**Règle conservée : `resolue_positive` exige un passage par `en_instruction`.** On ne résout
pas positivement ce qu'on n'a jamais instruit ; les clôtures immédiates depuis `a_traiter` sont
`resolue_negative` (irrecevabilité) ou `annulee`.

### 3.3 Gardes serveur (jamais UI seulement)

La matrice ci-dessus vit dans le trigger `demandes_enforce_transition` (constante SQL/code,
testée). Interdits : transition hors matrice ; toute modification d'une demande `archivee` ;
`archivee` autrement que depuis un statut terminal ; résolution sans `closure_text` ; motif
`doublon` sans `master_demande_id`. Bypass `service_role` explicite et journalisé pour les
automatismes (leçon Clara : une garde sans contournement système bloque la péremption
automatique et l'ingestion).

### 3.4 Actions qui ne sont PAS des transitions

Réaffectation d'agent (aucun effet sur le statut ni les délais) ; réaffectation d'organisation
(la demande reste dans son statut courant sauf besoin de requalification → `a_traiter` +
anomalie ; `received_at` ne change jamais ; compteur de transferts avec alerte anti-ping-pong) ;
ajout de pièce/note ; rapprochement d'usager ; scission (1 courrier → N demandes liées — le
contrat de retour gère le 1→N). Toutes journalisées dans `demande_events`.

### 3.5 Cas limites arbitrés

| Cas | Comportement |
|---|---|
| Démarche **inconnue** de la racine cible | **Refus synchrone** (erreur d'appel, rejouable) |
| Démarche connue mais **désactivée** | **Acceptée** + anomalie `demarche_inactive`, bloquée en `a_traiter` jusqu'à requalification |
| Démarche devenue obsolète après coup | La demande reste lisible sur son **snapshot** figé |
| Usager inconnu du Socle | Jamais bloquant : identité déclarée conservée, statut `non_rapprochee` ; rapprochement via `contacts/match` = **geste d'agent**, jamais automatique |
| Demande **anonyme** | Légitime (signalement voirie) : choix qualifié, pas un défaut ; aucune notification usager possible |
| Doublon **technique** | Clé d'idempotence, second appel = succès avec l'existant (§5) |
| Doublon **métier** | Détection best-effort à la qualification, décision humaine, clôture `resolue_negative` motif `doublon` + notification à la source avec la référence maître |
| Demande **libre** (sans démarche) | Cas nominal : objet obligatoire ; promotion vers une démarche possible sans exigence rétroactive |
| PJ obligatoire absente | N'empêche jamais l'enregistrement ; `dossier_incomplet` ; la garde bloque `resolue_positive` (activable) |
| PJ non récupérable | Demande créée, pièce `error`, rejeu unitaire — jamais d'échec silencieux |
| Socle indisponible à l'ingestion | Demande **acceptée** + anomalie `referentiel_indisponible` |

---

## 4. Rôles internes et droits RLS

> **Amendement du 2026-08-22 — profils de droits.** Le reste de ce §4 est le document de
> cadrage **historique**, tel que validé le 2026-08-20 : il n'est **pas réécrit** ci-dessous et
> ne décrit plus l'implémentation réelle sur deux points structurants. Le PO a arbitré, le
> 2026-08-22, une dimension que ce cadrage n'avait pas anticipée : la visibilité et l'écriture
> sur une demande ne se jouent plus sur la seule **organisation** (sous-arbre d'affectation),
> mais sur le **couple (organisation porteuse, démarche)**, combiné par **profils de droits**
> attribuables cumulativement à un utilisateur (matrice consultation/création/instruction/
> clôture + périmètre + attribut administration indépendant). Conséquences pour ce qui suit :
>
> - **`socle_organization_members`** (§4.1, §4.2, §4.3 — affectation directe d'un utilisateur à
>   une organisation du miroir) **n'existe pas** : remplacée par
>   `permission_profile_organizations` (périmètre d'un **profil**, pas d'un utilisateur) et
>   `permission_profile_assignments` (attribution d'un profil à un utilisateur).
> - **`has_socle_org_access`** (§4.2) **n'a pas été livrée telle quelle** : remplacée par
>   `permission_pairs_of`/`my_permission_pairs` (couples autorisés, moteur unique) et
>   `has_admin_scope`/`is_org_admin_anywhere` (administration, attribut de profil indépendant de
>   la matrice — le rôle **admin** du tableau §4.1 n'accorde plus, par construction, aucun droit
>   d'instruction par le seul fait d'administrer).
> - Le rôle binaire **agent/superviseur/admin/lecteur/plateforme/système** du tableau §4.1 est
>   remplacé par la combinaison de profils ; `organization_members.role` (agent|administrateur)
>   **subsiste en colonne dérivée transitoire**, recalculée depuis les profils, le temps de la
>   bascule complète de la surface applicative.
>
> Référence normative de l'implémentation réelle : [`droits.md`](droits.md) (sémantique
> métier) et [`data-model.md`](data-model.md) (tables, gardes, policies). Le reste de ce
> document (§0 à §3, §5 à §9) reste la référence historique de cadrage et n'est pas concerné.

### 4.1 Rôles fonctionnels — tous bornés au sous-arbre d'affectation

Le périmètre d'un utilisateur = les organisations Socle auxquelles il est affecté
(`socle_organization_members`) **et toute leur descendance**. Un administrateur ne voit que son
arbre ; affecté à la racine, il voit tout le tenant.

| Rôle | Peut (dans son sous-arbre) | Ne peut pas |
|---|---|---|
| **agent** | Consulter, qualifier, prendre en charge, saisir, joindre, noter, rapprocher un usager, mettre en attente, transitionner selon la matrice, clore si autorisé, réaffecter à un collègue | Réaffecter hors de son sous-arbre, rouvrir, forcer une transition, paramétrer, archiver |
| **superviseur** | Tout l'agent + affecter/réaffecter (agents et organisations de son arbre), clore avec tout motif, **rouvrir**, scinder, transition de déblocage tracée, tableaux de bord | Paramétrer, supprimer, modifier le journal |
| **admin** | Gérer les affectations (`socle_organization_members`) de son arbre, motifs/délais/modèles, archiver/désarchiver, consulter le journal des intégrations | **Instruire par le seul fait d'être admin** (cumul de rôle requis) ; toucher une demande archivée ; voir hors de son arbre |
| **lecteur** (élu, direction) | Consulter demandes, statuts, historique, délais, statistiques, exports | Toute écriture ; **ne voit pas les notes internes** ; demandes sensibles sur habilitation nominative (Q6) |
| **plateforme** (`is_platform_admin`) | Provisionner les tenants, générer les clés API, superviser, déclencher les syncs | — |
| **système** (clé API) | Déposer une demande + pièces, lire **ses** demandes, déposer une réponse d'usager, recevoir les événements | Instruire, clore, réaffecter, supprimer ; écriture toujours attribuée à la **source** |

### 4.2 Helpers RLS (le piège anti-récursion d'abord)

Helpers `SECURITY DEFINER` posés **avant la première table** — en `SECURITY INVOKER` ils
créeraient la récursion infinie documentée par Socle (`stack depth limit exceeded`) :

```sql
is_platform_admin()             -- lit users sans redéclencher le RLS
is_org_member(p_org_id)         -- platform_admin OU membre du tenant
is_org_admin(p_org_id)          -- platform_admin OU role='admin' sur le tenant
has_socle_org_access(p_id)      -- p_id = socle_organizations.id (ligne miroir) :
                                -- l'utilisateur est affecté à CETTE organisation OU à un ANCÊTRE
                                -- (remonte socle_parent_id dans le miroir, profondeur bornée à 10,
                                --  protégé des cycles — équivalent local d'is_admin_of_self_or_ancestor
                                --  du Socle, mais sur le miroir)
is_socle_org_admin(p_id)        -- idem + role admin sur le tenant (gestion des affectations)
```

`EXECUTE` accordé à `authenticated` sur ces helpers (le RLS les évalue avec les droits de
l'appelant) ; **révoqué** de `anon`/`authenticated`/`PUBLIC` sur toutes les fonctions trigger et
RPC de service, **dans la même migration** que leur création, et re-révoqué à chaque
`CREATE OR REPLACE` (le replace re-grante `PUBLIC` — piège opérationnel documenté par Clara).

### 4.3 Policies

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `organizations` | membre | plateforme | plateforme | plateforme |
| `users` | soi / plateforme / admin d'une org partagée | trigger seul | soi (hors flag admin) / plateforme | — |
| `organization_members` | soi ou admin | admin | admin | admin |
| `socle_organizations` | membre du tenant | **aucune** (sync service_role) | **aucune** (idem ; colonnes de config Iris futures : admin) | **aucune** (soft-delete par la sync) |
| `socle_organization_members` | soi ou `is_socle_org_admin` | `is_socle_org_admin` (dans son arbre) | idem | idem |
| `demandes` | `has_socle_org_access(socle_organization_id)` | idem (création manuelle dans son arbre) | idem (**gardes par triggers**) | **aucune** |
| `demande_events` | `has_socle_org_access(socle_organization_id)` | **aucune** (triggers + service_role) | **aucune** | **aucune** |
| `demande_documents` | `has_socle_org_access(...)` | idem | **aucune** | admin |
| `demande_notes` | `has_socle_org_access(...)` | idem | auteur ou admin | auteur ou admin |
| `api_keys` | plateforme | plateforme | plateforme | plateforme |
| `api_request_log`, `webhook_deliveries`, `attachment_jobs`, `socle_procedure_cache`, `sync_runs` | membre (lecture diagnostic) ou plateforme | **aucune** côté client | **aucune** | **aucune** |

Discipline transverse : `ENABLE ROW LEVEL SECURITY` sur **toutes** les tables du schéma
`public`, journaux et miroirs compris · `organization_id NOT NULL` partout · toute policy
service écrite `TO service_role` explicitement (sans le `TO`, elle s'évalue aussi pour
`authenticated` — faille documentée) · vues en `security_invoker = on` · `get_advisors` après
chaque migration · **test d'étanchéité automatisé dès la première table**, à deux niveaux :
cross-tenant (deux racines) **et intra-tenant** (deux sous-arbres frères — un agent du service A
ne voit pas les demandes du service B).

⚠️ Point de vigilance spécifique au sous-arbre : `has_socle_org_access` remonte la hiérarchie du
**miroir** — la réaffectation d'une organisation dans l'arbre Socle (changement de parent)
change donc la visibilité après la sync. Comportement voulu (le Socle est la source de vérité),
à documenter pour éviter les surprises d'exploitation.

### 4.4 Storage

Bucket privé `demande-documents`, 25 Mio max/fichier. Convention de chemin **porteuse du RLS** :
`{organization_id}/{demande_id}/{uuid}-{slug}` — 1er segment = `organizations.id` **local**. La
policy SELECT du bucket vérifie le tenant par le chemin **et** le sous-arbre via une jointure
`demande_documents` (le chemin seul ne porte pas la granularité sous-arbre). Consultation par
URL signée 5 minutes (parité Socle). Validation serveur des fichiers par **magic bytes** (jamais
l'extension ni le Content-Type déclaré), allow-list de formats, service en
`Content-Disposition: attachment`. ⚠️ Les policies storage vivent dans une **migration
versionnée** (le `db dump` ne couvre pas le schéma `storage` — constat Socle).

---

## 5. Contrat d'ingestion Clara → Iris (et partenaires), idempotent

Edge function **`demandes-api`**, `verify_jwt = false` (auth portée par le code, motif Socle),
préfixe `/v1`, OpenAPI publiée + page Redoc in-app + `api-changelog.md` dès le jour 1.

| Verbe | Route | Rôle | Scope |
|---|---|---|---|
| POST | `/v1/demandes` | Ingestion idempotente | `demandes:write` |
| GET | `/v1/demandes/{id}` | Relecture | `demandes:read` |
| GET | `/v1/demandes?source=&updated_since=&limit=` | Réconciliation (pagination max 500) | `demandes:read` |
| — | autres | 405 | |

**Auth** : `Authorization: Bearer <clé Iris>`. Clé **partenaire** : liée à une organisation
(périmètre imposé — le partenaire ne choisit pas ; un `organization_id` dans le corps est
vérifié égal ou ignoré, jamais faisant autorité). Clé **Clara** : plateforme — l'organisation
cible du payload est validée contre le miroir `socle_organizations` du tenant. Hors
périmètre = 404.

> **Réalisé le 2026-09-22, pour le portail usagers (contrat 2.3.0).** La clé plateforme n'a
> finalement pas servi à Clara mais à Nora, dont l'instance unique sert toutes les
> collectivités : une source `integration_sources` **sans organisation** porte la clé, et
> l'appel nomme la collectivité par l'en-tête `X-Socle-Root-Organization-Id`, validé contre
> le miroir. Une nuance par rapport au dessin : la collectivité doit en plus avoir **une
> source active du même code** — c'est l'interrupteur par collectivité, et le journal reste
> tenu par collectivité. Une clé par collectivité avait été essayée le même jour : intenable
> dès la troisième (secret remplacé en entier, clairs non conservés). Voir
> `docs/api-ingestion.md`, « Clé plateforme ».

**Payload minimal** :

| Champ | Obligatoire | Notes |
|---|---|---|
| `source` | oui | Registre **fermé** ; inconnu → 400 |
| `external_id` | oui pour une source externe | ⚠️ Côté Clara : **`action_tickets.id`, pas `courier.id`** — un courrier peut engendrer plusieurs demandes (décision D4) |
| `socle_organization_id` | oui | **UUID Socle** (`socle_organizations.socle_id`), jamais une PK de miroir local ; traduit vers la ligne miroir Iris à l'ingestion ; inconnu du sous-arbre → 400 explicite |
| `socle_procedure_id` | non | UUID Socle ; `null` = demande libre/à qualifier |
| `subject` / `body` | `subject` oui | |
| `requester` | oui | `{socle_contact_id}` **ou** identité brute déclarée — au moins l'un des deux, ou `anonymous: true` assumé |
| `form_data` | non | Clé machine = `key` (règle Socle) ; stocké tel quel, **jamais validé à l'ingestion** (un courrier papier n'a rempli aucun formulaire — la complétude est un problème d'instruction) |
| `attachments[]` | non | `{file_name, mime_type, size_bytes, checksum, fetch_url}` |
| `received_at`, `channel`, `external_url`, `metadata` | non | Date de réception d'origine ≠ date d'ingestion |

**Idempotence** : contrainte `UNIQUE (organization_id, source, external_ref) WHERE external_ref
IS NOT NULL`. Rejeu → **`200 OK` avec la demande existante** + `{"created": false}` +
`Idempotent-Replay: true` ; création → `201` + `{"created": true}`. Le payload du rejeu est
ignoré (première écriture gagnante). Concurrence : le second `INSERT` simultané capte le
`23505`, relit et renvoie la ligne du premier — aucune double numérotation. *409 écarté* : le
rejeu sur timeout réseau est le cas nominal d'un émetteur fiable, pas une anomalie ;
*upsert/merge écarté* : écraserait des corrections d'agent.

**Pièces jointes — copie asynchrone (pull)** : l'émetteur fournit une `fetch_url` signée courte
durée ; Iris répond immédiatement (`attachments_status: "pending"`) et enfile la copie vers son
bucket (dédup par `checksum`). Échec d'une PJ → `partial`, visible par l'agent, rejeu unitaire —
jamais un rejet de la demande. *Base64 inline écarté* (plafonds edge, tout-ou-rien) ; *URL
persistée écartée* (expiration, couplage à la disponibilité et à la purge RGPD de Clara).
**Règle d'or : Iris copie les pièces, il ne les référence pas** — coût de stockage doublé assumé
et documenté, c'est le prix de l'autonomie du dossier.

> **Remplacé le 2026-09-08 (contrat 2.0.0) — mode PUSH.** Le pull n'a jamais été livré (aucun
> worker), et il aurait laissé dormir des URL signées de partenaires dans une table lisible par
> tout membre, avec une surface SSRF le jour du worker. Désormais l'émetteur **dépose les
> octets** (`POST /v1/uploads`, multipart), Iris les **vérifie** (signature binaire contre une
> liste fermée, extension cohérente, sha256 — porte unique `_shared/files/receive.ts`) et les
> range en **zone d'attente** (`attachment_uploads`, objet sous `{org}/_staging/`), puis
> l'enveloppe ne porte que des `upload_id` ; le rattachement est **synchrone** (déplacement de
> l'objet + RPC en une transaction). Une seule copie, aucun état intermédiaire, aucun secret
> persisté. La règle d'or tient toujours : Iris détient l'octet, il ne référence rien chez
> l'émetteur — mais sans doublement de stockage : le partenaire sans stockage (Nora) n'a rien à
> garder. Détail : [`data-model.md`](data-model.md) § `attachment_uploads`,
> [`api-ingestion.md`](api-ingestion.md) § 3.

**Réponse de création** : identifiant Iris, `numero` lisible, organisation traitante retenue,
liste des anomalies — directement affichable à l'agent Clara.

**Validation et erreurs** : whitelist stricte des clés de payload (inconnue → 400),
normalisation des chaînes, enveloppe et vocabulaire **identiques au Socle**
(`{"error":{"code","message"}}`, messages français, 400/401/403/404/405/409/500, hors
périmètre = 404). `Idempotency-Key` accepté en en-tête en complément (défense en profondeur).
Quota par clé (fenêtre glissante), taille de corps bornée. Sérialisation sortante par
**whitelist stricte** (motif `_shared/serializers.ts` Socle) — les notes internes et le journal
n'apparaissent jamais dans une réponse d'API externe.

---

## 6. Contrat de retour Iris → Clara

**Recommandation : webhook push signé comme mécanisme de fraîcheur + réconciliation par polling
comme garantie.** Le pull seul condamne la notification à l'agent (limite avérée du motif
Arpège : le statut ne se rafraîchit qu'à l'ouverture de l'onglet) ; le push seul perd des
événements sur indisponibilité prolongée — or une clôture perdue est précisément le risque que
Clara existe pour éliminer. Le webhook satisfait les conditions de sécurité posées : HMAC-SHA256
du corps, en-têtes `X-Iris-Signature` + `X-Iris-Timestamp`, fenêtre anti-rejeu de 5 minutes,
endpoint Clara strictement limité à la mise à jour d'un état sur une demande dont elle détient
déjà l'identifiant. (Décision D3 à valider, §8.)

**Événement contractuel** : `demande.status_changed`, émis à **chaque changement de statut**
(les 7 statuts étant fixes, chaque changement est significatif — il n'y a plus de sous-états
générateurs de bruit). Payload :

```json
{
  "event": "demande.status_changed",
  "event_id": "<uuid>",
  "occurred_at": "2026-08-20T10:12:00Z",
  "demande": {
    "id": "<uuid Iris>", "numero": "DEM-2026-000123", "version": 7,
    "source": "clara", "external_id": "<uuid action_tickets>",
    "socle_organization_id": "<uuid Socle>",
    "status": "resolue_positive", "previous_status": "en_instruction",
    "is_final": true, "closure_motif": null,
    "closure_text": "<texte destiné à l'usager, réutilisable en brouillon de réponse>",
    "master_demande_id": null,
    "url": "https://iris.../demandes/<uuid>", "updated_at": "..."
  }
}
```

`status`, `closure_motif` viennent des listes fermées (§3) ; la projection vers
`workflow_category` de Clara est documentée dans le contrat (table §3.1). Une réouverture est un
`status_changed` ordinaire (terminal → `en_instruction`) ; une fusion en doublon porte
`closure_motif: "doublon"` + `master_demande_id` (Clara suit alors la maître). **Aucune note
interne ne transite jamais** ; `closure_text` est un objet distinct, rédigé pour l'usager.

**Garanties** : at-least-once côté Iris (outbox `webhook_deliveries`, backoff
1 min/5/15/1 h/6 h, mise en échec consultable après 24 h) ; **idempotence côté Clara par
version monotone** — un événement n'est appliqué que si `version >
courier_links.external_version`. Ce choix règle le rejeu **et** le désordre de livraison, sans
table de reçus ni dépendance aux horloges. Un courrier archivé/purgé côté Clara est **acquitté
et retiré de la file** — jamais de relance perpétuelle. Filet : cron Clara quotidien
`GET /v1/demandes?source=clara&updated_since=`, même logique de version.

**Rangement côté Clara** (une seule migration : `courier_links.external_version int`) :

| Cible | Écriture |
|---|---|
| `courier_links` (`external_type='iris'`) | `external_status` ← statut (+motif), `sync_status` ← `synced`/`error`, `last_sync_at`, `external_version` |
| `action_tickets` | `status` dérivé (`open` si non terminal, `closed` sinon) |
| `courier_events` | `event_type='external_demande_updated'` (varchar libre — aucune migration) |
| `notifications` | in-app à l'affectataire quand `is_final = true` |

**Multiplicité** : un courrier lié à N demandes (scission) reçoit N flux indépendants ; Clara ne
considère le volet actions soldé que quand toutes les demandes liées sont terminales. Le
courrier lui-même n'est **jamais** transitionné automatiquement par Iris. Anti-boucle : chaque
transition porte son `origin` ; Iris n'émet jamais de webhook vers l'émetteur d'un événement
dont il est l'origine.

---

## 7. Stratégie de snapshot des référentiels Socle

Quatre niveaux, une règle de décision : **miroir pour la hiérarchie / figé sur la demande /
frais par proxy / cache léger pour les démarches**.

### A. Miroir des organisations (motif Clara — décision PO)

`socle_organizations` : le sous-arbre du tenant (id Socle, parent, nom, statut), synchronisé par
cron nocturne + rafraîchissement manuel (edge `sync-socle-referentiel`, upsert idempotent par
`socle_id`, soft-delete des disparus, journal `sync_runs`). C'est la **seule** réplication de
structure : elle est nécessaire parce que la hiérarchie porte la visibilité RLS par sous-arbre
et les FK internes d'Iris (`demandes.socle_organization_id`) — mêmes raisons que Clara. Les
champs Socle y sont réécrasés à chaque sync ; les futures colonnes de configuration Iris
(délais, affectations par défaut) s'attacheront à ces lignes sans recopier un champ Socle de
plus.

### B. Snapshot figé par demande — écrit une fois, jamais rafraîchi

| Donnée | Pourquoi |
|---|---|
| `socle_organization_label` | La demande reste lisible après renommage/obsolescence |
| `socle_procedure_label`, `category_label` (catégorie de démarche Socle), libellés de types de PJ | Idem |
| `procedure_snapshot` (`form_schema` + `requester_config`) | **Le point le plus important** : le form builder Socle évolue en continu ; sans copie figée, une demande de mars est illisible en septembre. Figé **par demande** (plus fin que le miroir Clara) |
| `requester_declared` (identité déclarée par la source, intégrale) | C'est une **pièce du dossier**, pas un miroir : ce qui a été demandé, par qui, avec quelles coordonnées à cet instant. Valeur probante + résilience si Socle est indisponible |
| `contact_snapshot` (contact Socle rapproché) | **Minimal** : `display_name`, le canal de contact retenu, commune/CP si territorialisé. **Exclus** : date de naissance, adresse complète, SIRET, consentements, et `internal_notes` — qui n'entre **jamais** dans un snapshot (règle d'or Socle) |

Le snapshot est une copie de données personnelles → la rétention Iris (`retention_until`,
purge) est modélisée **dès la première migration**, pas après.

### C. Lecture à la demande via `socle-proxy` — tout ce qui doit être frais ou écrit

Fiche usager complète et à jour · `POST /v1/contacts/match` (rapprochement) · création
(`/v1/contacts/create`) et **mise à jour** (`/v1/contacts/update` → `PATCH contacts-api
/v1/contacts/{id}`, partiel : seuls les champs modifiés, `null` efface ; `contact_type` et
`status` refusés) d'un usager · `form_schema` au moment de créer une demande dans Iris (puis figé) ·
`documents/signed-url` · géométries de quartiers (route `/v1/quartiers/list` **livrée et
vérifiée le 2026-08-28** pour la carte du champ d'adresse ; c'est la SEULE par laquelle la
géométrie franchit la frontière — `sanitizeContact` continue de la retirer du quartier d'une
fiche usager. Le contrat public-api exige `geometry=true` **et**, pour une clé plateforme,
`organization_id` — sans quoi les quartiers reviennent sans polygone ; le champ s'appelle
`geometry`, pas `geom`). La clé plateforme Socle vit uniquement en
secret d'edge function ; le **`X-Organization-Id` est toujours dérivé côté serveur** (mapping
tenant de l'utilisateur authentifié), **jamais accepté du navigateur** — c'est le risque n°1
identifié (§8, R-C1).

### D. Cache léger des démarches — id + libellé + statut, rien d'autre

`socle_procedure_cache` (id, org, nom, catégorie, type, activation) : sélecteurs, filtres, et
**validation d'ingestion** (existence + activation — utilisable même quand Socle est
indisponible, cf. AC-I10). Même cadence de sync que le miroir. Explicitement **hors cache** :
`form_schema`, `requester_config`, `knowledge_base`, coordonnées, quartiers, contacts.

### La ligne à ne pas franchir

Clara miroite les démarches complètes (`form_schema` en base) pour ses prompts IA — besoin
qu'Iris n'a pas : la demande porte son propre snapshot. Si un besoin de configuration par
organisation apparaît, il s'attache aux lignes du miroir §A ; on n'élargit jamais le périmètre
des champs Socle répliqués. Le miroir et le cache restent des supports de structure et
d'affichage — le référentiel fait foi.

---

## 8. Risques et décisions à faire valider

### 8.1 Authentification inter-projets Supabase — la décision structurante

**Recommandation : clés API opaques façon Socle, généralisées à toute la gamme.** Iris réplique
le modèle `api_keys` (SHA-256, `key_prefix`, scopes, expiration, révocation) pour **ses propres
consommateurs**, dans **sa** base — jamais de lecture de la table `api_keys` de Socle (couplage
inverse + dépendance de disponibilité).

| Option | Verdict |
|---|---|
| **Clés opaques SHA-256 + scopes (motif Socle)** | **Retenu.** Révocation instantanée, scopes, expiration, imputabilité, cohérence de gamme (un seul modèle mental, un seul code d'auth à auditer), éprouvé bout en bout |
| JWT HS256 secret partagé | Rejeté : le vérificateur peut forger des jetons au nom de l'émetteur — inacceptable avec des partenaires externes |
| JWT RS256/EdDSA + JWKS | Rejeté pour l'instant : pas de révocation immédiate, coût opérationnel non justifié pour ~3 appelants ; à reconsidérer au-delà de ~10 partenaires |
| mTLS | Impossible : la terminaison TLS des edge functions est à la passerelle Supabase |
| `service_role` cross-projet | Interdit : accès total, non scopé, non révocable finement |

Améliorations obligatoires par rapport au modèle Socle (Iris part de zéro, il n'hérite pas de la
dette) : `CHECK` sur les scopes · quota par clé · journal d'appels (`api_request_log`, pas
seulement `last_used_at`) · `expires_at` systématique 12 mois · rotation par double clé active.

**Cartographie des secrets** (un secret par consommateur × sens × environnement, nommés
explicitement, secrets d'edge uniquement, jamais dans une migration, jamais loggés au-delà du
préfixe) :

| Secret | Vit chez | Sert à |
|---|---|---|
| Clé plateforme Socle **propre à Iris** (scopes `read` + `contacts` — voir D2) | Iris (secret edge) | `socle-proxy`, syncs |
| Clé Iris de Clara (plateforme, `demandes:read`+`write`) | Clara (secret edge) | F3, F5 |
| Clés Iris partenaires (liées à une organisation, `demandes:write` ± `read`) | Chaque partenaire | F6 |
| `IRIS_WEBHOOK_SECRET` (HMAC) | Iris + Clara | F4 |
| `CRON_SECRET` (Vault) | Iris | Jobs internes — **un seul mode d'auth par fonction** |

**Interdits** : réutiliser la `SOCLE_API_KEY` de Clara pour Iris (imputabilité nulle, révocation
impossible sans couper Clara, compromission croisée) ; donner une clé Socle à un partenaire ;
reproduire l'override multi-clés `SOCLE_CONTACTS_API_KEYS` (chemin de contournement résiduel
identifié chez Clara).

### 8.2 Surface d'exposition d'Iris

| Fonction | `verify_jwt` | Auth | CORS |
|---|---|---|---|
| `demandes-api` (Clara + partenaires) | false | Clé Iris + scope, dans le code | **Aucun en-tête CORS** (S2S uniquement) |
| `socle-proxy` (UI Iris) | true | JWT agent + **revérification d'appartenance** avant relais | Origine Iris uniquement |
| `sync-socle-referentiel`, `attachments-maintenance` (a remplacé `process-attachment-queue` le 2026-09-08 : plus de copie à faire, il ne reste que la purge de la zone d'attente et l'outbox de suppression d'objets — lot 4), `process-webhook-outbox`, purge | false | Secret Vault, mode unique | Aucun |

Ne jamais exposer : le service_role sous aucune forme · les données hors périmètre (404) · les
détails d'erreur (messages génériques, détail au log) · une recherche non bornée · une colonne
hors whitelist de sérialisation · la réponse d'erreur brute du Socle (relais en 502
`socle_auth_failed` / 503 `not_configured`, motif Clara).

### 8.3 Top risques

| # | Risque | Criticité | Mitigation |
|---|---|---|---|
| R-C1 | **Fuite cross-tenant via le proxy Socle** : `X-Organization-Id` relayé depuis le navigateur | Critique | Dérivation serveur exclusive (helper unique, un seul point de code), test d'étanchéité automatisé |
| R-C2 | **IDOR partenaire** : `organization_id` du corps faisant autorité | Critique | Périmètre = la clé (liée) ou allow-list par clé (plateforme) ; corps ignoré ou vérifié égal ; 404 |
| R-C3 | **Clé inter-projets dans le bundle** (`VITE_*`, endpoint de debug) | Critique | Secrets edge only ; règle CI qui échoue si un secret apparaît dans `dist/` |
| R-H1 | Rejeu / flooding de l'ingestion | Élevé | Idempotence native + `Idempotency-Key`, quota par clé, corps borné, UUID v4 |
| R-H2 | RLS mal posée (récursion, `TO` manquant, table technique sans RLS, **helper sous-arbre bogué**) | Élevé | Discipline §4.3 + advisors + tests cross-tenant ET intra-tenant dès la première table |
| R-H3 | PJ : bucket public, MIME non validé, XSS via SVG, path traversal | Élevé | §4.4 (magic bytes, chemins générés, attachment, URL 5 min, upload par URL signée) |
| R-H4 | Rétention absente du modèle initial → base impurgeable | Élevé | `retention_until`/`purged_at` dès la migration 1 ; purge = effacement DP + ligne anonymisée |
| R-H5 | `internal_notes` (Socle ou Iris) fuitant vers un usager/partenaire | Élevé | Whitelist de sérialisation + test dédié qui échoue si le champ apparaît |
| R-M1 | Proxy Socle sur le chemin critique de création | Moyen | Timeout court, miroir + cache pour lister ; l'ingestion S2S n'en dépend pas (snapshot best-effort rattrapable) |
| R-M2 | Divergence d'UUID (Clara envoie une PK de miroir local au lieu d'un UUID Socle) | Moyen | Validation contre le miroir → 400 explicite ; test bout en bout dès la phase 3 |
| R-M3 | Webhooks rejoués / désordonnés | Moyen | Version monotone + application conditionnelle — réglé par conception |
| R-M4 | Multiplication des clés plateforme sans inventaire ni forensic | Moyen | Registre de gamme documenté ; évolutions Socle à ouvrir (journal d'appels, allow-list d'orgs par clé plateforme) |
| R-M5 | Rotation jamais faite faute de mécanisme | Moyen | Double clé active côté Iris ; `*_NEXT` avec repli côté consommateur ; runbook unique |
| R-M6 | Reparentage d'une organisation dans le Socle → bascule de visibilité après sync | Moyen | Comportement assumé (Socle fait foi), documenté ; journal `sync_runs` pour diagnostic |
| R-F1 | Absence d'antivirus PJ | Faible | À acter explicitement (aucune option native Supabase) |

Risque résiduel **assumé** : le modèle « clé plateforme » place l'isolation multi-tenant dans le
code d'Iris, pas dans Postgres — un bug de résolution de tenant produit une fuite que Socle ne
détectera pas. Compensations : point de code unique, journal d'appels, tests d'étanchéité,
allow-list par clé à terme.

### 8.4 Décisions

**Actées par le PO (2026-08-20) :**

- **Workflow fixe au MVP** — 7 statuts non paramétrables (À traiter, En cours d'instruction, En
  attente d'information, Annulée, Résolue positivement, Résolue négativement, Archivée) ;
  le paramétrage par organisation est une évolution ultérieure, permise par conception
  (CHECK → tables, migration additive).
- **Organisations façon Clara** — tout vient du Socle (miroir synchronisé du sous-arbre),
  visibilité de chaque utilisateur — administrateurs compris — limitée à son arbre.

**À valider :**

| # | Décision | Recommandation |
|---|---|---|
| D1 | Auth des consommateurs d'Iris | Clés opaques façon Socle (§8.1) |
| D2 | Clé plateforme Socle propre à Iris — avec ou sans scope `contacts` ? | Plateforme, `read` d'office ; `contacts` **oui** si le geste « rapprocher/créer l'usager » est au MVP (recommandé) |
| D3 | Retour Iris→Clara | Webhook HMAC + réconciliation en filet (§6) ; l'alternative pull-seul est plus sobre mais sacrifie la notification |
| D4 | Granularité du lien Clara | `external_id` = **`action_tickets.id`**, jamais `courier.id` (piège d'idempotence n°1 : deux actions d'un même courrier seraient fusionnées) |
| D5 | Création d'usager Socle depuis Iris | **Jamais automatique** — geste d'agent après `contacts/match` (même choix que Clara) |
| D6 | Visibilité sous-arbre portée par le RLS (et non par un filtre applicatif comme Clara) | **RLS** — doctrine de la gamme ; Iris est un projet neuf, autant poser la vraie frontière |
| D7 | Communication à l'usager | **Le canal d'origine porte la communication** (née d'un courrier → Clara répond avec le `closure_text` fourni ; née du portail → Iris/portail). Frontière produit à confirmer |
| D8 | Comptes et affectations | Utilisateurs **locaux** Iris au MVP (Socle n'expose aucune API utilisateurs) ; fédération = évolution de gamme à ouvrir séparément |
| D9 | Rétention | Proposition de départ : 1 an après clôture (demande + PJ), 3 ans pour les journaux d'accès — à valider juridiquement |
| D10 | Région Supabase du projet Iris | **UE, à confirmer avant création — irréversible** |
| D11 | Antivirus PJ | Accepter l'absence (documentée) ou budgéter un service externe |
| D12 | Clara peut-elle annuler une demande (courrier classé sans suite) ? | Si oui : `POST /v1/demandes/{id}/cancel` en phase 4 + règle anti-boucle obligatoire |

### 8.5 Questions ouvertes produit (n'empêchent pas de démarrer la phase 1)

Q2 Délais réglementaires (silence vaut accord) ou seulement délais cibles ? · Q3 Rapprochement
d'usager obligatoire avant `resolue_positive` quand la démarche prévoit une réponse : garde
bloquante ou avertissement ? · Q4 Droit à l'effacement en cours d'instruction ? · Q6 Demandes
sensibles à visibilité nominative (au-delà du sous-arbre) ? · Q7 Numérotation par tenant ou par
organisation ? · Q8 Signature d'actes : Iris ou délégation à Clara (qui sait signer et produire
un PDF gabarité) ? · Q9 Annulation par l'usager : jusqu'à quel statut ? · Q10 Contrat
d'événements unique pour tous les appelants (recommandé — leçon de la dette Arpège) ? ·
Q11 Reprise d'un stock existant (import initial de demandes déjà en instruction ou closes,
malgré la garde d'atterrissage) ?

---

## 9. Plan de livraison proposé (MVP)

| Phase | Contenu | Note |
|---|---|---|
| **0** | Clé plateforme Socle dédiée Iris générée par un super admin Socle. **Rien d'autre côté Socle.** | |
| **1** | Iris autonome : schéma + RLS sous-arbre + statuts fixes, sync du miroir d'organisations, `socle-proxy`, cache démarches, UI de création et d'instruction. Aucun lien Clara. | **La valeur est livrée dès cette phase** |
| **2** | `demandes-api` : POST idempotent, GET, copie asynchrone des PJ, OpenAPI + Redoc + changelog. Recette avec un émetteur factice. | |
| **3** | Clara → Iris : `create-iris-demande`, dialogue de création, `action_tickets` + `courier_links`. | Couple indissociable avec la phase 4 |
| **4** | Iris → Clara : outbox, webhook signé, `iris-webhook`, migration `external_version`, notifications. | Ne pas livrer 3 sans 4 (liens muets) |
| **5** | Filet de réconciliation, premiers partenaires (clés liées), rétention/purge RGPD opérationnelle. | |

---

## Annexe — Critères d'acceptation des contrats

### Ingestion (AC-I)

1. **Idempotence** : deux appels de même `(source, external_id)` → une seule demande, second
   appel en succès avec l'existant, ni pièces ni événements dupliqués.
2. **Organisation jamais nulle** ; hors périmètre de la clé → refus, zéro création partielle.
3. **Identité conservée** intégralement même sans contact ; `contact_id` vérifié dans la racine ;
   aucune création automatique de contact.
4. **Démarche** : inconnue → refus ; désactivée → acceptée + anomalie bloquante ; absente →
   objet obligatoire. `form_schema` figé sur la demande.
5. **Pièces** : copiées avant l'accusé ou marquées `error` rejouables — jamais d'échec silencieux.
6. **Traçabilité** : source, external_id, lien retour, `received_at` distinct de la date d'ingestion.
7. **Statut d'entrée** : `a_traiter`, toujours ; création journalisée avec l'acteur système.
8. **Critère produit** : l'agent instruit sans jamais rouvrir Clara.
9. **Refus propres** : enveloppe Socle, code stable, message français, rejouable après correction.
10. **Dégradé** : Socle indisponible → demande acceptée + anomalie `referentiel_indisponible`.
11. **Réponse exploitable** : id Iris + numéro + organisation retenue + anomalies.

### Retour (AC-R)

1. Événement `demande.status_changed` à chaque changement de statut — les 7 statuts sont les
   seules clés stables ; motif et libellés en complément, jamais comme identifiants.
2. Corrélation : `external_id` d'origine + id Iris + numéro ; scission → référence d'origine ;
   doublon → référence de la demande maître.
3. At-least-once + consommation idempotente par version monotone ; signature + horodatage.
4. Rattrapage par lecture (`GET ?updated_since=`) : un webhook perdu n'est jamais une perte définitive.
5. Aucun effet de bord : la transition du courrier reste une décision Clara.
6. Échec visible et consultable ; courrier archivé/purgé → acquitté, retiré de la file.
7. Clôture : statut + motif + texte destiné à l'usager ; **aucune note interne**.
8. Fraîcheur mesurable : émission ≤ 60 s après la transition (critère de test).
9. Multiplicité 1 courrier → N demandes : N flux indépendants ; soldé quand toutes terminales.
