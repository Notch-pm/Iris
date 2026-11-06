# Liste des demandes : hooks, pages, tri, export

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **`useRequests.ts`** : hooks TanStack Query (liste paginée `range`+`count`, facettes, fiche,
  satellites, membres du tenant) + mutations (transition via `buildTransitionUpdate`,
  affectation, notes, liaison `useLinkRequests`). Pas d'appel `supabase` direct dans les
  pages.
- ⚠️ **Vocabulaire d'écran : « Organisme »** (décision du 2026-08-30). L'organisation Socle
  qui a reçu et traite la demande s'appelle **Organisme** partout où un agent la lit sur la
  liste et sur le tableau — filtre, colonne, regroupement, export CSV, carte du tableau, et
  la valeur de repli « Sans organisme ». Les **clés** de code restent `destinataire` /
  `destinataires` / `NO_DESTINATAIRE` : elles ne s'affichent pas, elles circulent (état
  d'écran, `?destinataire=` de la liste), et les renommer casserait les liens existants. Un
  test de `listing.test.ts` fige le libellé. ⚠️ La variable d'e-mail
  `{{demande.destinataire}}` ne se renomme PAS non plus : son catalogue est FIGÉ, avec
  jumeau SQL et garde serveur `t03`.
- **Pages** : `RequestsListPage` (recherche par objet/référence et filtres MULTIPLES
  statut/organisme/démarche/priorité/source dans le popover « Filtres », rappelés en chips, pagination 20, filtre
  initial depuis `?status=`, bouton « Nouvelle demande » → `/demandes/nouvelle` — maquette
  « Liste — en-tête compacté », cf. « Liste : tri, regroupement, export » plus bas), le
  **tableau des demandes** `/demandes/tableau` et la **fiche
  d'instruction** ci-dessous. Les trois vues d'une même sélection — liste, tableau, carte —
  ont chacune leur **entrée de rail** (le tableau juste au-dessus de la liste) et se
  renvoient l'une à l'autre par des boutons d'en-tête.
  ⚠️ Deux entrées partagent désormais le préfixe `/demandes` : l'activation du rail ne peut
  plus venir de `NavLink` (qui allumerait les deux sur `/demandes/tableau`, `aria-current`
  compris, sans laisser l'appelant le contredire). Elle vient de
  `src/components/layout/nav.ts` — `isNavRouteActive`, pur et testé, avec la liste `except`
  des sous-chemins qui ont leur propre entrée. **Toute future route sous une entrée
  existante se déclare là.**

- **Échéance : filtre et colonne** (2026-11-06, B16 — PO du jour). Critère **« Échéance »**
  du popover, deux valeurs : « En retard » et « Urgentes (3 jours ou moins) » — ⚠️ à ne pas
  confondre avec la PRIORITÉ « Urgente », saisie par un agent. Demandes **ouvertes**
  seulement (une demande close n'est plus en retard), combiné en ET aux autres critères ;
  bornes en minuit local par `dueRange` (`echeance.ts`, pur, testé, partagé avec le tableau et la carte), mêmes seuils que la pastille `dueView`
  de la fiche ; appliqué côté serveur par `lt`/`gte` sur `due_at` (pas de second `or`, la
  recherche en porte déjà un). Colonne **« Échéance »** triable (`due_at`, de la plus proche à
  la plus lointaine) : la pastille de la fiche, mêmes jetons, tant que la demande est ouverte ;
  la date seule une fois close.

- **Résolution groupée d'une sélection** (2026-11-04, B7 du backlog — décision PO du jour :
  la règle des groupes « même incident » s'étend à toute sélection). Module pur
  `resolution/batch.ts` (testé), dialogue `resolution/BatchResolutionDialog.tsx`, RPC
  `resolve_requests` (migration `20261104100000`, test
  [`resolution-groupee.test.sql`](../../supabase/tests/resolution-groupee.test.sql)).
  - **Qui voit les cases** : un agent qui détient la `clôture` quelque part
    (`hasCloseRightSomewhere`, reflet). Une case par ligne, une case « toute la page »
    (état intermédiaire), barre « N sélectionnées · Désélectionner · Résoudre la sélection ».
    La sélection **survit** aux pages et aux filtres ; le dialogue liste tout ce qui est coché.
    **50 au plus** (`BATCH_MAX_SIZE`, jumeau de `request_batch_max_size()`) : au-delà, la coche
    est refusée et dite, plutôt que le lot échoue au serveur.
  - **Le dialogue** : issue (positive / négative, motif facultatif pour la négative —
    irrecevable / réorientation), commentaire pour l'usager repris pour toutes, puis, demande
    par demande, ce qui va se passer (`batchForecast` : « à traiter : mise en instruction puis
    résolue », « vous en deviendrez l'instructeur », « issue de Clara : aucun avis ») et les
    **refus prévisibles**, qui ne partent pas au serveur (déjà close, pas de clôture, pas
    d'instruction alors qu'il faut instruire). « Prévenir les usagers » est **décoché par
    défaut** ; coché, l'avis de clôture de chaque demande résolue part par
    `send-request-email` (Clara exclue, sans adresse comptée à part).
  - **Résultat partiel et honnête** : refus du serveur (t17 — pièce obligatoire non conforme,
    garde, RLS) et refus prévisibles comptent ensemble — l'agent a coché N demandes, il lit
    « 7 demandes résolues sur 9 » et le motif de chacune. Les demandes résolues quittent la
    sélection ; les autres y restent.
  - ⚠️ **Ni le tableau ni le mobile** (choix PO du 2026-11-04 : liste seulement). ⚠️ Les droits
    viennent de `socle_scope_org_id`, ajouté à `LIST_SELECT` et **facultatif** dans
    `RequestListItem` (les autres écrans qui partagent le type ne le lisent pas) : absent,
    aucun droit — fail closed. ⚠️ L'icône lucide `Map` est importée en `MapIcon` dans
    `RequestsListPage` : sous son nom, elle masquait le `Map` de JavaScript.

- **Liste : tri, regroupement, export** (2026-08-22, motif des listes Clara) — logique pure
  `listing.ts` (testée) : **tri serveur** par colonne (référence = année puis numéro ; dates du
  plus récent d'abord ; jamais de retour à « non trié » ; la priorité n'est pas triable —
  ordre alphabétique trompeur), **« Grouper par »** statut / organisme / démarche /
  priorité / source (regroupement client de la page courante, avec pré-tri serveur sur la
  clé de groupe pour des groupes contigus entre pages ; groupes repliables), **export CSV**
  de TOUTE la sélection filtrée dans l'ordre affiché (`fetchRequestsForExport`, lots de 1000,
  borné à 5000 lignes — tronçon signalé ; `src/lib/csv.ts` : `;`, BOM UTF-8 Excel FR).
  En-tête triable `src/components/ui/sortable-header.tsx` (+ `aria-sort`).
  - **En-tête compacté** (2026-09-11, maquette Claude Design « Liste Courriers —
    Proposition », projet `44db0c7a`) : la page est en **pleine hauteur**
    (`useFullBleedLayout`). Une **seule barre collante de 56 px** porte le titre, le compteur,
    « Grouper » (menu radio), « Filtres » (popover à cases avec pastille du nombre de
    critères), la **densité** (48 px / 36 px, mémorisée sur l'appareil — non critique), les
    liens Tableau et Carte, l'export CSV et le CTA. La **recherche par objet** est le premier
    critère du popover « Filtrer les demandes » (retour PO du 2026-09-11 — elle était centrée
    dans la barre) : focalisée à l'ouverture, comptée dans la pastille, rappelée en chip une
    fois le panneau fermé. ⚠️ Son `onKeyDown` bloque le défaut d'Échap : dans Chrome, Échap
    VIDE un `<input type="search">` en plus de fermer le popover — la recherche disparaissait
    au moment où l'agent refermait le panneau pour lire les résultats (vérifié dans
    Chrome 152). Les critères actifs se rappellent en **chips supprimables** sous la barre
    (« Tout effacer »).
    L'**en-tête du tableau est figé** (`sticky`), les en-têtes de groupe aussi, seules les
    lignes défilent ; le pied porte la pagination **numérotée** (`pageWindow`, 7 entrées au
    plus) et « x–y sur N demandes ». Ligne : référence en mono, objet sur deux niveaux (objet
    + démarche), statut en **point + libellé** (`StatusBadge variant="dot"`), date tabulaire
    à droite, ligne entière cliquable.
  - **Filtres multiples** : `RequestFilters` porte des TABLEAUX (`.in()` serveur, vide =
    tout) et `q`, la recherche ; les modules purs `toggleFilterValue`, `filterChips`,
    `removeFilterChip`, `activeFilterCount` vivent dans `listing.ts` (testés).
  - ⚠️ **La recherche de la liste est sensible aux accents** (`searchClause` : clause
    PostgREST `or=(subject.ilike…,reference.ilike…)`, jokers LIKE neutralisés, valeur citée),
    contrairement à la recherche globale du header qui passe par la RPC `search_requests`
    et `unaccent`. PostgREST ne sait pas appliquer une fonction à la valeur cherchée, et un
    jumeau JavaScript d'`unaccent` est exclu (migration `20260901130000`) : le jour où cela
    gêne, la porte est une RPC de liste, pas un repli client. Deux caractères minimum,
    temporisation de 300 ms.
