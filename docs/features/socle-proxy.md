# `socle-proxy` : les routes vers le référentiel

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **`socle-proxy`** (edge, JWT vérifié en code + périmètre : membre du tenant demandé ET
  racine Socle du tenant dans le périmètre **réel** de la clé Socle — introspection
  `/v1/organizations` mémoïsée, 403 sinon) : `POST /v1/procedures/list` (démarches PROPOSABLES du
  tenant : ni brouillon, ni interne, ni hors période de publication — le résumé porte depuis
  le 2026-09-18 leurs **publics admis**, `audiences`, lecture de `requester_config` sans la
  configuration elle-même),
  `/v1/procedures/get` (fiche complète, et **aucun de ces filtres** — une demande déjà déposée
  doit rester lisible si sa démarche repasse en brouillon ou sort de période :
  `form_schema`, `requester_config`, et —
  depuis le 2026-08-28 — la **part agent** de la `knowledge_base` : consignes, procédures,
  documents d'aide, liens, FAQ, garde-fous ; `trainingDocuments` et `aiSources`, matière de
  l'assistant IA, ne franchissent PAS la frontière par cette route (depuis le 2026-09-19,
  `request-assistant` en montre le LIBELLÉ — et l'adresse d'une page — dans sa carte de
  proposition ; jamais le chemin d'un document, jamais leur contenu) ; et depuis le 2026-09-01 le bloc
  **`documents`** — les modèles de document et de courrier de la démarche, pour que l'écran
  PROPOSE : le fichier, lui, ne transite jamais par le navigateur ; et depuis le 2026-09-18
  **`user_communication`** — ce que la collectivité écrit pour ses usagers, PUBLIC par
  invariant du Socle, whitelisté par `_shared/procedures/userCommunication.ts`, `null` =
  rien d'écrit),
  **`/v1/procedures/document-url`** (URL signée d'un document d'aide agent, relayée du Socle
  après vérification que le chemin est cité par CETTE démarche — sans quoi la route serait un
  lecteur libre du bucket `procedure-documents`), `/v1/contacts/search`, `/v1/contacts/list` (annuaire paginé de la page
  « Usagers » : `offset`, et seule route qui sait montrer les fiches archivées),
  `/v1/contacts/match` (rapprochement/homonymes),
  `/v1/contacts/get`, `/v1/contacts/create`, `/v1/contacts/update` (via contacts-api Socle
  uniquement, whitelist d'entrée ; l'update est un **PATCH partiel** — `contact_type` et
  `status` refusés, pays jamais vidé — et les refus du Socle sont relayés tels quels),
  **`/v1/ai/usage`** (consommation IA relayée du guichet `ai-api` — depuis le contrat 1.3.0,
  2026-09-22, `limit`/`used_tokens`/`reserved_tokens` sont ceux d'**Iris** : le plafond commun
  de la collectivité moins les parts que le Socle réserve à d'autres applications ; seul
  `by_consumer` reste la ventilation de toute la collectivité —
  ⚠️ **réservée aux administrateurs, garde réécrite DANS la fonction** : la lecture se fait en
  service role, le RLS qui gardait autrefois les tables ne s'applique plus),
  **`/v1/organizations/root`** (fiche de l'organisation **principale** du tenant — `id`, `name`,
  `address`, whitelist stricte : ni téléphone, ni courriel, aucun écran n'en ayant l'usage. La
  route ne prend **aucun identifiant du navigateur** : c'est `tenant.socleOrgId`, sinon elle
  serait un lecteur libre du référentiel d'organisations. Ouverte à tout membre — l'adresse
  d'une mairie est publique. Sert de **repli au cadrage de la carte des interventions**,
  quand le référentiel ne publie aucun quartier),
  **`/v1/organizations/branding`** (2026-09-10 : le **logo du client** dans le header —
  `GET /v1/organizations/{racine}/branding` du Socle, qui résout l'héritage ; même règle
  qu'au-dessus, aucun identifiant du navigateur ; whitelist réduite au `logo_url` http(s) ;
  décoratif donc **jamais une erreur** : Socle muet ⇒ `branding: null` et le header écrit
  le nom),
  **`/v1/organizations/agent-guidance`** (2026-09-19 : les **recommandations générales** de
  la collectivité à ses agents, Socle 1.27.0 — même règle, aucun identifiant du navigateur ;
  ouverte à tout membre ; whitelist `_shared/organizations/agentGuidance.ts` partagée avec
  l'écran et l'assistant ; ⚠️ Socle muet = **erreur relayée**, pas un vide — sinon l'écran
  lirait « rien d'écrit »),
  **`/v1/quartiers/list`** (quartiers du territoire **avec leur géométrie**, pour la carte du
  champ d'adresse **et le cadrage de la carte des interventions** — qui s'ouvre depuis le
  2026-08-31 sur l'étendue du territoire, et non sur ses épingles ; ouverte à tout membre
  comme `/v1/procedures/*` : une limite de quartier n'est pas une donnée personnelle ; 404 du
  Socle ⇒ `available: false`, pas une erreur).
  ⚠️ `geom` ne franchit la frontière que par CETTE route : `sanitizeContact` continue de le
  retirer du quartier d'une fiche usager — un polygone par ligne d'annuaire serait du poids pur. Réponses **sanitisées par whitelist** (`_shared/sanitize.ts`, pur, testé) :
  `internal_notes`, consentements, relations, `external_references` ne sont **jamais**
  transmis au navigateur ; champs Socle inconnus tolérés (ignorés). Les **rôles** d'une
  fiche passent depuis le 2026-10-16, réduits aux rôles **codés** reconnus (`elu`,
  `interne` — contacts-api 1.3.0) et à leur seul code (`CONTACT_ROLE_CODES`) : pastille
  « Élu » / « Interne », filtre de la liste des usagers, signal au guichet. `X-Organization-Id`
  toujours dérivé côté serveur.
