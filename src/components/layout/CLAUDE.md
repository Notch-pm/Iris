# Layout : shell de bureau, shell mobile, détection d'appareil

Chargé automatiquement quand on travaille dans ce dossier. Les invariants du `CLAUDE.md`
racine priment.

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
- **`MobileShell`** (`mobile/`) : barre haute (tenant, cloche, compte), contenu défilant,
  **barre d'onglets basse** — `mobileNav.ts` (pur, testé) : Interventions (si
  `is_intervenant`), Demandes, Nouvelle (si `useCanCreateRequest`), Compte ; activation par
  `isNavRouteActive` (`nav.ts`), comme le rail. Le gabarit demandé par la page
  (`ShellLayoutContext`) est **ignoré** : le mobile est toujours plein écran. Insets de
  sécurité en `env(safe-area-inset-*)` (`viewport-fit=cover` dans `index.html`).
- **Dialogues plein écran** : `DialogContent variant="sheet"` (`src/components/ui/dialog.tsx`)
  — les pages mobiles le demandent, le bureau ne change pas.
- **Accueil mobile** : `MobileHome` route vers `/interventions` (intervenant) ou `/demandes`.
- **PWA** : `public/manifest.webmanifest` + icônes `public/icons/` (produites par script
  depuis les formes du favicon, sans dépendance), balises dans `index.html`. **Aucun service
  worker** : Iris ne fonctionne pas hors ligne. Sur iOS, l'installation passe par
  Partager › Sur l'écran d'accueil ; en application installée il n'y a pas de barre
  d'adresse, chaque en-tête mobile porte donc son retour.

Pages mobiles livrées par lots, au fur et à mesure des maquettes Claude Design :
Lot 1 « Mes interventions », Lot 2 fiche de demande, Lot 3 création. Tant qu'un lot n'est
pas livré, sa route affiche l'orientation.
