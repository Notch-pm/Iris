# Iris

Système transactionnel des **demandes d'usagers** de la gamme Edilumen. Interface en
**français**.

## Rôle dans la gamme logicielle

La gamme : **Socle** (référentiel central — organisations, démarches, catégories, types de
pièces, quartiers, contacts/usagers), **Clara** (gestion du courrier), **Ariane**, **Iris**.
Iris est propriétaire exclusif des **demandes** : créées par un agent dans Iris, ou ingérées
depuis Clara (action externe issue d'un courrier) et des applications partenaires, puis
instruites jusqu'à un état final.

**L'architecture validée fait foi : [`docs/architecture-proposee.md`](docs/architecture-proposee.md).**
Toute implémentation s'y réfère (modèle de données §1, frontières §2, cycle de vie §3, RLS §4,
contrats d'ingestion/retour §5–6, snapshots Socle §7, sécurité §8, plan de livraison §9).

## Invariants (à ne jamais enfreindre)

- **Socle est la source de vérité** des organisations, démarches, catégories, usagers. Iris ne
  les redéfinit pas : miroir léger de la hiérarchie d'organisations, snapshot figé par demande,
  cache léger des démarches, proxy serveur pour le reste. **Jamais de miroir complet.**
- **Aucune FK ne franchit une frontière de projet** (Socle, Clara, Iris = trois projets
  Supabase distincts). Références croisées = UUID nu + discriminant textuel. **Aucun flux
  base-à-base** — uniquement HTTP.
- **Jamais de clé d'un autre projet dans le navigateur.** Aucun secret en `VITE_*` (inliné dans
  le bundle). Les secrets inter-projets vivent dans les secrets d'edge functions. La seule clé
  côté client est la clé publiable du projet Iris (protégée par le RLS).
- **La sécurité vit dans le RLS Postgres** — les droits ne sont jamais appliqués côté client,
  l'UI ne fait que refléter. Visibilité par **sous-arbre d'organisation Socle**
  (`has_socle_org_access`), y compris pour les administrateurs.
- **Workflow fixe à 7 statuts** (décision PO) : `a_traiter`, `en_instruction`, `en_attente`,
  `annulee`, `resolue_positive`, `resolue_negative`, `archivee`. Gardes de transition
  **serveur** (trigger), jamais UI seulement. « Résolue positivement » exige un passage par
  l'instruction.
- **Vocabulaire** : « catégorie » désigne exclusivement les catégories de **démarches** du
  Socle. La position d'une demande dans son cycle de vie est un **statut**.
- **Iris ne gère aucune demande libre** (règle impérative PO, 2026-08-20) : toute nouvelle
  demande est **fondée sur une démarche Socle active du tenant** (`socle_procedure_id` +
  `procedure_snapshot`), gardé par le trigger `t16_requests_require_procedure` — service_role
  compris. Le **snapshot de démarche est construit côté serveur** depuis Socle (edge
  functions) : jamais accepté comme vérité d'un navigateur ou d'un partenaire. Les demandes
  historiques sans démarche restent lisibles et transitionnables.
- **Aucun miroir local d'usagers** : les contacts vivent dans le Socle (contacts-api), Iris
  les lit/rapproche/crée via `socle-proxy` et ne conserve par demande que le
  `requester_snapshot` (identité retenue au dépôt, immuable).
- **Aucune suppression de demande** (pièce administrative) : pas de policy DELETE, FK
  `ON DELETE RESTRICT` depuis le tenant, purge RGPD par procédure `service_role` dédiée.
- Les **notes internes ne quittent jamais Iris** (miroir de la règle `internal_notes` du
  Socle) ; le texte de clôture destiné à l'usager est un objet distinct.
- **Deux rôles** (décision PO) : `agent` (instruit, pas de paramètres) et `administrateur`
  (tout : réouverture, archivage, membres). Portés par la garde SQL ET par `statuts.ts`.

## Commandes

```bash
npm run dev      # serveur de dev → http://localhost:5174
npm run build    # tsc -b && vite build
npm run lint     # tsc -b (typecheck du projet, pas d'ESLint)
npm test         # vitest run ; npm run test:watch en veille
```

