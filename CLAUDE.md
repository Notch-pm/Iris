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

## Stack

- **Vite 8** + **React 18** + **TypeScript** (strict)
- **React Router 6** (routing), **TanStack Query 5** (données serveur)
- **Supabase** (Postgres + Auth + RLS) via `@supabase/supabase-js`
- **Tailwind CSS 3** + primitives **Radix UI** (composants maison façon shadcn dans
  `src/components/ui`, repris du Socle)
- **Vitest** (logique pure, environnement Node pour l'instant)

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

## Feature : parcours agent (`src/features/requests`, `src/features/tenant`)

Premier parcours applicatif, livré et **vérifié en navigateur réel** (2026-08-20) : connexion →
sélection du tenant → liste filtrée/paginée → création manuelle → fiche → prise en charge →
note interne → résolution avec texte de clôture → journal.

- **`TenantProvider`** (`features/tenant/`) : appartenances de l'utilisateur
  (`organization_members` + `organizations`), tenant courant persisté en localStorage,
  sélecteur dans le header d'`AppShell` (masqué si un seul tenant), rôle affiché en badge.
- **`statuts.ts`** (pur, testé) : libellés FR des 7 statuts/motifs/priorités et
  **`allowedTransitions(status, role)`** — miroir EXACT de la garde SQL
  `requests_guard_transition` (exigences : assigné, texte de clôture, motifs ; portes :
  réouverture superviseur+, archivage/désarchivage admin ; lecteur = rien). ⚠️ Ce module ne
  protège rien : il reflète ce que le trigger acceptera. Toute évolution de la matrice SQL se
  répercute ICI et dans `statuts.test.ts`.
- **`facets.ts`** (pur, testé) : facettes destinataire/démarche/source déduites des demandes
  existantes du tenant — catalogue provisoire jusqu'à la sync du référentiel Socle.
- **Parcours de création guidé** (`features/requests/creation/`, page `/demandes/nouvelle`,
  vérifié en navigateur le 2026-08-20) : l'ancien dialogue générique est SUPPRIMÉ — plus
  aucun INSERT direct de demande depuis le navigateur. Cinq étapes : démarche Socle active
  (obligatoire, cache du tenant) → organisation destinataire (miroir, pré-remplie par la
  démarche) → demandeur (feature `contacts`) → formulaire (`form_schema` : sections, choix,
  conditions visibleIf/requiredIf, pièces avec formats/cardinalités ; `requester_config`
  respecté) → récapitulatif → **edge function `create-request-from-procedure`**.
  - **Moteur partagé** `@fn/create-request-from-procedure/_shared/procedureForm.ts` (pur,
    testé, miroir EXACT du contrat Socle formSchema v1/conditions/requesterFields) : rendu et
    validation de confort côté client, validation d'AUTORITÉ côté serveur sur la démarche
    **rechargée depuis Socle**. Clé de `form_data` = clé machine `key` (repli sur l'id si
    vide). Alias `@fn` → `supabase/functions/` (vite + tsconfig).
  - **`create-request-from-procedure`** (edge, JWT + rôle agent/administrateur en code, CORS
    allowlist) : cache du tenant = périmètre, démarche rechargée depuis Socle (503/502 si
    injoignable — contrairement à l'ingestion, jamais refusée), snapshots construits côté
    serveur (toute clé `procedure_snapshot`/inconnue dans le payload → 400), contact
    rapproché **relu depuis contacts-api** (identité de vérité), écriture ATOMIQUE via la
    RPC `create_request_from_procedure` (demande + pièces + événement
    `request_created_from_procedure`, attribution à l'agent — tout ou rien). Pièces :
    uploadées par le navigateur sur `{org}/{draftId}/…` AVANT l'appel (policy storage sur le
    1er segment), déclarées ensuite (chemin vérifié préfixé au brouillon).
- **`useRequests.ts`** : hooks TanStack Query (liste paginée `range`+`count`, facettes, fiche,
  satellites, membres du tenant) + mutations (création, transition via
  `buildTransitionUpdate`, affectation, notes). Pas d'appel `supabase` direct dans les pages.
- **Pages** : `RequestsListPage` (filtres statut/destinataire/démarche/priorité/source,
  pagination 20, dialogue `NewRequestDialog`), `RequestDetailPage` (snapshot, pièces avec URL
  signée, liens externes, affectation + historique, messages internes — « ne quittent jamais
  Iris » —, journal `request_events` en lecture seule), `TransitionActions` (boutons + dialogue
  motif/texte/assigné).
- RLS = source de vérité : l'UI ne masque les actions que par confort ; toute erreur de garde
  SQL est affichée telle quelle.

## Feature : contacts (`src/features/contacts`)

Identification du demandeur auprès du référentiel d'usagers Socle — **aucun miroir local**,
tout passe par `socle-proxy` (mutations TanStack sans cache). Vérifiée en navigateur le
2026-08-20 dans le parcours de création.

- **`rapprochement.ts`** (pur, testé) : critères de recherche (nom, prénom, date de
  naissance, e-mail, téléphone — refus sans discriminant), résumé des candidats (seules
  informations distinctives), libellés FR des raisons de rapprochement (raison inconnue
  affichée telle quelle), `isNameOnlyMatch` (**jamais de rapprochement sur le seul nom** —
  signalé « à vérifier », aucune sélection automatique), payload de création whitelisted,
  `duplicateCheckIdentity` (rejeu anti-doublon JUSTE avant création), résolutions
  `contact | sans_rapprochement | anonyme`.
- **`RequesterIdentification`** : publics selon `requester_config` (champs
  masqué/visible/obligatoire respectés), recherche → candidats (score + raisons, choix
  explicite forcé), création d'usager via contacts-api (doublon potentiel affiché : utiliser
  le candidat ou « créer quand même »), « poursuivre sans rapprochement » derrière une case
  d'assomption explicite, **dépôt anonyme uniquement si la démarche ne rend aucune identité
  obligatoire** (`allowsAnonymous` du moteur partagé).
- Le `requester_snapshot` est construit CÔTÉ SERVEUR au dépôt (contact rapproché relu depuis
  Socle) — la résolution ne transporte que le choix de l'agent. `internal_notes` n'existe
  nulle part côté Iris (sanitisation proxy + whitelists).

## Feature : zone superadmin (`src/features/superadmin`)

Zone à shell séparé (motif Socle/Clara), réservée aux **admins plateforme**
(`users.is_platform_admin`, garde `SuperAdminRoute` ; lien « Superadmin » dans le rail de
l'app pour les seuls admins plateforme — pas de redirection forcée, contrairement à Socle).
Vérifiée au navigateur le 2026-08-20 (arbre, création/rattachement/suppression d'utilisateur).

- **Organisations** (`/superadmin`) : une carte par tenant, arbre du miroir Socle
  (ergonomie Clara `SocleOrganizationTree` : tout déplié, chevrons, badge Obsolète) —
  **consultation uniquement, la hiérarchie se gère dans le Socle** ; dernière sync affichée.
  Logique d'arbre pure `socleOrgTree.ts` (testée).
- **Utilisateurs** (`/superadmin/utilisateurs`) : recherche, table (nom, email, badge Admin
  plateforme, rattachements par tenant), création (mot de passe généré **affiché une seule
  fois**), édition (noms, statut plateforme — verrouillé sur soi-même —, accès par tenant
  appliqués immédiatement), réinitialisation de mot de passe, suppression (confirmée,
  interdite sur soi-même).
- **Deux rôles** (décision PO) : `agent` (instruit, pas de paramètres) et `administrateur`
  (tout : réouverture, archivage, membres). Portés par la garde SQL ET par `statuts.ts`.
- **`admin-users`** (edge, JWT + is_platform_admin vérifiés en code, CORS allowlist) : seules
  les opérations service_role y passent — `create_user`, `set_password`, `delete_user`.
  Tout le reste (lecture, profils, appartenances) passe par le RLS.

## Conventions

- **Alias d'import** `@/` → `src/` (voir `vite.config.ts`).
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
