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
| `SOCLE_API_KEY` | Clé Socle dédiée à Iris — scopes `read` + `contacts` + **`smtp`** (ce dernier depuis le 2026-08-23 : sans lui, le serveur d'envoi du tenant ne descend pas du Socle) | **Générée le 2026-08-20**, clair dans `.secrets/SOCLE_API_KEY.txt` (local, gitignoré — à détruire après pose). ⚠️ Jamais celle de Clara. | 1 |
| `CRON_SECRET` | Secret des jobs internes (sync, files, purge) | **Généré**, dans `.secrets/CRON_SECRET.txt` | 1 |
| `IRIS_APP_URL` | Origine de l'app Iris (CORS de `socle-proxy` et `admin-users`, et **base des liens d'activation / de réinitialisation** envoyés par mail) | `http://localhost:5174` en dev ; l'URL de prod quand elle existera | 1 |
| `AUTH_HOOK_SECRET` | Secret du hook « Send Email » de GoTrue (`v1,whsec_…`, généré par le dashboard) | À poser en même temps que l'activation du hook — §4 bis | 1 |
| `IRIS_SMTP_*` | Relais d'envoi **de plateforme**, repli quand le Socle ne déclare pas de serveur pour le tenant (`HOST`, `FROM_EMAIL` obligatoires ; `PORT`, `USERNAME`, `PASSWORD`, `FROM_NAME`, `USE_TLS` facultatifs) | Facultatif — sans lui, seuls les tenants dont le Socle déclare un serveur d'envoi reçoivent des mails | 1 |
| ~~`MISTRAL_API_KEY`~~ | — | **RETIRÉ le 2026-08-29.** ⚠️ **Ne pas le reposer ici** : la clé du fournisseur vit dans le **Socle** (`ai-api`), et c'est tout l'intérêt de la centralisation — une application compromise ne compromet pas la clé. Iris passe par le guichet avec sa `SOCLE_API_KEY` (scope `ai` + imputation `consumer = iris`) | — |
| ~~`MISTRAL_ASSISTANT_AGENT_ID`~~ | — | **RETIRÉ le 2026-08-29.** L'agent est résolu par le Socle depuis un **alias** (`assistant-instruction`) : changer d'agent ou de modèle ne touche plus aucune application | — |
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

## 4 bis. Activer les emails (action manuelle, une fois)

Sans ces deux réglages, le parcours « mot de passe oublié » part avec les gabarits anglais de
GoTrue et son relais bridé, et les liens d'activation retombent sur la page d'accueil.

1. **Hook « Send Email »** — Dashboard → *Authentication* → *Hooks* → activer, type HTTPS,
   URL `https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/auth-email-hook`, puis poser le
   secret généré en `AUTH_HOOK_SECRET`.
2. **URL de redirection** — Dashboard → *Authentication* → *URL Configuration* →
   *Redirect URLs* : ajouter `<origine>/nouveau-mot-de-passe` et `<origine>/activer-compte`,
   pour le `http://localhost:5174` de développement **et** pour l'origine de production.
3. **Scope `smtp` sur la clé Socle d'Iris** — dans le projet Socle, la clé utilisée par Iris
   (`SOCLE_API_KEY`) doit porter le scope `smtp`, sans quoi la route
   `GET /v1/organizations/{id}/smtp` répond 403 et le serveur d'envoi ne descend pas. Deux
   voies : ajouter le scope à la clé existante (SQL editor du Socle,
   `update public.api_keys set scopes = scopes || array['smtp'] where name = 'Iris' and revoked_at is null;`),
   ou créer une nouvelle clé dans le Socle (page de l'organisation → « API publique », cases
   Référentiel + Usagers + **Serveur d'envoi**) et remplacer le secret `SOCLE_API_KEY` d'Iris.
4. Le serveur d'envoi de chaque collectivité se renseigne **dans le Socle** (organisation
   principale → onglet « Emails (SMTP) »), et s'y teste. Côté Iris, il descend à la
   synchronisation du référentiel (nuit à 4 h UTC, ou *Paramètres › Référentiel →
   « Synchroniser maintenant »*) ; le résultat se lit dans `sync_runs.counters`.

Détail complet, parcours et diagnostic : [`emails.md`](emails.md).

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

Après tout lot de migrations SQL touchant le RLS (motif du lot **profils de droits**,
2026-08-22) : rejouer les tests transactionnels de `supabase/tests/` via `apply_migration`
(jamais `execute_sql`, en lecture seule) et lire le verdict final — procédure détaillée,
ordre des migrations et abandon/rollback : [`../supabase/tests/README-profils.md`](../supabase/tests/README-profils.md).
