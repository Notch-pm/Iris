# Base de connaissances (`src/features/knowledge`)

Écran livré le 2026-09-18 (maquette Claude Design « Base de connaissance », projet
`e4997645-cae4-4ec2-8113-3c7acc9db8fe`). Bureau seul : sur téléphone, `Adaptive` rend
l'écran d'orientation.

## Accès

Attribut de profil **`knowledge_base_access`** (marche/arrêt, activé sur les profils
existants à sa création) → `my_rights.knowledge_base_access` → entrée de rail
(`AppShell`, avant « Statistiques ») et garde de route `KnowledgeBaseRoute`
(`components/layout/ProtectedRoute.tsx`). Doctrine : [`docs/droits.md`](../../../docs/droits.md).

⚠️ **C'est le droit d'ouvrir un ÉCRAN, pas une frontière de données.** Tout ce que l'écran
montre est déjà lisible par tout membre du tenant (cache des démarches, activations,
organisations miroitées, fiche relue par `socle-proxy /v1/procedures/get` — que lit aussi le
rail « Procédure »). La seule garde serveur qui en dépend est celle de l'**assistant** :
`request-assistant` accepte le mode démarche avec un droit de création **ou** cet attribut
(`has_knowledge_base_access_for`), parce que chaque question mord sur le plafond IA de la
collectivité.

## La liste (`KnowledgeBasePage`, `/base-de-connaissances`)

- **Source** : `useSocleProcedureRows` — les démarches **publiées** au sens du guichet
  (production, externes, dans leur période de publication). « Publiée » veut dire la même
  chose partout dans Iris : une démarche en brouillon, interne ou hors période n'apparaît
  pas ici non plus.
- **Organismes** : miroir `socle_procedure_organizations` croisé avec les organisations
  miroitées (`buildCatalogue`). **Opt-in strict** : une démarche sans activation est
  « proposée par aucun organisme », jamais « par tous ». Un organisme sorti du miroir n'est
  pas inventé.
- **« Ouverte temporairement »** : la démarche a une période de publication — elle est
  dedans (sinon elle ne serait pas listée) et elle en sortira ; la période s'affiche sous la
  pastille. **« Non visible portail »** : `portalAbsenceLabel`, comme au guichet.
- **Recherche** (`filterCatalogue`, pur, testé) : nom, catégorie et organismes, sans accents
  ni casse ; plusieurs mots doivent TOUS se trouver, dans n'importe quel ordre.
- **Regroupement** (`groupByCategory`) : catégories par ordre alphabétique, « Sans
  catégorie » en dernier, démarches triées par nom.

## La fiche (`KnowledgeProcedurePage`, `/base-de-connaissances/:procedureId`)

Trois colonnes, pleine hauteur (`useFullBleedLayout`) :

- **à gauche** — la démarche (catégorie, type, pastilles), « Changer de démarche » (retour
  à la liste), et les rubriques : « Ce que voit l'usager », puis « Interne — agent » — une
  entrée par bloc NON VIDE de la base de connaissances (`internalNav`) ;
- **au centre** — la rubrique ouverte, en typographie de page : ce sont les rubriques de la
  « Fiche démarche » du guichet (`requests/procedure/FicheSections.tsx`, taille `page`),
  avec en plus la carte « Organismes » ;
- **à droite** — l'**assistant**, en mode démarche seule (aucune donnée d'usager),
  élargissable (`clamp(300px,30vw,400px)` ↔ `clamp(320px,46vw,560px)`), et une carte
  « Contexte » qui dit ce qu'il a sous les yeux. Un fil par démarche, rien d'enregistré (D3).

⚠️ **Une démarche non publiée ne s'affiche pas, même par son adresse** : la page vérifie
qu'elle figure au catalogue publié AVANT de demander sa fiche au Socle.

## Pas repris de la maquette (faute de donnée ou de chemin)

Version et date de la fiche ; « Voir la page publique » (Iris ne connaît pas l'adresse du
portail) ; « Consigner une demande » (le guichet ne sait pas encore s'ouvrir sur une
démarche désignée — à faire avec un `?demarche=`, en tenant compte de l'étape « Organisme ») ;
les sources cliquables, les votes et « Copier dans la demande » sous les réponses de
l'assistant (il ne renvoie pas de sources structurées, et rien n'est conservé).
