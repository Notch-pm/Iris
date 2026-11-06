# Tableau de bord (`src/features/dashboard`, page `src/pages/DashboardPage.tsx`)

Page d'accueil de la zone authentifiée (route `/`, entrée de rail « maison »). Livrée le
2026-09-19 sur le motif de l'accueil de Clara (`clara-mailflow-hub/src/pages/Dashboard.tsx`),
décision PO. Le mobile garde son propre accueil (`MobileHome`).

## Ce que la page montre

1. **Six cartes d'indicateurs** (grille 2 puis 3 colonnes, motif Clara : titre discret +
   icône, valeur 3xl, sous-titre) : demandes **reçues**, **mises en instruction**,
   **instruites**, et leur équivalent **M−1**. Le sous-titre du mois courant porte la
   variation relative (« +25 % vs M−1 », « = », « — » sans base).
   **Deux cartes d'échéance** (B16, 2026-11-06) closent chaque rangée — grille de 4 colonnes
   en grand écran : « Échéance dépassée » après les trois flux du mois, « Échéance
   approchante » (3 jours ou moins) après ceux de M−1. ⚠️ Ce sont des **STOCKS à l'instant**
   (demandes EN COURS, `useDueCount`, `count` en `head`), pas des flux : pas de M−1, pas de
   variation. Mêmes bornes que le filtre de la liste (`dueRange`, `features/requests/
   echeance.ts`), vers laquelle chaque carte renvoie (`/demandes?due=late|soon`) : le chiffre
   et la liste filtrée disent la même chose. `KpiCard monthSub={false}` : le sous-titre est une
   phrase, pas un mois à capitaliser.
2. **Deux colonnes** : « En attente d'instruction » (statut `a_traiter`, les plus anciennes
   d'abord — elles attendent) et « Mes demandes » (affectées à l'utilisateur, statuts
   ouverts, avec la pastille de statut). Vingt lignes, compteur total en badge, « Voir
   toutes → » au-delà, vers la liste filtrée (`/demandes?status=…`). Chaque ligne porte une
   **mention d'échéance** (B16) quand la demande est en retard ou à 3 jours ou moins — la
   pastille de la fiche, rien pour une échéance lointaine. Et sa **priorité** (2026-11-06,
   PO), comme sur la carte du tableau : un **liseré** coloré à gauche (`pinColor`, mêmes
   couleurs que le tableau et la carte des interventions, libellé en `title` et en
   `sr-only`), plus une pastille « Haute » / « Urgente » quand elle est élevée — « Normale »
   et « Basse » n'ont que le liseré. ⚠️ La `section` d'une liste porte
   `min-w-0` : sans lui, l'élément de grille prenait la largeur du plus long objet et la
   mention sortait de l'écran sur une colonne unique.

## Définitions — à ne pas réinterpréter

- Les trois indicateurs sont des **FLUX datés par leur jalon**, pas des stocks : reçue =
  `received_at`, mise en instruction = `instruction_started_at` (première entrée), instruite
  = `resolved_at` avec issue `resolue_*`. C'est ce qui rend M−1 comparable — un stock « en
  cours d'instruction » n'a pas d'équivalent au mois précédent sans historique. La RPC
  `stats_monthly_flows` (SECURITY INVOKER, faits `request_stats` insensibles à la purge) les
  rend par mois, Europe/Paris.
- **Périmètre = « l'ensemble des organisations auxquelles l'utilisateur a accès »**, c'est-à-
  dire ce que le RLS laisse lire (consultation par couple). Aucun filtre d'organisme sur
  l'accueil ; un administrateur sans droit de consultation voit des zéros et des listes vides,
  et c'est juste.
- Le mois courant se calcule côté navigateur (`monthKeyOf`, heure locale) et se rapproche des
  clés rendues par le serveur (Europe/Paris) ; un mois absent vaut zéro, jamais une erreur
  (`pickMonthPair`).

## Fichiers

- `dashboard.ts` / `dashboard.test.ts` — pur : clés de mois, libellés, appariement M / M−1,
  variation.
- `useDashboard.ts` — `useMonthlyFlows` (RPC), `useAwaitingRequests`, `useMyAssignedRequests`
  (même projection `RequestListItem` que la liste : mêmes colonnes, même fiche à l'arrivée).
- La page conserve l'écran « Aucun droit attribué » (RM-45) et l'attente de `my_rights`.
- **Gabarit large** (`useWideLayout`), comme la liste des demandes et les statistiques :
  la colonne centrée par défaut (1240 px) paraissait étroite sur un grand écran (retour PO
  2026-09-19).
- Base : `supabase/migrations/20260919100000_dashboard_flux_mensuels.sql`, scénario S9n/S9o de
  `supabase/tests/statistiques.test.sql`.
