# Layout : shell de bureau, shell mobile, détection d'appareil

Chargé automatiquement quand on travaille dans ce dossier. Les invariants du `CLAUDE.md`
racine priment.

## Coin gauche du bureau : la gamme (maquette « En-tête multi-applications », 2026-09-10)

Le header de bureau ouvre, de gauche à droite, sur la **bascule d'application**
(`AppSwitcher.tsx` — bouton grille dans une colonne de **52 px alignée sur le rail**, tuile
34 px sans bordure ; menu à quatre tuiles : Socle, Iris, Clara, Ariane), le wordmark de la
gamme, un séparateur, puis le **client** : son **logo** (`ClientIdentity`), lu chez le Socle
par `useOrganisationBranding` ; son nom tant qu'il n'y a pas de logo (ou qu'il est cassé) ;
rien pendant le chargement ; et le sélecteur d'organisation quand on appartient à
plusieurs. Le **nom du produit** (pastille « I » + « Iris ») est à **droite**, devant le
chip administrateur et le menu compte. Le rail commence directement par le tableau de
bord — icône **maison** tracée depuis la maquette (`HouseIcon`, pas la `House` de Lucide).

- **`apps.ts`** (pur, testé) : la liste des applications, `CURRENT_APP` = Iris, et
  `appUrl(key)` = `https://<key>.edilumen.fr` — les quatre sites sont bâtis sur ce motif,
  rien n'est à configurer. Le menu est fait de **liens nus** vers ces adresses : chaque
  produit tient son propre projet Supabase et sa propre session, **Iris ne transmet rien**
  (ni jeton, ni organisation) — le pied du menu le dit à l'agent. La tuile d'Iris est
  inerte et cochée (`aria-current`).
- **Logo du client** (`src/features/socle/useOrganisationBranding.ts`) : `socle-proxy
  /v1/organizations/branding` — la racine du tenant, aucun identifiant du navigateur,
  whitelist réduite au `logo_url` http(s). **Ni colonne, ni miroir** : le navigateur charge
  l'image à l'URL publique du référentiel. Un confort, jamais une dépendance : Socle muet
  ⇒ le nom, pas une erreur (`retry: false`, erreur avalée — motif `useOrganisationAnchor`).

## Deux shells, une URL (décision PO 2026-09-14)

Iris **n'adapte pas ses écrans de bureau** au téléphone. Quand un téléphone est détecté,
`Adaptive` (`src/features/device/Adaptive.tsx`) rend le **shell mobile** à la place
d'`AppShell`, et, route par route dans `src/App.tsx`, la **page mobile** quand elle existe
— sinon l'écran d'orientation `MobileOnlyOrientation` (« Cette fonction se fait sur
ordinateur », bouton « Ouvrir la version bureau »). **Jamais d'espace `/m/`** : le permalien
d'un e-mail (`/demandes/<id>`) ouvre la bonne fiche sur les deux appareils.

- **Détection** : `src/lib/device.ts` (pur, testé) — la **largeur** (`max-width: 767px`)
  décide, et un **commutateur** mémorisé sur l'appareil (`localStorage`, clé
  `iris.device-override`) PRIME. Une tablette (≥ 768 px) garde le bureau. Jamais le
  User-Agent (figé, menteur). `pointer: coarse` reste réservé à la caméra
  (`CameraCapture`) : il ferait basculer les tablettes.
- **`DeviceProvider`** (`src/features/device/`) monté à la racine d'`App.tsx`, au-dessus
  d'`AuthProvider` ; `useDevice()` → `{ mode, isMobile, viewportNarrow, override,
  setOverride }`.
- **Commutateur** : menu compte du bureau (« Version mobile », et « Détection automatique »
  quand un téléphone a forcé le bureau) ; feuille compte du mobile (« Version bureau », et
  « Détection automatique » quand un grand écran a forcé le mobile).
- **`MobileShell`** (`mobile/`, maquette Claude Design « Iris mobile — v2 », 2026-09-14) :
  **pas de barre haute commune** — chaque page mobile porte son en-tête (`MobileHeader` :
  retour ou croix, titre, cloche, menu ⋯), parce qu'en application installée il n'y a pas
  de barre d'adresse et que deux en-têtes empilés mangeraient l'écran. Contenu défilant,
  puis la **barre d'onglets basse sombre** (`bg-sidebar`) — `mobileNav.ts` (pur, testé) :
  Demandes, Interventions (si `is_intervenant`), le bouton rond **« Créer »** au centre (si
  `useCanCreateRequest`), et **« Moi »** qui n'est pas une route : il ouvre la feuille du
  compte SUR PLACE (`MobileAccountSheet` — identité, sélecteur d'organisation, profils,
  Mon compte, commutateur, déconnexion). Activation par `isNavRouteActive` (`nav.ts`),
  comme le rail : « Demandes » et « Créer » partagent le préfixe `/demandes`. Le gabarit
  demandé par la page (`ShellLayoutContext`) est **ignoré** : le mobile est toujours plein
  écran. Insets de sécurité en `env(safe-area-inset-*)` (`viewport-fit=cover` dans
  `index.html`), posés une fois dans les primitives.
- **Primitives des pages mobiles** (`mobile/MobilePage.tsx`) : `MobileHeader`,
  `MobileFooter` (pied collant + hint), `MobileCard` / `MobileCardButton`, `MobileSection`
  (« 1 · Photo de la situation »), `MobileGroupLabel`, `MobileActionRow` (ligne d'un tiroir),
  `MobileQuickAction` (Écrire / Statut / Photo), `MobileChip`, `MobileEmpty`, `MobileNotice`,
  et les deux enveloppes de dialogue : **`MobileSheet`** (feuille plein écran, en-tête avec
  croix, contenu défilant, `footer`, `locked` pendant un envoi) et **`MobileDrawer`**
  (tiroir bas avec poignée et « Annuler »). Huit écrans, une seule grammaire.
- **Dialogues** : `DialogContent variant="sheet"` (plein écran) et `variant="drawer"`
  (tiroir bas), prop `hideClose` quand la page pose sa propre croix
  (`src/components/ui/dialog.tsx`) — le bureau ne change pas.
- **Accueil mobile** : `MobileHome` route vers `/interventions` (intervenant) ou `/demandes`.
- **PWA** : `public/manifest.webmanifest` + icônes `public/icons/` (produites par script
  depuis les formes du favicon, sans dépendance), balises dans `index.html`. **Aucun service
  worker** : Iris ne fonctionne pas hors ligne. Sur iOS, l'installation passe par
  Partager › Sur l'écran d'accueil ; en application installée il n'y a pas de barre
  d'adresse, chaque en-tête mobile porte donc son retour.

**Pages mobiles livrées** (maquette v2, huit écrans) — chacune sous sa feature, dossier
`mobile/` : liste `/demandes` et fiche `/demandes/:id` (`features/requests/mobile/` — tiroir
« Instruire », feuille « Changer le statut », feuille « Écrire à l'usager »),
`/interventions` (`features/requests/interventions/mobile/` — liste groupée par jour et
feuille « Déclarer l'intervention »), `/demandes/nouvelle` (`features/requests/creation/
mobile/` — création en une page). `/mon-compte` garde sa page de bureau (colonne unique).
Les autres routes (tableau, carte, usagers, paramètres) affichent l'orientation.