Prérequis : **Node ≥ 22** (en pratique Node 24 / npm 11 — npm 10 juge le lock désynchronisé).
⚠️ Ne pas redescendre vite en < 6 (vitest 4 l'exige en peer — leçon Socle, juillet 2026).

## Environnement

`.env.local` à la racine (non versionné), modèle dans `.env.example` :

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Le client Supabase (`src/lib/supabase.ts`) **échoue explicitement au démarrage** si l'une des
deux manque (validation pure et testée dans `src/lib/supabaseConfig.ts`).
Projet Supabase : `tqcoqlneybtbrrcvpkpk` (région `eu-west-1` — UE, décision D10). Voir
[`docs/demarrage.md`](docs/demarrage.md) pour les actions manuelles restantes.

## Architecture applicative

- **Routes publiques** (hors shell) : `/login`, `/mot-de-passe-oublie` (placeholder), et une
  route catch-all 404 (`NotFoundPage`) — dette assumée chez Socle, pas répliquée ici.
- **Zone authentifiée** : `ProtectedRoute` › `AppShell` (rail latéral forêt + header), page
  d'accueil `DashboardPage` (placeholder).
- **Le schéma des fondations est appliqué** (miroirs dans `supabase/migrations/`) : tenants,
  membres/rôles, `requests` + satellites, storage privé, **modèle multi-source d'ingestion**
  (`integration_sources`/`integration_credentials`/`integration_api_logs`, registre de sources
  dynamique — aucune logique spécifique à un émetteur).
- **L'API d'ingestion `requests-api` est déployée et vérifiée** (18 + 7 scénarios HTTP bout
  en bout) : contrat OpenAPI **1.1.0** sur `/v1/openapi.json`, guide consommateurs dans
  [`docs/api-ingestion.md`](docs/api-ingestion.md). Périmètre dérivé de la clé (jamais d'un
  header/payload), **démarche obligatoire** (vérifiée dans le cache du tenant, snapshot
  construit côté serveur — dégradé + anomalie si Socle injoignable, jamais un refus), rejeu
  identique → 200, divergent → 409, pièces par URL signée uniquement (`form_field_key` pour
  rattacher une pièce à un champ du formulaire).
  Détail des tables, gardes et policies : [`docs/data-model.md`](docs/data-model.md).
  Tests d'étanchéité : `supabase/tests/fondations.test.sql` (transactionnel annulé,
  15 scénarios). ⚠️ Visibilité par **sous-arbre** Socle différée au miroir
  `socle_organizations` (vague suivante) — les fondations isolent au tenant.
- **`socle-proxy`** (edge, JWT vérifié en code + périmètre : membre du tenant demandé ET
  racine Socle du tenant dans le périmètre **réel** de la clé Socle — introspection
  `/v1/organizations` mémoïsée, 403 sinon) : `POST /v1/procedures/list` (démarches actives du
  tenant), `/v1/procedures/get` (fiche complète : `form_schema`, `requester_config` — jamais
  `knowledge_base`), `/v1/contacts/search`, `/v1/contacts/match` (rapprochement/homonymes),
  `/v1/contacts/get`, `/v1/contacts/create` (via contacts-api Socle uniquement, whitelist
  d'entrée). Réponses **sanitisées par whitelist** (`_shared/sanitize.ts`, pur, testé) :
  `internal_notes`, consentements, relations, `external_references` ne sont **jamais**
  transmis au navigateur ; champs Socle inconnus tolérés (ignorés). `X-Organization-Id`
  toujours dérivé côté serveur.
- `src/types/database.types.ts` est **généré depuis le schéma live** (Supabase MCP
  `generate_typescript_types`) — ne jamais l'éditer à la main, régénérer après chaque migration.
- `supabase/` : `config.toml` (CLI), `migrations/` (fichiers miroirs des migrations
  appliquées), `tests/`, `functions/README.md` (plan des edge functions à venir).

### Pièges connus (hérités de la gamme, à respecter dès la première implémentation)

- **AuthProvider** : quand le chargement du profil sera ajouté, le keyer sur **l'id
  utilisateur**, pas sur l'objet session (supabase-js ré-émet un nouvel objet session à chaque
  retour d'onglet → démontage de la page en cours). Commentaire en place dans
  `src/features/auth/AuthProvider.tsx`.
- **Helpers RLS** (`is_platform_admin`, `is_org_member`, `is_org_admin`,
  `has_socle_org_access`) : `SECURITY DEFINER` obligatoire — en `SECURITY INVOKER`, récursion
  infinie (`stack depth limit exceeded`, HTTP 500). À poser **avant la première table**.
- **Fonctions trigger et RPC de service** : `REVOKE EXECUTE FROM anon, authenticated, PUBLIC`
  dans la **même migration** que leur création, et re-révoquer à chaque `CREATE OR REPLACE`
  (le replace re-grante PUBLIC — piège vécu chez Clara).
- **Policies service** : toujours `TO service_role` explicite — sans le `TO`, la policy
  s'évalue aussi pour `authenticated` (faille documentée chez Clara).
- **Policies storage** : dans une migration versionnée (le `db dump` ne couvre pas le schéma
  `storage` — constat Socle).
- **Test d'étanchéité** dès la première table : cross-tenant ET intra-tenant (deux sous-arbres
  frères).

