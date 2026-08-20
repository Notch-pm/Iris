# Démarrage — Iris

> **Public** : développeuses et développeurs mettant en route le projet · **Question
> traitée** : que faut-il faire, dans quel ordre, pour rendre Iris opérationnel ? ·
> **Dernière mise à jour** : 2026-08-20

Le dépôt contient le **squelette applicatif** : l'app démarre et compile, mais aucun projet
Supabase n'existe encore et aucun domaine métier n'est implémenté. Ce document liste les
**actions manuelles** nécessaires, dans l'ordre.

## 1. Prérequis locaux

- **Node ≥ 22** — en pratique **Node 24 / npm 11**, comme le reste de la gamme (npm 10 juge le
  `package-lock.json` désynchronisé et `npm ci` échoue).
- `npm install` à la racine.

Sans configuration Supabase, `npm run dev` démarre mais l'app **échoue volontairement au
chargement** avec un message explicite : c'est le comportement attendu tant que l'étape 3
n'est pas faite. `npm run lint`, `npm test` et `npm run build` fonctionnent sans configuration.

## 2. Créer le projet Supabase Iris (action manuelle, une fois)

1. Créer un **nouveau projet Supabase** dédié à Iris (ne jamais réutiliser ceux de Socle ou
   Clara).
2. ⚠️ **Région : Union européenne** — décision D10 de l'architecture, **irréversible** après
   création (données personnelles d'usagers).
3. Noter la **référence du projet** (`project ref`) et lier le dépôt :
   `supabase link --project-ref <ref>` (ou utiliser le MCP Supabase).

## 3. Renseigner les variables front (action manuelle, par poste)

1. Copier `.env.example` en `.env.local` (non versionné).
2. Renseigner depuis le dashboard Supabase du projet **Iris** (Settings → API) :
   - `VITE_SUPABASE_URL` — l'URL du projet ;
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — la clé **publiable** (publique par conception,
     protégée par le RLS — c'est la seule clé autorisée côté navigateur).
3. `npm run dev` → l'app s'affiche sur `http://localhost:5174` (page de connexion ; aucun
   compte n'existe tant que le schéma et le provisioning ne sont pas implémentés).

## 4. Secrets serveur (actions manuelles, au fil des phases de livraison)

**Aucun de ces secrets ne va dans `.env.local`, dans un fichier versionné ni dans une
variable `VITE_*`.** Ils se posent dans les **secrets d'Edge Functions** du projet Supabase
Iris (`supabase secrets set …` ou dashboard), au moment où la phase qui les utilise est
implémentée (plan de livraison : `architecture-proposee.md` §9).

| Secret | Contenu | État | Phase |
|---|---|---|---|
| `SOCLE_API_URL` | `https://qhrokbkyxgcvkbpmbmna.supabase.co/functions/v1/public-api` | Connu | 1 |
| `SOCLE_API_KEY` | Clé **plateforme Socle dédiée à Iris** (scopes `read`+`contacts`, expire 2027-08-20, préfixe `sk_live_e755...`) | **Générée le 2026-08-20**, clair dans `.secrets/SOCLE_API_KEY.txt` (local, gitignoré — à détruire après pose). ⚠️ Jamais celle de Clara. | 1 |
| `CRON_SECRET` | Secret des jobs internes (sync, files, purge) | **Généré**, dans `.secrets/CRON_SECRET.txt` | 1 |
| `IRIS_APP_URL` | Origine de l'app Iris (CORS de `socle-proxy`) | `http://localhost:5174` en dev ; l'URL de prod quand elle existera | 1 |
| `CLARA_WEBHOOK_URL` | URL de l'edge function `iris-webhook` de Clara | Équipe Clara | 4 |
| `IRIS_WEBHOOK_SECRET` | Secret HMAC du webhook Iris→Clara (partagé avec Clara) | Généré, échangé hors bande | 4 |

**Pose des secrets** (dashboard Iris → Edge Functions → Secrets, ou CLI) :

```bash
supabase secrets set --project-ref tqcoqlneybtbrrcvpkpk \
  SOCLE_API_URL="https://qhrokbkyxgcvkbpmbmna.supabase.co/functions/v1/public-api" \
  SOCLE_API_KEY="$(cat .secrets/SOCLE_API_KEY.txt)" \
  CRON_SECRET="$(cat .secrets/CRON_SECRET.txt)" \
  IRIS_APP_URL="http://localhost:5174"
```

Puis premier lancement de la sync (et à planifier en cron quotidien, dashboard → Integrations
→ Cron, ou pg_cron) :

```bash
curl -X POST "https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/sync-socle-referentiel" \
  -H "x-cron-secret: $(cat .secrets/CRON_SECRET.txt)"
```

Tant que les secrets ne sont pas posés, `sync-socle-referentiel` et `socle-proxy` répondent
**503 `not_configured`** (vérifié) — l'app fonctionne avec ses replis (facettes observées).

Côté **Clara** (à faire par l'équipe Clara, phases 3–4) : `IRIS_API_URL`, `IRIS_API_KEY`
(clé plateforme générée **par Iris** une fois sa table `api_keys` implémentée),
`IRIS_WEBHOOK_SECRET`.

Règles : un secret par consommateur × sens × environnement · rotation par double clé
(`*_NEXT`) · jamais dans une migration · jamais loggé au-delà du préfixe.

## 5. Étapes suivantes (développement, plus manuelles)

Dans l'ordre du plan de livraison (`architecture-proposee.md` §9) :

1. **Phase 1** — premières migrations (helpers RLS d'abord, puis tables §1 de l'architecture),
   régénération de `src/types/database.types.ts` depuis le schéma live, sync du miroir
   d'organisations, `socle-proxy`, UI de création/instruction.
2. **Phase 2** — `demandes-api` (ingestion idempotente) + OpenAPI/Redoc + `api-changelog.md`.
3. **Phases 3–5** — intégration Clara aller/retour, partenaires, rétention RGPD.

Fait le 2026-08-20 : dépôt git initialisé (remote `https://github.com/Notch-pm/Iris.git`),
hook pre-commit husky (`lint` + `test`) et CI GitHub Actions sous Node 24
(`.github/workflows/ci.yml`).

## Vérifications

```bash
npm run lint    # tsc -b — doit passer sans erreur
npm test        # vitest — la validation de configuration est couverte
npm run build   # tsc -b && vite build — doit produire dist/
```
