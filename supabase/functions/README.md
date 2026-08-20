# Edge Functions Iris

| Fonction | Rôle | `verify_jwt` | Auth | État |
|---|---|---|---|---|
| **`requests-api`** | **API d'ingestion générique multi-source** (enveloppe commune, idempotence, conflits, pièces par URL signée, OpenAPI `/v1/openapi.json`) — voir [`../../docs/api-ingestion.md`](../../docs/api-ingestion.md) | `false` | Clés d'intégration Iris (`integration_credentials`, SHA-256 + scopes), dans le code ; **aucun CORS** | **Déployée, vérifiée bout en bout (18 scénarios HTTP)** |
| `socle-proxy` | Relais serveur vers `public-api` / `contacts-api` du Socle pour l'UI Iris | `true` | JWT agent + revérification d'appartenance avant relais | À venir (phase 1) |
| `sync-socle-referentiel` | Sync du miroir d'organisations + cache démarches | `false` | Secret cron, mode unique | À venir (phase 1) |
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