## Features — détail chargé à la demande

Chaque feature a son `CLAUDE.md` de dossier, chargé automatiquement quand on y travaille ;
les invariants ci-dessus restent la référence.

- **Parcours agent** (`src/features/requests`, `src/features/tenant`) : liste, fiche,
  transitions, **parcours de création guidé** (`creation/`), brouillon local, demandes
  proches, edge function `create-request-from-procedure` et moteur partagé
  `@fn/create-request-from-procedure/_shared/procedureForm.ts` →
  [`src/features/requests/CLAUDE.md`](src/features/requests/CLAUDE.md).
- **Contacts** (`src/features/contacts`) : identification du demandeur via `socle-proxy`
  (homonymes cherchés automatiquement, création, sans rapprochement, anonymat) →
  [`src/features/contacts/CLAUDE.md`](src/features/contacts/CLAUDE.md).
- **Zone superadmin** (`src/features/superadmin`) : organisations (consultation),
  utilisateurs, edge function `admin-users` →
  [`src/features/superadmin/CLAUDE.md`](src/features/superadmin/CLAUDE.md).

## Conventions

- **Organisation par feature** sous `src/features/<domaine>/` (hook `useX.ts`, dialogues,
  pages). Primitives UI génériques dans `src/components/ui/`, layout dans
  `src/components/layout/`.
- **Données serveur = TanStack Query** : un hook `useXxx` par ressource, `queryKey` explicite,
  invalidation dans `onSuccess`. Pas d'appel `supabase` direct dans les composants de page.
- **Logique métier en modules purs testés** (sans DOM ni réseau), y compris la logique des edge
  functions co-localisée dans `_shared/` sans dépendance Deno (le `include` vitest couvre
  `supabase/functions/**`).
- **Design system Notch/Ariane** — source de vérité : le projet Claude Design
  « Ariane Design System » (`019e2566-e3ff-75e7-80a9-af82c9b99671`, accessible via DesignSync).
  Les tokens de `colors_and_type.css` y sont **copiés tels quels** dans `src/index.css`
  (recommandation MUTUALISATION.md §2.1) : primaire vert AA `hsl(153 90% 32%)`
  (+ `--primary-bright` marketing), secondaire beurre, radius 14px, ombres « airbnb »
  (`shadow-airbnb-sm…xl`, alias `iris-*`). **Police : Nunito Sans, seule famille**
  (Google Fonts). Le shell agent calque le **shell de production Clara** : header sticky
  `h-14` (wordmark `src/assets/logo-notch.svg` en `h-6` + séparateur + tenant), **rail vert
  `bg-primary` 52px** (tuiles 36px, icônes Lucide 20px, premier item épinglé, groupe centré) ;
  la zone superadmin garde son rail forêt. Boutons : hover `brightness-105` (pleins) /
  bascule **beurre** (`bg-secondary`) sur outline et ghost, press `scale-[0.98]`, radius 10px
  (idem inputs). `_adherence.oxlintrc.json` (racine) = garde-fou DS (hex bruts, px bruts,
  polices hors DS) — exécutable via `npx oxlint -c _adherence.oxlintrc.json src`.
- Textes et libellés **en français**. Formulaires en `Dialog`, confirmations destructives en
  `AlertDialog`, classes fusionnées avec `cn()`.
- Documentation : un document = un public + une question ; toute évolution de surface de
  contrat (futures API) sera tracée dans un `docs/api-changelog.md` append-only.
