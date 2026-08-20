# Edge Functions Iris

| Fonction | Rôle | `verify_jwt` | Auth | État |
|---|---|---|---|---|
| **`requests-api`** | **API d'ingestion générique multi-source** (enveloppe commune, idempotence, conflits, pièces par URL signée, OpenAPI `/v1/openapi.json`) — voir [`../../docs/api-ingestion.md`](../../docs/api-ingestion.md) | `false` | Clés d'intégration Iris (`integration_credentials`, SHA-256 + scopes), dans le code ; **aucun CORS** | **Déployée, vérifiée bout en bout (18 scénarios HTTP)** |
| **`socle-proxy`** | Relais serveur vers le Socle pour l'UI (v1 : `POST /v1/procedure-snapshot` — snapshot de démarche à la création). Périmètre revérifié : la ressource doit appartenir à un tenant de l'appelant. | `false` ⚠️ (JWT vérifié **en code** — la passerelle bloquerait les préflights OPTIONS) | JWT agent + appartenance ; CORS allowlist (`IRIS_APP_URL` + localhost) | **Déployée** (503 `not_configured` sans secrets) |
| **`sync-socle-referentiel`** | Sync du miroir `socle_organizations` + cache `socle_procedure_cache` (sous-arbre par tenant, soft-delete, journal `sync_runs`, nom du tenant rafraîchi) | `false` | `x-cron-secret` === `CRON_SECRET`, mode unique | **Déployée** (503 `not_configured` sans secrets) |
| `process-attachment-queue` | Copie asynchrone des pièces (`copy_status: pending` → `copied`) | `false` | Secret cron | À venir (phase 2) |
| `process-webhook-outbox` | Livraison des webhooks signés (outbox `integration_deliveries`) | `false` | Secret cron | À venir (phase 4) |

Conventions de gamme à respecter (motif Socle) :

- Logique pure co-localisée dans `_shared/{dto,validation,serializers,errors,openapi}.ts`,
  **sans dépendance Deno**, testée par vitest (le `include` de `vite.config.ts` couvre déjà
  `supabase/functions/**`).
- Sérialisation sortante par **whitelist stricte** — jamais de `select *` relayé.
- Enveloppe d'erreurs `{ "error": { code, message } }`, messages en français,
  hors périmètre = 404.
- Le déploiement d'une fonction inclut `index.ts` + tout `_shared/*.ts`.
- **Jamais de clé d'un autre projet dans le navigateur** : les secrets inter-projets vivent
  dans les secrets d'edge functions (voir `docs/demarrage.md`).
