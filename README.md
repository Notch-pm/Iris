# Iris

Système transactionnel des **demandes d'usagers** de la gamme Edilumen, aux côtés de **Socle**
(référentiel central : organisations, démarches, catégories, usagers), **Clara** (gestion du
courrier) et **Ariane**. Une demande est créée dans Iris par un agent, ou ingérée depuis Clara
et des applications partenaires, puis instruite jusqu'à son état final.

Interface en **français**.

## État du projet

**Fondations et premier parcours agent livrés** — le schéma Supabase (tenants, demandes,
journal, RLS, storage, miroir léger du référentiel Socle) est appliqué et testé (voir
[`docs/data-model.md`](docs/data-model.md)) ; l'API d'ingestion multi-source `requests-api`
est déployée ([`docs/api-ingestion.md`](docs/api-ingestion.md)) ; l'interface agent couvre la
liste et la fiche des demandes, leur cycle de vie, et le **parcours de création guidé**
(démarche Socle obligatoire → usager rapproché au Socle → formulaire paramétré →
récapitulatif, avec brouillon local, détection des demandes proches et récépissé) ; une zone
superadmin gère organisations et utilisateurs. Restent à venir : visibilité par sous-arbre
d'organisation, copie asynchrone des pièces ingérées, webhooks sortants, purge RGPD et la base
de connaissances des procédures. L'architecture validée est décrite dans
[`docs/architecture-proposee.md`](docs/architecture-proposee.md).

## Démarrer

Prérequis : **Node ≥ 22** (en pratique Node 24 / npm 11, comme le reste de la gamme).

```bash
npm install
cp .env.example .env.local   # puis renseigner les valeurs (voir docs/demarrage.md)
npm run dev                  # http://localhost:5174
```

Les actions manuelles nécessaires (création du projet Supabase, variables front, secrets
serveur) sont détaillées dans [`docs/demarrage.md`](docs/demarrage.md).

## Commandes

```bash
npm run dev      # serveur de dev → http://localhost:5174
npm run build    # tsc -b && vite build
npm run lint     # tsc -b (typecheck strict du projet)
npm test         # vitest run ; npm run test:watch en veille
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — règles de développement, invariants, pièges (lecture obligatoire) ;
  le détail de chaque feature vit dans `src/features/<feature>/CLAUDE.md`.
- [`AGENTS.md`](AGENTS.md) — pointeur pour les agents IA.
- [`supabase/functions/README.md`](supabase/functions/README.md) — plan et état des edge
  functions (ingestion, proxy Socle, création guidée, superadmin, sync).
- [`docs/architecture-proposee.md`](docs/architecture-proposee.md) — architecture validée :
  modèle de données, frontières Socle/Iris/Clara, cycle de vie, RLS, contrats d'intégration.
- [`docs/data-model.md`](docs/data-model.md) — schéma appliqué : tables, gardes SQL,
  policies RLS, storage, tests d'étanchéité.
- [`docs/api-ingestion.md`](docs/api-ingestion.md) — API d'ingestion multi-source : comment
  un connecteur Clara, un portail citoyen ou un tiers s'authentifie et crée des demandes.
- [`docs/demarrage.md`](docs/demarrage.md) — mise en route et actions manuelles.
- Socle : `../Socle/docs/integration.md` — guide des équipes consommatrices des API Socle.
