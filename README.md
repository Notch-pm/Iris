# Iris

Système transactionnel des **demandes d'usagers** de la gamme Edilumen, aux côtés de **Socle**
(référentiel central : organisations, démarches, catégories, usagers), **Clara** (gestion du
courrier) et **Ariane**. Une demande est créée dans Iris par un agent, ou ingérée depuis Clara
et des applications partenaires, puis instruite jusqu'à son état final.

Interface en **français**.

## État du projet

**Fondations en place, interface à venir** — le schéma Supabase (tenants, demandes,
journal, RLS, storage) est appliqué et testé (voir [`docs/data-model.md`](docs/data-model.md)),
mais aucune interface métier ni intégration n'est encore construite. L'architecture validée
est décrite dans [`docs/architecture-proposee.md`](docs/architecture-proposee.md).

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

- [`CLAUDE.md`](CLAUDE.md) — règles de développement, invariants, pièges (lecture obligatoire).
- [`AGENTS.md`](AGENTS.md) — pointeur pour les agents IA.
- [`docs/architecture-proposee.md`](docs/architecture-proposee.md) — architecture validée :
  modèle de données, frontières Socle/Iris/Clara, cycle de vie, RLS, contrats d'intégration.
- [`docs/data-model.md`](docs/data-model.md) — schéma appliqué : tables, gardes SQL,
  policies RLS, storage, tests d'étanchéité.
- [`docs/api-ingestion.md`](docs/api-ingestion.md) — API d'ingestion multi-source : comment
  un connecteur Clara, un portail citoyen ou un tiers s'authentifie et crée des demandes.
- [`docs/demarrage.md`](docs/demarrage.md) — mise en route et actions manuelles.
- Socle : `../Socle/docs/integration.md` — guide des équipes consommatrices des API Socle.
