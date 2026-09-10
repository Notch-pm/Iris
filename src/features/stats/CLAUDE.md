# Statistiques (`src/features/stats`)

Route `/statistiques`, entrée de rail (icône Lucide `BarChart3`), **bureau seul** — les
graphiques ne font pas partie des huit écrans mobiles validés. Livrée le 2026-09-18.

## Ce que l'écran doit à Clara — et ce qu'il ne lui doit pas

Décision PO : **même bibliothèque, même rendu** que `StatistiquesPage` de Clara. Donc
**ApexCharts** (`apexcharts@3.54.1`, le moteur de Clara ; le wrapper `react-apexcharts@1.5.0`
est le dernier dont la dépendance de pair accepte ApexCharts 3 — Clara tourne 1.9.0 sous bun,
qui ignore ce conflit), `chartConfig.ts` **recopié** (palette hexadécimale brute : exception
assumée au garde-fou DS, ApexCharts ne lit pas les tokens CSS), cartes KPI, grille
`lg:grid-cols-2`, filtres organisme + période 7 j / 30 j / 1 an. Pas de `date-fns` chez Iris :
les mois se libellent avec `Intl.DateTimeFormat("fr-FR")` dans `stats.ts`.

Ce qui diffère est de fond, pas de forme :

- **Les chiffres ne viennent jamais de `requests`.** Ils sont lus dans deux **tables de
  faits** (`request_stats`, `intervention_stats`) sans donnée d'usager, sans FK vers la
  demande, **insensibles à la future purge RGPD** — détail dans
  [`docs/data-model.md`](../../../docs/data-model.md) § « Statistiques ».
- **Ouvert à tout membre, borné par ses droits.** Les huit RPC `stats_*` sont SECURITY
  INVOKER : le RLS des tables de faits reprend le prédicat de consultation par couple de
  `requests_select`. Pas de garde de rail, pas de garde d'écran : un administrateur sans droit
  de consultation voit des graphiques vides, et c'est juste — l'administration n'accorde aucun
  droit sur les demandes. Clara, elle, cache l'entrée au rôle « gestionnaire ».

## Les indicateurs et leur définition

| Indicateur | Source | Définition |
|---|---|---|
| Demandes reçues (KPI, par mois) | `stats_requests_by_source`, `stats_requests_by_month` | `received_at` dans la période (décision PO : la date d'origine, pas l'entrée dans Iris) |
| Par canal de réception | `stats_requests_by_source` + `groupBySourceIntoCanal` | quatre canaux fixes, ordre fixe, zéros affichés : `portail-citoyen` → Portail usagers, `clara` → Gestion de courrier, `iris` → Création directe, tout autre code → Partenaires (API) |
| Par organisme | `stats_requests_by_organization` | organisme **porteur** (`socle_scope_org_id`, suit les transferts), libellé relu dans le miroir |
| Délais par organisme | `stats_processing_times` | jours, 1 décimale : réception → **première** instruction ; réception → résolution (`resolue_*` seulement, une annulation n'est pas une résolution) |
| Taux de résolution positive | `stats_outcomes` + `positiveResolutionRate` | positives / closes (positives + négatives + annulées) ; `null` → « — » tant que rien n'est clos |
| Agents ayant le plus instruit | `stats_top_resolvers` | **l'auteur de la résolution** (`resolved_by`, posé quand le statut passe à `resolue_*`) — décision PO, plutôt que l'affecté ou l'auteur de la prise en charge |
| Interventions réalisées, délai de clôture | `stats_interventions` | réalisées = `completed_at` dans la période ; délai = sollicitation → réalisation |
| Intervenants les plus actifs | `stats_top_intervenants` | réalisations dans la période |

## Fichiers

- `stats.ts` / `stats.test.ts` — pur : période, canaux, taux, libellés.
- `useStats.ts` — un hook TanStack par RPC (`["stats", <nom>, orgId, socleOrgId, sinceISO]`).
  L'appel passe par un `rpc` typé en `string` (motif Clara) : le hook ne dépend pas du
  fichier généré, qui reçoit les signatures à la régénération suivant la migration.
- `StatsFilters.tsx`, `charts/` (`ChartCard` commun : titre, squelette, état vide ; un
  composant par graphique, `TopAgentsChart` sert aux deux classements),
  `StatistiquesPage.tsx` (`useWideLayout`).
- ⚠️ `charts/ReactApexChart.ts` — **seul** point d'import du composant. Le wrapper 1.5.0 est
  publié en CommonJS et, en dev Vite, `import X from "react-apexcharts"` rend l'objet
  `{ default }` et non le composant (« type is invalid … got: object », vu le 2026-09-18) ;
  le module déballe une fois pour toutes. Ne jamais importer `react-apexcharts` ailleurs.
- Base : `supabase/migrations/20260918100000_statistiques.sql`, test
  `supabase/tests/statistiques.test.sql`.
