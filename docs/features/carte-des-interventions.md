# Carte des interventions

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Carte des interventions** (`features/requests/carte/`, route `/carte`, entrée de rail
  dédiée + bouton « Carte » de la liste, 2026-08-23) : les demandes **en cours**
  (`OPEN_STATUSES` = `a_traiter`/`en_instruction`/`en_attente`) dont la démarche porte un lieu
  d'intervention, posées sur une carte OpenStreetMap.
  - **Cadrage sur le TERRITOIRE** (2026-08-31, arbitrage PO de l'entrée B1 du backlog) : la
    carte s'ouvre sur l'**étendue des quartiers** publiés par le Socle — tout le découpage
    tient dans le cadre, et rien d'autre ne le décide (`quartiersBounds` dans
    `src/lib/quartiers.ts` + `fitBox` dans `src/lib/carto.ts`, purs et testés). Les épingles
    n'entrent PAS dans ce calcul : une demande égarée à 600 km n'élargit plus la vue, et
    cocher un filtre ne renvoie plus l'agent au cadre initial (`frameKey` : le cadre ne se
    refait que quand le CADRE change, pas quand la sélection change).
    - **Repli, dans cet ordre**, quand le référentiel ne publie pas de quartiers : le
      **siège** de la collectivité (`socle-proxy /v1/organizations/root`, géocodé à la BAN —
      `useOrganisationAnchor` ; `fitAround` impose le centre et n'ajuste que le zoom, mesuré
      **en symétrique** autour de lui) ; puis les **épingles seules** (`fitBounds`, le
      cadrage d'origine — celui qui plantait le centre en **Corrèze** pour une demande à
      Nantes et le reste autour d'Arles).
      ⚠️ Ne PAS « corriger » `fitBounds` en remplaçant son centre : son zoom est calculé pour
      SON centre, le déplacer pousse hors cadre les points d'en face. C'est tout l'objet de
      `fitAround`.
    - **Deux planchers de zoom, à ne pas confondre.** `MIN_ZOOM` (**4**, l'échelle d'un
      continent) borne ce que l'AGENT peut demander à la molette : c'est ce qui rend enfin
      atteignable une demande hors territoire. `TERRITORY_ZOOM` (12, l'ancien `MIN_ZOOM`)
      borne ce que la carte s'accorde TOUTE SEULE à partir de ses épingles, pour qu'une
      épingle lointaine n'ouvre pas la vue sur l'Europe. Le cadrage sur le territoire, lui,
      descend jusqu'à `MIN_ZOOM` : une intercommunalité (ACCM fait 60 km d'est en ouest) ne
      tient pas dans un écran au zoom 12.
    - ⚠️ **Ne rien cadrer tant qu'on ne sait pas** (`framePending`) : `useQuartiers` et
      `useOrganisationAnchor` distinguent « pas de quartiers / pas de siège » de « pas encore
      répondu ». Sans cette distinction, la carte se posait d'abord sur ses épingles — en
      Corrèze — puis sautait sur le territoire une seconde plus tard, sous les yeux de
      l'agent. Mieux vaut une carte qui arrive un peu après qu'une carte qui arrive fausse.
    - ⚠️ Le cadrage suit le territoire même quand les limites ne sont pas **dessinées**
      (bascule « Afficher les quartiers ») : basculer l'affichage ne déplace pas la carte.
    - ⚠️ **Un confort, jamais une dépendance** : route absente, Socle muet, pas d'adresse de
      siège ⇒ on descend d'un cran dans le repli, jamais une erreur. Iris ne stocke ni la
      géométrie, ni l'adresse, ni aucun point qu'il aurait calculé (le point DÉCLARÉ par
      l'usager, lui, est une réponse du formulaire — voir « Lieu d'intervention »).
    - **Ce qui reste ouvert** (question de fond de B1, jamais tranchée) : une demande **hors
      territoire** reste hors du cadre initial — elle s'atteint en reculant. Est-ce un
      cadrage à élargir, ou une **anomalie à signaler** ?
  - **`carte.ts`** (pur, testé) : `locatableRequests` (réutilise `instruction/lieu.ts` — même
    reconnaissance du bloc Socle), `distinctAddresses` (une adresse = un géocodage, quelles
    que soient les demandes qui la partagent), `filterRequests` / `procedureFacets` /
    `priorityCounts`, `spreadByPoint` (anneaux : deux demandes à la même adresse ne se
    superposent pas), `cardAnchor` (fiche de survol maintenue dans le cadre, basculée à
    gauche près du bord), `mapCard` (l'essentiel de la demande) et `locationHint` (le
    géocodeur rend TOUJOURS un candidat : réserve affichée dès que le point n'est pas un
    numéro sûr — jamais de point masqué pour autant).
  - ⚠️ **Piège vécu (2026-08-23)** : la clé de requête TanStack du géocodage en masse ne doit
    PAS être indexée sur les seules adresses manquantes. Le cache de session se remplissant
    dans le `queryFn`, la clé changeait au retour du service : la réponse atterrissait sur une
    entrée que plus personne n'observait, `dataUpdatedAt` du nouveau cache repartait à zéro,
    le mémo des points ne se recalculait jamais — la carte annonçait « aucune adresse
    localisée » alors que la BAN avait répondu 200 avec le bon point. La clé porte donc
    TOUTES les adresses (`geocodeBatchPlan`, pur et testé) ; seul le contenu du lot envoyé
    dépend du cache. Règle générale : **une clé de requête ne se dérive jamais d'un cache que
    la requête elle-même remplit.**
  - **Données** (`useMapRequests.ts`) : 500 demandes les plus récentes (`MAP_MAX_ROWS`,
    troncature signalée), sélection allégée `procedure_snapshot->form_schema` (le snapshot
    entier × 500 pèserait pour rien), puis **géocodage en masse** en UNE requête (endpoint
    CSV de la BAN) avec cache de session — un appel unitaire par demande saturerait le
    service. Aucun point calculé n'est stocké côté Iris ; une demande déposée **avec** un
    point (champ `location`) est située par lui et ne part pas au lot.
  - **`InterventionMap.tsx`** : `TileLayer` (brique partagée avec la fiche), épingles
    **colorées par urgence** (jaune `normale` → orange `haute` → rouge `urgente`, gris
    `basse` : sans urgence particulière), survol/focus → fiche (référence, statut, objet,
    adresse, usager, dépôt, urgence, démarche, catégorie, destinataire, agent instructeur,
    « Ouvrir la fiche »), clic = fiche épinglée, Échap ferme. Déplacement à la souris, zoom
    molette (listener non passif — sinon la roue est ignorée) et boutons, « Recadrer ».
    **Molette** (retour PO 2026-09-19, `wheelSteps` / `wheelDeltaPixels` / `zoomAround` dans
    `carto.ts`, purs et testés) : **un cran par 100 px de défilement cumulés** — un pavé
    tactile envoie des dizaines de micro-événements par geste et chacun valait un niveau
    entier, d'où des sauts de 3 ou 4 niveaux — et le zoom se fait **autour du curseur** :
    le point géographique sous la souris y reste. Le zoom reste entier (les tuiles OSM
    n'existent qu'à des niveaux entiers) ; un zoom fractionnaire demanderait de mettre la
    mosaïque à l'échelle entre deux niveaux — pas fait.
    Recadrage automatique à l'arrivée des points et à chaque changement de filtre.
  - **Filtres** : démarches en **multi-sélection** (menu à cases, volumes) et urgences en
    pastilles colorées — la légende EST le filtre, puisque la couleur porte l'urgence.
  - **Résolues récemment** (retour PO 2026-09-19) : la carte charge aussi les demandes
    **résolues** (`resolue_positive` / `resolue_negative` — jamais une annulée, qui n'a pas
    eu lieu) dont `closed_at` a moins de **30 jours** (`RESOLVED_STATUSES`,
    `recentResolvedSince`, requête `.or(...)` de `useOpenRequestsForMap`, borne figée au
    montage et dans la clé). Elles sont **grises** (`pinColor(priority, resolved)`), visibles
    par défaut, débrayables par le commutateur « Voir les demandes résolues récemment »
    (`filters.showResolved`, compteur `resolvedCount`). Elles **n'entrent pas dans la légende
    des urgences** (`priorityCounts` les saute) : compter une résolue sous une couleur
    d'urgence ferait mentir la légende, puisque son épingle est grise.
  - **Quartiers** (2026-08-28) : le découpage du territoire se superpose aux épingles,
    chaque quartier tracé et **nommé en son centre** à la couleur du référentiel
    (`QuartierLayer`, brique partagée avec la carte du champ d'adresse). Bascule
    « Afficher les quartiers » **active par défaut** — c'est une option d'AFFICHAGE, pas un
    filtre : elle ne change pas la sélection de demandes, seulement ce qu'on voit dessous,
    d'où sa place à droite de la barre, séparée des filtres. Absente quand le référentiel ne
    publie aucun quartier. Le recadrage continue de suivre les DEMANDES, jamais les
    quartiers : c'est la sélection filtrée qu'on vient regarder.
  - Vérifié en navigateur le 2026-08-23 : d'abord sur harnais jetable (mosaïque, épingles,
    écartement, fiche y compris bascule au bord, déplacement, zoom, recadrage, géocodage en
    masse réel), puis **sur l'application réelle** avec la demande DEM-2026-000005
    (10 avenue de Frémeur, 44000 Nantes) — épingle posée, fiche de survol complète, et le
    bloc « Lieu d'intervention » de la fiche d'instruction (carte, « Numéro localisé »,
    « Guider »).
