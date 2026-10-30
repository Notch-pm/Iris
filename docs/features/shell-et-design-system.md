# Shell agent et design system

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Design system Notch/Ariane** — source de vérité : le projet Claude Design
  « Ariane Design System » (`019e2566-e3ff-75e7-80a9-af82c9b99671`, accessible via DesignSync).
  Les tokens de `colors_and_type.css` y sont **copiés tels quels** dans `src/index.css`
  (recommandation MUTUALISATION.md §2.1) : primaire vert AA `hsl(153 90% 32%)`
  (+ `--primary-bright` marketing), secondaire beurre, radius 14px, ombres « airbnb »
  (`shadow-airbnb-sm…xl`, alias `iris-*`). **Police : Nunito Sans, seule famille**
  (Google Fonts). Le shell agent calque le **shell de production Clara** : header sticky
  `h-14` (à gauche, depuis le 2026-09-10 — maquette Claude Design « En-tête
  multi-applications » : **bascule d'application** `AppSwitcher` dans une colonne de 52 px
  alignée sur le rail, vers `<socle|iris|clara|ariane>.edilumen.fr` (`layout/apps.ts`, pur et
  testé — liens nus, chaque produit a sa session), wordmark `src/assets/logo-notch.svg` en
  `h-6`, séparateur, **logo du client** lu chez le Socle (`useOrganisationBranding`, nom à
  défaut) et sélecteur d'organisation s'il y en a plusieurs ; à droite, pastille « I » +
  **Iris**, chip administrateur, superadmin, **accès aux Paramètres** — tuile `h-9 w-9`,
  active en `bg-primary/10 text-primary` — puis menu compte), **rail vert `bg-primary` 52px**
  (tuiles 36px, icônes Lucide 20px — sauf le tableau de bord, **maison** tracée depuis la
  maquette —, premier item épinglé, groupe centré ; l'entrée active se
  décide par `src/components/layout/nav.ts`, pur et testé, et non par `NavLink` — deux
  entrées partagent le préfixe `/demandes`). Le gabarit
  horizontal de la zone de contenu est **demandé par la page** (`src/components/layout/
  shellLayout.tsx`) : `default` = colonne centrée 1240px (formulaires, réglages), `wide` =
  pleine largeur avec le padding du shell (`useWideLayout` — listes denses : demandes, usagers),
  `full` = pleine hauteur sans gabarit ni padding (`useFullBleedLayout` — création, fiche,
  carte) ; la zone superadmin
  garde son rail forêt. L'icône des Paramètres est l'**asset de Clara** recopié tel quel
  (`src/assets/icons/parametres.svg`, rendu en `<img>`), pas une icône Lucide — les
  Paramètres ne sont donc **pas** dans le rail, exactement comme chez Clara. Boutons : hover `brightness-105` (pleins) /
  bascule **beurre** (`bg-secondary`) sur outline et ghost, press `scale-[0.98]`, radius 10px
  (idem inputs). `_adherence.oxlintrc.json` (racine) = garde-fou DS (hex bruts, px bruts,
  polices hors DS) — ⚠️ **il ne s'exécute plus** (oxlint n'implémente pas `no-restricted-syntax`) :
  l'adhérence se vérifie à la main en attendant, dette O1 de
  [`docs/dette-technique.md`](../dette-technique.md).
