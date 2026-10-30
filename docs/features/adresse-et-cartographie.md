# Cartographie libre et saisie d'adresse

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Cartographie libre** (`src/lib/carto.ts`, pur/testé ; rendu dans
  `src/components/map/TileLayer.tsx`) : tuiles **OpenStreetMap** (attribution ODbL
  obligatoire à l'affichage — elle est portée par la mosaïque, ne pas la retirer) et
  géocodage **Base Adresse Nationale**, servie par la **Géoplateforme** (IGN) depuis le
  retrait d'`api-adresse.data.gouv.fr` en janvier 2026 : unitaire pour une fiche, **en masse
  par CSV** pour une carte, et **pendant la frappe** pour le champ d'adresse assisté
  (`src/lib/adresse.ts`). Services publics sans clé ni compte, donc rien à cacher dans le
  bundle. Ce qui transite, c'est une **ADRESSE et rien qui l'accompagne** — jamais un nom,
  jamais la référence d'une demande : cela vaut pour le lieu d'intervention comme pour
  l'adresse d'un usager qu'un agent saisit (le Socle re-géocode déjà cette même adresse pour
  recalculer le quartier). **Iris ne géocode jamais pour stocker** : un point qu'Iris calcule
  (fiche, carte, champ d'adresse) est un confort de session, jamais une donnée de la demande,
  et aucune géométrie de quartier n'est conservée. Depuis le contrat Socle **1.29.0** (champ
  `location` du `form_schema`, 2026-09-22), un lieu d'intervention peut arriver **avec le point
  que l'usager a déclaré** (`{address, lat, lon, precision, adjusted}` dans `form_data`) : c'est
  une **réponse au formulaire**, stockée comme les autres, figée avec elles, et elle **prime**
  sur tout géocodage — l'usager sait mieux que la BAN où il a posé son épingle (150 m au plus de
  l'adresse). Substituables sans toucher au code par `VITE_MAP_TILE_URL` / `VITE_GEOCODE_URL`
  (fournisseur dédié le jour où le volume l'exige).
- **Saisie d'adresse assistée** (`src/lib/adresse.ts` + `src/components/address/`) : une
  **ligne unique** qui propose les adresses du référentiel (combobox ARIA, ↑ ↓ / Entrée /
  Échap), un dépliant « Plus de champs » limité à ce que le contrat porte vraiment, une
  **carte de contrôle** et « Utiliser ma position ». **Il propose, il ne garde pas la
  porte** : retenir une proposition est toujours facultatif, la BAN ne couvre ni les adresses
  neuves ni l'étranger, et une panne du service n'empêche jamais de saisir.

- **Saisie d'adresse assistée** (2026-08-28, `src/lib/adresse.ts` pur/testé — 22 cas —,
  `src/components/address/`) : les trois endroits où l'on écrit une adresse — bloc **lieu
  d'intervention** du formulaire de démarche, **création d'usager**, **fiche usager** —
  partagent un même champ. Jusqu'ici Iris n'aidait à saisir nulle part : `autocomplete=0`
  était même forcé côté BAN, et la seule validation d'adresse du dépôt était « le pays ne peut
  pas être vidé ». Une adresse fausse ne se voyait qu'après : pas d'épingle sur `/carte`,
  « Guider » sans destination, et un **quartier recalculé faux** côté Socle.
  - **Il propose, il ne garde pas la porte.** Retenir une proposition est TOUJOURS facultatif :
    le texte libre est conservé, « Adresse introuvable ? » ouvre la saisie manuelle, une panne
    du géocodeur se dit en une ligne discrète. La BAN ignore les adresses neuves et tout ce qui
    n'est pas en France — d'où le retrait de l'assistance dès que le pays d'un contact n'est
    pas la France (`isFranceCountry`).
  - **Le clavier fait tout** : combobox ARIA (`aria-expanded`/`aria-controls`/
    `aria-activedescendant`, `aria-live` annonçant le nombre de propositions), ↑ ↓ pour
    parcourir, **Entrée choisit et NE SOUMET PAS**, Échap ferme — motif repris de
    `MentionTextarea`. Jetons `autoComplete` corrects (`street-address`, `postal-code`,
    `address-level2`) pour que l'autofill du navigateur fonctionne.
  - **« Plus de champs » ne montre que ce que le contrat porte.** Le bloc d'intervention a
    `complement`/`appartement` (+ `batiment` quand la démarche le pose) ; contacts-api n'a
    qu'`address_line2`. Y écrire un bâtiment séparé inventerait un modèle que le Socle n'a
    pas. Déplié d'office si l'un des champs est déjà rempli.
  - **`batiment` est reconnu depuis le 2026-08-28** (`lieu.ts`, clé `intervention_batiment` +
    libellés « bâtiment »/« immeuble ») et rejoint les précisions d'accès : **jamais dans la
    requête envoyée au GPS**, comme complément et appartement.
  - **La reconnaissance du bloc est UNE** : `interventionFields(schema, candidates)` sert la
    LECTURE (`interventionLocation`, champs visibles) et la SAISIE (`ProcedureFormFields`, tout
    le schéma). Sans quoi un bloc reconnu à l'écriture pourrait ne plus l'être à la relecture.
  - **`fitStreetParts`** répartit la ligne sur les champs que le bloc porte VRAIMENT : un BTQ
    que la liste fermée ne sait pas dire (« 2 A »), ou un numéro sans champ, rejoignent la
    **voie** plutôt que d'être perdus.
  - ⚠️ **Piège vécu (2026-08-28)** : la ligne affichée ne peut PAS être recomposée depuis les
    champs séparés PENDANT la frappe. Le découpage normalise les espaces, si bien qu'un « 12 »
    suivi d'une espace redevient « 12 » et que la lettre suivante se recolle — la saisie
    donnait « 12 Bisruedeslilasarles ». `InterventionAddress` garde donc la ligne TAPÉE en
    état local tant que l'agent tape, et ne rend la main aux champs qu'une fois une
    proposition retenue. **Règle générale : un champ contrôlé ne se dérive jamais d'une
    transformation à perte de ce qui vient d'être tapé.**
  - **La carte** (`AddressMap`) réutilise `TileLayer` et le motif de `LieuIntervention` : le
    point, la réserve du géocodeur (`PRECISION_LABELS` — même vocabulaire que la carte des
    interventions), le zoom ±. Elle MONTRE, elle ne saisit pas : le point n'est pas
    déplaçable — ce qui s'enregistre est la proposition retenue (adresse **et** son point
    BAN, pour un champ `location` : `LocationFieldControl`), jamais un point qu'un agent
    aurait posé ; l'ajustement à 150 m est un geste de l'usager, sur le portail. Retaper
    l'adresse d'un lieu existant retire son point (dit dans `FormulaireEditDialog`).
    ⚠️ **`useElementSize` mesure au MONTAGE** : `AddressMap` n'est monté qu'une fois le point
    connu (un conteneur rendu conditionnellement plus tard n'est jamais mesuré, et sa mosaïque
    reste vide — vécu le 2026-08-28).
  - **Débit** : la Géoplateforme annonce 50 appels/IP/s, mais une collectivité sort par UNE
    IP — debounce 300 ms, 3 caractères minimum, une requête en vol, `retry: false` (pendant la
    frappe, un échec se remplace tout seul au caractère suivant).
  - **Quartiers** (`src/lib/quartiers.ts` géométrie pure/testée, `src/features/socle/
    quartiers.ts` contrat, route `socle-proxy /v1/quartiers/list`) : la carte superpose les
    limites du territoire et nomme celui où l'adresse tombe. Livré et vérifié le 2026-08-28
    sur ACCM (5 quartiers, `MultiPolygon`, couleurs `hsl(...)` du référentiel).
  - ⚠️ **Le contrat public-api demande DEUX paramètres, sans quoi il ne rend rien d'utile**
    (aller-retour du 2026-08-28) :
    - **`geometry=true`** — par défaut `GET /v1/quartiers` rend les quartiers **sans
      polygone** ; la plupart des consommateurs ne veulent que les libellés ;
    - **`organization_id`** — **exigé des clés PLATEFORME** (celle d'Iris) pour les
      géométries ; le Socle en prend la racine, et les quartiers n'existent que sur les
      organisations principales. `tenant.socleOrgId` EST cette racine, vérifiée par
      `resolveTenant` : jamais une valeur venue du client.
    - Le champ s'appelle **`geometry`** (GeoJSON de `ST_AsGeoJSON`), **pas `geom`** — ça,
      c'est le nom de la colonne PostGIS, binaire, qui ne sort jamais. Confondre les deux
      faisait rendre `geom: null` sur des quartiers qui avaient tous leur polygone
      (la colonne est `not null` côté Socle).
  - **`quartierAt`** (lancer de rayon, pur/testé) répond à « quel quartier CONTIENT ce
    point ? » — vérifié contre `ST_Contains` du Socle : même verdict. Ce n'est PAS forcément
    le quartier affiché sur la fiche de l'usager : le Socle laisse **forcer** un rattachement
    à la main (`quartier_auto = false`), et un contact sans coordonnées n'en a aucun de
    calculé. Les deux peuvent donc légitimement différer — d'où « d'après les limites du
    référentiel », qui dit d'où vient CE verdict-ci plutôt que de laisser croire à une
    contradiction.
  - La couche reste FACULTATIVE par construction : pas de géométrie exploitable ⇒ pas de
    couche, et rien d'autre ne bouge. Le rendu vit dans `src/components/map/QuartierLayer.tsx`,
    partagé avec la **carte des interventions** : remplissage léger (la carte doit rester
    lisible dessous), trait appuyé (la question est « de quel côté de la limite suis-je ? »),
    étiquettes au centre de gravité du plus grand anneau (`quartierLabelPoint`) — coupées sur
    la vignette d'un champ d'adresse, où le nom du quartier est déjà écrit en toutes lettres.
  - Vérifié en navigateur réel le 2026-08-28 : autocomplétion et sélection au clavier sur les
    trois écrans, carte et tuiles réelles, « Plus de champs » limité aux champs de la démarche,
    et le récapitulatif portant bien les clés `intervention_*` attendues.
