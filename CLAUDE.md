# Iris

Système transactionnel des **demandes d'usagers** de la gamme Edilumen. Interface en
**français**.

## Rôle dans la gamme logicielle

La gamme : **Socle** (référentiel central — organisations, démarches, catégories, types de
pièces, quartiers, contacts/usagers), **Clara** (gestion du courrier), **Ariane**, **Iris**.
Iris est propriétaire exclusif des **demandes** : créées par un agent dans Iris, ou ingérées
depuis Clara (action externe issue d'un courrier) et des applications partenaires, puis
instruites jusqu'à un état final.

**L'architecture validée fait foi : [`docs/architecture-proposee.md`](docs/architecture-proposee.md).**
Toute implémentation s'y réfère (modèle de données §1, frontières §2, cycle de vie §3, RLS §4,
contrats d'ingestion/retour §5–6, snapshots Socle §7, sécurité §8, plan de livraison §9).

## Invariants (à ne jamais enfreindre)

- **Socle est la source de vérité** des organisations, démarches, catégories, usagers. Iris ne
  les redéfinit pas : miroir léger de la hiérarchie d'organisations, snapshot figé par demande,
  cache léger des démarches, proxy serveur pour le reste. **Jamais de miroir complet.**
- **Aucune FK ne franchit une frontière de projet** (Socle, Clara, Iris = trois projets
  Supabase distincts). Références croisées = UUID nu + discriminant textuel. **Aucun flux
  base-à-base** — uniquement HTTP.
- **Jamais de clé d'un autre projet dans le navigateur.** Aucun secret en `VITE_*` (inliné dans
  le bundle). Les secrets inter-projets vivent dans les secrets d'edge functions. La seule clé
  côté client est la clé publiable du projet Iris (protégée par le RLS).
- **La sécurité vit dans le RLS Postgres** — les droits ne sont jamais appliqués côté client,
  l'UI ne fait que refléter. Visibilité par **couple (organisation porteuse Socle en
  sous-arbre, démarche)**, combinée par profils de droits, y compris pour les administrateurs
  (détail : bullet « Profils de droits » ci-dessous, [`docs/droits.md`](docs/droits.md)).
- **Workflow fixe à 7 statuts** (décision PO) : `a_traiter`, `en_instruction`, `en_attente`,
  `annulee`, `resolue_positive`, `resolue_negative`, `archivee`. Gardes de transition
  **serveur** (trigger), jamais UI seulement. « Résolue positivement » exige un passage par
  l'instruction — et, depuis le 2026-08-28, que toute pièce **obligatoire** ait été qualifiée
  conforme (`t17_requests_require_pieces_conformes`). `en_attente` s'intitule « En attente
  d'information » : c'est là que va une demande dont une pièce est déclarée non conforme.
  Aucun 8ᵉ statut n'est à créer pour un nouveau besoin d'attente.
- **Vocabulaire** : « catégorie » désigne exclusivement les catégories de **démarches** du
  Socle. La position d'une demande dans son cycle de vie est un **statut**. L'organisation
  Socle qui reçoit et traite une demande s'appelle **organisme** partout où un agent la lit
  (liste et tableau des demandes) — les clés de code, elles, restent `destinataire` :
  elles circulent (état d'écran, `?destinataire=`) et la variable d'e-mail
  `{{demande.destinataire}}` appartient à un catalogue FIGÉ.
- **Iris ne gère aucune demande libre** (règle impérative PO, 2026-08-20) : toute nouvelle
  demande est **fondée sur une démarche Socle active du tenant** (`socle_procedure_id` +
  `procedure_snapshot`), gardé par le trigger `t16_requests_require_procedure` — service_role
  compris. Le **snapshot de démarche est construit côté serveur** depuis Socle (edge
  functions) : jamais accepté comme vérité d'un navigateur ou d'un partenaire. Les demandes
  historiques sans démarche restent lisibles et transitionnables. **Une démarche en
  `brouillon` n'est proposée nulle part dans Iris** (2026-08-30) : le paramétrage n'est pas
  fini, le Socle dit de ne la servir à personne — garde serveur sur la démarche rechargée dans
  `create-request-from-procedure`, pas seulement un filtre d'écran. Les démarches **internes**,
  elles, sont masquées TEMPORAIREMENT (décision PO : elles seront affichées ultérieurement).
  Une démarche **hors de sa période de publication** disparaît elle aussi du sélecteur (bornes
  incluses) — mais elle MASQUE seulement : aucune garde serveur, pour qu'un formulaire papier
  reçu pendant la période reste consignable après sa fin.
  Depuis le 2026-08-31, une quatrième règle s'ajoute, et elle **masque ET refuse** :
  **une démarche doit être ACTIVÉE pour l'organisme** qui portera la demande
  (`Socle.organization_procedures`, miroitée dans `socle_procedure_organizations`, gardée par
  `t18_requests_require_procedure_active` — service_role et ingestion partenaire compris).
  **Opt-in strict** : absente du miroir = non activée. Le Socle ne rend cette information que
  par le filtre `GET /v1/procedures?enabled_for=<org>`, non récursif, d'où un appel par
  organisation du sous-arbre à la synchro. ⚠️ `procedures.is_active_global` du Socle est mort :
  ne jamais s'y fier. Le sélecteur signale en revanche ce
  qui, dans la **publication** d'une démarche, mérite de l'être : la pastille « Non visible
  portail » **uniquement** sur celles qui n'y sont pas (y être est le défaut du contrat), et la
  période quand il y en a une. Détail :
  [`docs/data-model.md`](docs/data-model.md) § « Publication des démarches ».
- **Aucun miroir local d'usagers** : les contacts vivent dans le Socle (contacts-api), Iris
  les lit/rapproche/crée/**corrige** via `socle-proxy`. **Une identité sans correspondance est
  une nouvelle personne : on la CRÉE dans le Socle** (décision PO 2026-08-26) — parcours agent
  comme ingestion partenaire. À l'ingestion, une fiche existante n'est réutilisée que sur un
  **identifiant fort** (courriel, téléphone, SIRET) : personne n'y arbitre les homonymes.
  « Sans rapprochement » ne subsiste que comme sortie de secours sur panne avérée du
  référentiel, avec l'anomalie `usager_a_creer_dans_socle`. Iris et ne conserve par demande que le
  `requester_snapshot` (identité retenue au dépôt, immuable). *Immuable* ne veut pas dire
  *seul affiché* : la fiche d'une demande relit la fiche Socle et montre l'identité du jour,
  le dépôt et leurs écarts restant lisibles à côté (`requesterView`) — et le destinataire d'un
  e-mail à l'usager suit la fiche relue, résolu côté serveur. Le snapshot, lui, n'est jamais
  réécrit — et il n'est pas une commodité d'affichage : pour une identité **non rapprochée** ou
  un dépôt anonyme, c'est la **seule** identité qui existe. Coût mesuré : ~250 octets par
  demande, cinq fois moins que `procedure_snapshot` (justification, chiffres et leviers
  écartés : [`docs/data-model.md`](docs/data-model.md), § « Pourquoi figer l'identité au
  dépôt »).
- **Aucune suppression de demande** (pièce administrative) : pas de policy DELETE, FK
  `ON DELETE RESTRICT` depuis le tenant, purge RGPD par procédure `service_role` dédiée.
- **Aucun octet n'entre dans le bucket des pièces depuis un navigateur** (2026-09-08) : tout
  fichier — d'un agent, d'un partenaire, ou produit par Iris — passe par la **porte unique**
  `supabase/functions/_shared/files/receive.ts` (taille, **signature binaire contre une liste
  fermée** : PDF, images raster, HEIC, DOCX/XLSX/ODT/ODS — jamais SVG, HTML, archive ni
  Office à macros ; extension cohérente ; sha256), puis par la **zone d'attente**
  `attachment_uploads` que seules les RPC métier consomment (`consume_attachment_upload`).
  Le client ne désigne un fichier que par `upload_id` ; chemin, nom, type et empreinte sont
  relus en base. `request_attachments` et `storage.objects` n'ont **aucune policy d'écriture
  cliente** ; la lecture suit la demande du chemin. Les partenaires **déposent** (push,
  `POST /v1/uploads`, contrat 2.0.0) : Iris ne va jamais chercher un fichier chez eux. Pas
  d'antivirus (décision PO 2026-09-08) : la liste fermée est la défense. « Voir » n'est
  proposé que pour PDF et images (`inlineViewable`), tout le reste se télécharge.
- Les **notes internes ne quittent jamais Iris** (miroir de la règle `internal_notes` du
  Socle) ; le texte de clôture destiné à l'usager est un objet distinct — **facultatif** depuis
  le 2026-08-28, et repris dans l'avis de clôture envoyé à l'usager.
- **Aucun mot de passe n'est généré ni affiché à un administrateur** : un compte s'ouvre par
  une **invitation** (lien d'activation à usage unique, mot de passe choisi par son titulaire)
  et se dépanne par un **lien de réinitialisation** envoyé au titulaire. Le **serveur d'envoi
  ne se configure pas dans Iris** (décision PO 2026-08-23) : il est défini dans le **Socle**
  pour l'organisation principale et recopié par la synchro du référentiel — `smtp_settings`
  est un miroir, sans aucune surface d'écriture ni de lecture cliente. Le mot de passe reçu
  vit dans le **Vault Postgres**, jamais dans une colonne lisible : Iris ne réplique pas la
  dette « mots de passe SMTP en clair » de Socle et Clara.
  Détail : [`docs/emails.md`](docs/emails.md).
- **Profils de droits** (décision PO, 2026-08-22, remplace le rôle binaire `agent |
  administrateur`) : les droits effectifs d'un utilisateur se combinent par **couple**
  (organisation porteuse Socle, démarche) — trois droits indépendants `création`/`instruction`/
  `clôture` impliquant chacun `consultation`, plus des droits par défaut (démarches non listées,
  y compris futures ; valeur initiale « aucun », *fail closed*). L'**administration** est un
  attribut de profil indépendant : elle **n'accorde par elle-même aucun droit** sur les
  demandes. Les 5 tables `permission_*` n'ont aucune policy d'écriture cliente : les RPC
  (`save_permission_profile`…) sont l'unique porte. `organization_members.role` subsiste en
  **colonne dérivée transitoire**. Détail complet : [`docs/droits.md`](docs/droits.md).

## Commandes

```bash
npm run dev      # serveur de dev → http://localhost:5174
npm run build    # tsc -b && vite build
npm run lint     # tsc -b (typecheck du projet, pas d'ESLint)
npm test         # vitest run ; npm run test:watch en veille
```

Prérequis : **Node ≥ 22** (en pratique Node 24 / npm 11 — npm 10 juge le lock désynchronisé).
⚠️ Ne pas redescendre vite en < 6 (vitest 4 l'exige en peer — leçon Socle, juillet 2026).

## Environnement

`.env.local` à la racine (non versionné), modèle dans `.env.example` :

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Le client Supabase (`src/lib/supabase.ts`) **échoue explicitement au démarrage** si l'une des
deux manque (validation pure et testée dans `src/lib/supabaseConfig.ts`).
Projet Supabase : `tqcoqlneybtbrrcvpkpk` (région `eu-west-1` — UE, décision D10). Voir
[`docs/demarrage.md`](docs/demarrage.md) pour les actions manuelles restantes.

## Architecture applicative

- **Routes publiques** (hors shell) : `/login`, `/mot-de-passe-oublie`, `/activer-compte`,
  `/nouveau-mot-de-passe`, **`/api-doc`** (contrat d'ingestion rendu par Redoc, lisible sans
  compte — motif `/api-doc` du Socle : la page est servie par l'app, jamais par l'edge
  function, dont la passerelle Supabase force les réponses HTML en `text/plain` + CSP
  `sandbox`), et une route catch-all 404 (`NotFoundPage`) — dette assumée chez Socle, pas
  répliquée ici.
- **Zone authentifiée** : `ProtectedRoute` › `AppShell` (rail latéral forêt + header), page
  d'accueil `DashboardPage` (placeholder).
- **Le schéma des fondations est appliqué** (miroirs dans `supabase/migrations/`) : tenants,
  membres/rôles, `requests` + satellites, storage privé, **modèle multi-source d'ingestion**
  (`integration_sources`/`integration_credentials`/`integration_api_logs`, registre de sources
  dynamique — aucune logique spécifique à un émetteur).
- **L'API d'ingestion `requests-api` est déployée et vérifiée** (18 + 7 scénarios HTTP bout
  en bout) : contrat OpenAPI **1.1.0** sur `/v1/openapi.json` (routes `/` et `/v1/openapi.json`
  **publiques et seules ouvertes au navigateur** — CORS ; rendu humain sur `/api-doc`), guide
  consommateurs dans [`docs/api-ingestion.md`](docs/api-ingestion.md). Périmètre dérivé de la clé (jamais d'un
  header/payload), **démarche obligatoire** (vérifiée dans le cache du tenant, snapshot
  construit côté serveur — dégradé + anomalie si Socle injoignable, jamais un refus), rejeu
  identique → 200, divergent → 409, pièces par URL signée uniquement (`form_field_key` pour
  rattacher une pièce à un champ du formulaire).
  Détail des tables, gardes et policies : [`docs/data-model.md`](docs/data-model.md).
  Tests d'étanchéité : `supabase/tests/fondations.test.sql` (transactionnel annulé,
  15 scénarios) + `supabase/tests/profils-droits.test.sql`. Visibilité par **sous-arbre**
  Socle et par démarche : livrée le 2026-08-22 par les profils de droits (bullet ci-dessous).
- **`socle-proxy`** (edge, JWT vérifié en code + périmètre : membre du tenant demandé ET
  racine Socle du tenant dans le périmètre **réel** de la clé Socle — introspection
  `/v1/organizations` mémoïsée, 403 sinon) : `POST /v1/procedures/list` (démarches PROPOSABLES du
  tenant : ni brouillon, ni interne, ni hors période de publication),
  `/v1/procedures/get` (fiche complète, et **aucun de ces filtres** — une demande déjà déposée
  doit rester lisible si sa démarche repasse en brouillon ou sort de période :
  `form_schema`, `requester_config`, et —
  depuis le 2026-08-28 — la **part agent** de la `knowledge_base` : consignes, procédures,
  documents d'aide, liens, FAQ, garde-fous ; `trainingDocuments` et `aiSources`, matière de
  l'assistant IA, ne franchissent PAS la frontière ; et depuis le 2026-09-01 le bloc
  **`documents`** — les modèles de document et de courrier de la démarche, pour que l'écran
  PROPOSE : le fichier, lui, ne transite jamais par le navigateur),
  **`/v1/procedures/document-url`** (URL signée d'un document d'aide agent, relayée du Socle
  après vérification que le chemin est cité par CETTE démarche — sans quoi la route serait un
  lecteur libre du bucket `procedure-documents`), `/v1/contacts/search`, `/v1/contacts/list` (annuaire paginé de la page
  « Usagers » : `offset`, et seule route qui sait montrer les fiches archivées),
  `/v1/contacts/match` (rapprochement/homonymes),
  `/v1/contacts/get`, `/v1/contacts/create`, `/v1/contacts/update` (via contacts-api Socle
  uniquement, whitelist d'entrée ; l'update est un **PATCH partiel** — `contact_type` et
  `status` refusés, pays jamais vidé — et les refus du Socle sont relayés tels quels),
  **`/v1/ai/usage`** (consommation IA de la collectivité, relayée du guichet `ai-api` —
  ⚠️ **réservée aux administrateurs, garde réécrite DANS la fonction** : la lecture se fait en
  service role, le RLS qui gardait autrefois les tables ne s'applique plus),
  **`/v1/organizations/root`** (fiche de l'organisation **principale** du tenant — `id`, `name`,
  `address`, whitelist stricte : ni téléphone, ni courriel, aucun écran n'en ayant l'usage. La
  route ne prend **aucun identifiant du navigateur** : c'est `tenant.socleOrgId`, sinon elle
  serait un lecteur libre du référentiel d'organisations. Ouverte à tout membre — l'adresse
  d'une mairie est publique. Sert de **repli au cadrage de la carte des interventions**,
  quand le référentiel ne publie aucun quartier),
  **`/v1/quartiers/list`** (quartiers du territoire **avec leur géométrie**, pour la carte du
  champ d'adresse **et le cadrage de la carte des interventions** — qui s'ouvre depuis le
  2026-08-31 sur l'étendue du territoire, et non sur ses épingles ; ouverte à tout membre
  comme `/v1/procedures/*` : une limite de quartier n'est pas une donnée personnelle ; 404 du
  Socle ⇒ `available: false`, pas une erreur).
  ⚠️ `geom` ne franchit la frontière que par CETTE route : `sanitizeContact` continue de le
  retirer du quartier d'une fiche usager — un polygone par ligne d'annuaire serait du poids pur. Réponses **sanitisées par whitelist** (`_shared/sanitize.ts`, pur, testé) :
  `internal_notes`, consentements, relations, `external_references` ne sont **jamais**
  transmis au navigateur ; champs Socle inconnus tolérés (ignorés). `X-Organization-Id`
  toujours dérivé côté serveur.
- **Profils de droits** (10 migrations `20260822100000` à `20260822100900`) : 5 tables
  `permission_*`, moteur de combinaison par couple (`permission_pairs_of`), `requests.
  socle_scope_org_id`, garde unique `requests_guard_write`, reprise (deux profils par tenant),
  `organization_members.role` dérivé, bascule des policies. Détail : [`docs/droits.md`](docs/droits.md)
  et [`docs/data-model.md`](docs/data-model.md) ; rollback dédié dans `supabase/rollback/`
  (jamais via `apply_migration`).
- **Emails** : gabarit unique dans `supabase/functions/_shared/email/` (modules purs testés
  + `transport.ts` nodemailer), serveur d'envoi **hérité du Socle** (`smtp_settings` = miroir
  de l'organisation principale, écrit par la seule synchro du référentiel via
  `sync_smtp_settings_from_socle`, mot de passe au Vault) avec repli sur un relais de
  plateforme (`IRIS_SMTP_*`). La clé Socle doit porter le scope `smtp`. Deux chemins :
  `auth-email-hook` (hook « Send Email » de GoTrue — mot de passe oublié self-service, **à
  activer une fois dans le dashboard**) et `admin-users` (invitation, renvoi de lien — liens
  produits par `generateLink`, donc indépendants du hook). Depuis le 2026-08-26, un troisième
  chemin sort du cercle des agents : **`send-request-email`**, la réponse à l'usager depuis
  l'onglet Échanges (envoi SYNCHRONE, droit d'**instruction** revérifié en SQL, destinataire et
  chemins de pièces résolus côté serveur, marque = la collectivité seule). La doctrine « ce qui
  sort d'Iris » de `notifications.ts` vise les e-mails **aux agents** et ne s'y applique pas —
  seul reste absolu : **le corps d'une note interne ne sort jamais**. Depuis le 2026-08-28,
  `send-request-email` a un second mode : l'**avis de clôture** (`kind: "cloture"`), composé
  intégralement par le serveur et exigeant le droit de **clôture** — c'est parce que le
  navigateur ne compose rien que l'ouverture à ce droit est sans risque ; le motif de clôture,
  lui, ne sort jamais.
  Depuis le 2026-08-30, ces deux messages à l'usager portent la **charte graphique de la
  collectivité** — couleur principale du bandeau et du bouton, logo — lue chez le Socle
  (`GET /v1/organizations/{id}/branding`, scope `read`) pour l'organisation **porteuse de la
  demande** (`socle_scope_org_id`) : la route RÉSOUT l'héritage, donc « à défaut, celle de
  l'organisation parente » est déjà répondu et Iris ne remonte aucun arbre. ⚠️ **Jamais depuis
  `/v1/organizations/{id}`** : les colonnes brutes d'une organisation qui hérite sont nulles.
  L'encre posée sur cette couleur est **calculée** par contraste (`_shared/email/charte.ts`,
  pur, testé) — le blanc tant qu'il suffit, sinon l'encre sombre —, le logo blanc n'est
  jamais servi sur un fond clair, et le logo **couleur** est posé sur une pastille claire (il
  est dessiné pour du papier : à même un bandeau sombre il serait illisible — cas ordinaire,
  peu de collectivités déclarant une version blanche). **Ni table, ni miroir** (cache court en mémoire, 5 min) et
  **jamais bloquant** : Socle muet ⇒ habillage Iris, pas un refus — l'inverse du relais
  d'envoi. Les messages aux **agents** gardent le vert d'Iris.
  Détail : [`docs/emails.md`](docs/emails.md).
- `src/types/database.types.ts` est **généré depuis le schéma live** (Supabase MCP
  `generate_typescript_types`) — ne jamais l'éditer à la main, régénérer après chaque migration.
- `supabase/` : `config.toml` (CLI), `migrations/` (fichiers miroirs des migrations
  appliquées), `tests/`, `functions/README.md` (plan des edge functions à venir).

### Pièges connus (hérités de la gamme, à respecter dès la première implémentation)

- **AuthProvider** : quand le chargement du profil sera ajouté, le keyer sur **l'id
  utilisateur**, pas sur l'objet session (supabase-js ré-émet un nouvel objet session à chaque
  retour d'onglet → démontage de la page en cours). Commentaire en place dans
  `src/features/auth/AuthProvider.tsx`.
- **Helpers RLS** (`is_platform_admin`, `is_org_member`, `is_org_admin`, et — depuis les
  profils de droits — `has_admin_scope`, `permission_pairs_of`) : `SECURITY DEFINER`
  obligatoire — en `SECURITY INVOKER`, récursion infinie (`stack depth limit exceeded`,
  HTTP 500). À poser **avant la première table**.
- **Fonctions trigger et RPC de service** : `REVOKE EXECUTE FROM anon, authenticated, PUBLIC`
  dans la **même migration** que leur création, et re-révoquer à chaque `CREATE OR REPLACE`
  (le replace re-grante PUBLIC — piège vécu chez Clara).
- **Policies service** : toujours `TO service_role` explicite — sans le `TO`, la policy
  s'évalue aussi pour `authenticated` (faille documentée chez Clara).
- **Policies storage** : dans une migration versionnée (le `db dump` ne couvre pas le schéma
  `storage` — constat Socle).
- **Test d'étanchéité** dès la première table : cross-tenant ET intra-tenant (deux sous-arbres
  frères).
- **`SECURITY DEFINER` et `current_user`** (vérifié empiriquement, 2026-08-22) : à l'intérieur
  d'une fonction `DEFINER`, `current_user` devient le propriétaire de la fonction — y compris en
  cascade derrière plusieurs `DEFINER` imbriqués — donc `is_service_context()` (fondée sur
  `current_user`) y vaut **toujours vrai**, même pour un vrai client authentifié. **Ne jamais
  tester `is_service_context()` dans une fonction `SECURITY DEFINER`** : utiliser
  `is_platform_admin()` (fondée sur `auth.uid()`) pour un contournement explicite, ou
  `current_setting('role', true)` pour distinguer un appel client d'un appel service_role — ou
  décider le contournement côté appelant, resté `SECURITY INVOKER`. Détail :
  [`docs/droits.md`](docs/droits.md).

## Features — détail chargé à la demande

Chaque feature a son `CLAUDE.md` de dossier, chargé automatiquement quand on y travaille ;
les invariants ci-dessus restent la référence.

- **Parcours agent** (`src/features/requests`, `src/features/tenant`) : liste, fiche
  (dont **lieu d'intervention** : adresse, carte, itinéraire, et **transfert vers un autre
  organisme responsable** depuis « Prise en charge » — cible limitée aux organismes qui
  ASSURENT la démarche, droits de l'auteur sur la cible NON exigés (RM-19 : se dessaisir,
  c'est confier), modale de confirmation qui annonce la perte d'accès quand elle aura lieu,
  libellé relu dans le miroir et affectation retirée côté SERVEUR, notification
  `transferred_in` à l'organisme qui hérite. ⚠️ **Le geste passe par la RPC
  `transfer_request`, seule porte** : un `update` client est refusé par le RLS dès que la
  cible sort du périmètre de l'auteur — invisible pour un admin plateforme, cf.
  `docs/data-model.md`), **carte des interventions**
  (`carte/`, route `/carte`), **tableau des demandes** (`tableau/`, route
  `/demandes/tableau`, entrée de rail — kanban : une colonne par statut du workflow, glisser-déposer ET
  menu clavier, seules les colonnes que `requests_guard_write` accepterait s'ouvrent, le
  dépôt DEMANDE la transition et passe par le dialogue commun de la fiche), transitions,
  **parcours de création guidé** (`creation/`),
  brouillon local, demandes proches, **échanges avec l'usager** (onglet Échanges : e-mail avec
  ou sans modèle, variables résolues sur la demande, pièces jointes réelles — edge function
  `send-request-email`), edge function `create-request-from-procedure` et moteur
  partagé `@fn/create-request-from-procedure/_shared/procedureForm.ts`,
  **base de connaissances de la démarche** (onglet « Procédure » du rail, au guichet comme à
  l'instruction : ce que le Socle destine à l'agent, RELU à chaque visite — jamais stocké,
  jamais versé au snapshot ; l'assistant IA est un chantier distinct, son onglet est posé et
  grisé),
  **documents d'instruction et courriers** (onglet Documents : trois natures — pièce
  d'instruction INTERNE, qui ne sort jamais, pièce EXTERNE et COURRIER —, générés depuis un
  **modèle Word** en **PDF ou en Word**, variables du dossier fusionnées côté serveur, edge
  function `generate-request-document` ; le PDF est **redessiné par Iris**, aucun convertisseur
  externe, et les documents transmissibles se joignent aux échanges — un interne, jamais :
  trigger `t05_attachments_internal_never_sent`),
  **qualification des pièces justificatives** (conforme / non conforme avec motif fermé ;
  une pièce obligatoire non conforme ferme la seule résolution *positive*, une pièce non
  conforme place la demande « En attente d'information », le retour en instruction est
  proposé), **ajout d'une pièce** sur une exigence non conforme ou manquante (« la plus
  récente fait foi » : la nouvelle remplace, les remplacées restent au dossier) et
  **modification des réponses** au formulaire figé de la demande (jamais la définition de la
  démarche, qui vit dans le Socle) →
  [`src/features/requests/CLAUDE.md`](src/features/requests/CLAUDE.md).
- **Contacts / Usagers** (`src/features/contacts`) : identification du demandeur via
  `socle-proxy` (homonymes cherchés automatiquement, création, sans rapprochement,
  anonymat), **fiche usager** `/usagers/:contactId` (motif de la fiche contact Clara :
  identité Socle relue sans rétention + demandes de l'usager bornées par le RLS, création
  de demande avec usager imposé) et **liste des usagers** `/usagers` (motif de l'annuaire
  Clara, entrée de rail : recherche par mot-clé, filtres type / actifs-archivés /
  quartier / volumétrie de demandes, tri par colonne, export CSV — fiches du Socle et
  compteurs Iris bornés par le RLS, rapprochés dans le navigateur) →
  [`src/features/contacts/CLAUDE.md`](src/features/contacts/CLAUDE.md).
- **Recherche globale** (`src/features/search`, barre au centre du header) : une saisie, deux
  natures — **demande** (code de suivi, libellé, date de dépôt, statut, agent instructeur,
  organisme responsable) et **usager** (nom, prénom, ville) —, résultats **groupés par nature**,
  lancée dès **3 caractères** avec temporisation. Deux sources qu'aucun serveur ne joint : les
  demandes par la RPC `search_requests` (`SECURITY INVOKER`, **bornée par le RLS**), les
  usagers par `socle-proxy /v1/contacts/search` — donc seulement pour qui a un droit de
  création (RM-64), et **sans aucune rétention**. Socle muet ⇒ le groupe « Usagers »
  disparaît, les demandes restent. La recherche porte sur la **référence et l'objet** seuls
  (ni corps, ni formulaire figé) et **ignore les accents** (`unaccent` + index GIN trigramme,
  `20260901130000`) : la normalisation vit au SERVEUR, seul endroit d'où les deux côtés de la
  comparaison se voient — aucun jumeau JavaScript. ⚠️ Côté **usagers**, la recherche du Socle
  (`ilike` sur `display_name` brut) reste sensible aux accents : le correctif lui appartient →
  [`src/features/search/CLAUDE.md`](src/features/search/CLAUDE.md).
- **Droits / Paramètres** (`src/features/permissions`, `src/features/rights`) : profils de
  droits (création, matrice, périmètre, attribution), reflet pur des droits effectifs
  (`rights.ts`, miroir de `permission_pairs_of`), zone `/parametres` (`AdminRoute`, accueil
  en blocs cliquables au motif Clara) →
  doctrine dans [`docs/droits.md`](docs/droits.md), détail front dans
  [`src/features/permissions/CLAUDE.md`](src/features/permissions/CLAUDE.md).
- **Notifications** (`src/features/notifications`, edge `notifications-mailer`) : cloche du
  header **et e-mail**, sept motifs (affectation, retrait d'affectation, changement de statut,
  note interne, mention, nouvelle demande dans le périmètre d'instruction, et — depuis le
  2026-09-01 — **demande transférée** à l'organisme qu'on instruit). **La base est le seul
  producteur** — triggers `t40_*` `SECURITY DEFINER`, aucune policy d'écriture cliente, jamais
  de notification pour son propre geste ; temps réel + repli par sondage. **Un événement, une
  ligne, N canaux** : l'e-mail part d'une **boîte d'envoi** drainée sur cron (jamais du
  déclencheur), et `notification_preferences` (*fail open*, **globales au compte**) décide des
  canaux, réglées depuis « Mon compte » →
  [`src/features/notifications/CLAUDE.md`](src/features/notifications/CLAUDE.md).
- **Mon compte** (`src/features/account`, route `/mon-compte`, entrée du menu compte) :
  identité et **photo de profil** (bucket privé `avatars`, URL signée — jamais public : la
  photo d'un agent est une donnée personnelle), **changement de mot de passe** avec
  revérification de l'ancien, et **préférences de notification** par événement × canal
  (in-app / e-mail / rien). Photo et préférences sont **globales au compte**, pas par tenant. L'**adresse e-mail n'est pas modifiable par son titulaire** :
  c'est l'identifiant de connexion, administré — garde `t03_users_protect_email`, l'UI ne fait
  que refléter →
  [`src/features/account/CLAUDE.md`](src/features/account/CLAUDE.md).
- **Modèles d'e-mail** (`src/features/templates`, Paramètres › « Modèles d'e-mail » et
  « Organisations ») : textes réutilisables pour répondre à un usager, à **variables**
  `{{groupe.cle}}` (catalogue FIGÉ, jumeau SQL, garde serveur `t03`), CRUD réservé aux
  administrateurs, et **activation organisation par organisation** (`has_admin_scope` :
  ouvrir un modèle à la Voirie est une décision sur la Voirie ; un modèle neuf n'est actif
  nulle part). Texte BRUT — ni HTML ni PDF : la mise en page d'un pli est le métier de Clara
  (D7, Q8) →
  [`src/features/templates/CLAUDE.md`](src/features/templates/CLAUDE.md).
- **Zone superadmin** (`src/features/superadmin`) : organisations (consultation),
  utilisateurs, edge function `admin-users` (les plafonds IA ont quitté Iris le 2026-08-29 :
  ils se règlent dans le Socle, seul à voir la dépense de toute la gamme) →
  [`src/features/superadmin/CLAUDE.md`](src/features/superadmin/CLAUDE.md).
- **Ce qui sort d'Iris vers un fournisseur IA** (assistant, 2026-08-29) : le contexte métier
  d'une demande **SANS l'identité de l'usager** — la première défense est le `select`
  (`REQUEST_CONTEXT_COLUMNS` ne demande ni `requester_snapshot`, ni `socle_contact_id`, ni
  `identity_status`), la seconde le retrait des clés du catalogue `DECLARED_KEYS` dans
  `form_data`. La promesse est BORNÉE et écrite partout, jusque dans l'UI : *aucun champ
  d'identité connu ne sort ; un nom en texte libre peut passer*. Le **lieu d'intervention
  reste** (un lieu n'est pas une personne). Le prompt système, le contexte et la base de
  connaissances sont composés **côté serveur** — jamais acceptés du navigateur, dont
  l'historique de conversation est une entrée non fiable. Détail :
  [`docs/assistant-ia.md`](docs/assistant-ia.md).
- **Plafond d'utilisation IA — DANS LE SOCLE, plus dans Iris** (2026-08-29) : la clé du
  fournisseur LLM et la comptabilité des jetons ont été centralisées dans le référentiel
  (`ai-api`). Le plafond est celui de la **collectivité**, **commun à toute la gamme** — Iris et
  Clara puisent au même seau —, défini par l'admin plateforme dans le Socle et **consulté en
  lecture seule** par l'administrateur du tenant (Paramètres › Assistant IA). Les trois tables
  `ai_usage_*` d'Iris ont été **supprimées** (`20260829120000`) : les laisser n'aurait pas
  laissé du code mort mais un **second compteur**, qui aurait affiché zéro à qui l'aurait lu.
  ⚠️ La lecture passe par **`socle-proxy /v1/ai/usage`**, donc en service role : le RLS ne garde
  plus rien et la garde administrateur est **réécrite dans la fonction**
  (`is_org_admin_anywhere_for`). Détail : [`docs/assistant-ia.md`](docs/assistant-ia.md), et
  côté Socle `CLAUDE.md` § « guichet IA ».
- **Assistant IA d'instruction** (`src/features/requests/assistant`, edge `request-assistant`,
  modules purs `supabase/functions/_shared/ai/`) : conversation avec un assistant Mistral, dans
  le sous-onglet « Assistant » du panneau Procédure — à l'instruction (contexte de la demande)
  comme au guichet (**démarche seule**, aucune saisie en cours). **Conversation ÉPHÉMÈRE** :
  aucune table, le fil disparaît au rechargement. Droit exigé : **instruction** sur le couple,
  ou un droit de création au guichet.
  ⚠️ **Iris n'appelle pas Mistral** : il compose le prompt — ce qu'il est seul à savoir faire,
  le Socle ignorant ce qu'est une demande — et le confie au guichet `ai-api`, qui réserve,
  appelle et solde. **Iris décide ce qui est dit, le Socle décide si ça peut l'être et ce que ça
  a coûté.** Aucun secret du fournisseur ne vit ici ; la clé Socle d'Iris porte le scope `ai` et
  l'imputation `consumer = iris`. Les refus du guichet sont retraduits par
  `_shared/ai/socleErrors.ts` (pur, testé) : une erreur d'authentification n'est **jamais**
  relayée, un 400 est **notre** bug, et le 429 relaie le message du Socle **mot pour mot** —
  seul lui connaît la date de renouvellement.
  ⚠️ **Chaîne de délais à ne pas inverser : Mistral 55 s < Socle 60 s < Iris 75 s.** Inversée,
  Iris abandonne des appels que le Socle termine et **facture**.
  ⚠️ Un Socle injoignable **éteint** l'assistant (il le dégradait avant) — assumé, et le message
  rappelle que l'instruction des demandes continue →
  [`docs/assistant-ia.md`](docs/assistant-ia.md).

## Conventions

- **Organisation par feature** sous `src/features/<domaine>/` (hook `useX.ts`, dialogues,
  pages). Primitives UI génériques dans `src/components/ui/`, layout dans
  `src/components/layout/`.
- **Données serveur = TanStack Query** : un hook `useXxx` par ressource, `queryKey` explicite,
  invalidation dans `onSuccess`. Pas d'appel `supabase` direct dans les composants de page.
- **Logique métier en modules purs testés** (sans DOM ni réseau), y compris la logique des edge
  functions co-localisée dans `_shared/` sans dépendance Deno (le `include` vitest couvre
  `supabase/functions/**`).
- **Design system Notch/Ariane** — source de vérité : le projet Claude Design
  « Ariane Design System » (`019e2566-e3ff-75e7-80a9-af82c9b99671`, accessible via DesignSync).
  Les tokens de `colors_and_type.css` y sont **copiés tels quels** dans `src/index.css`
  (recommandation MUTUALISATION.md §2.1) : primaire vert AA `hsl(153 90% 32%)`
  (+ `--primary-bright` marketing), secondaire beurre, radius 14px, ombres « airbnb »
  (`shadow-airbnb-sm…xl`, alias `iris-*`). **Police : Nunito Sans, seule famille**
  (Google Fonts). Le shell agent calque le **shell de production Clara** : header sticky
  `h-14` (wordmark `src/assets/logo-notch.svg` en `h-6` + séparateur + tenant à gauche ;
  à droite, chip administrateur, superadmin, **accès aux Paramètres** — tuile `h-9 w-9`,
  active en `bg-primary/10 text-primary` — puis menu compte), **rail vert `bg-primary` 52px**
  (tuiles 36px, icônes Lucide 20px, premier item épinglé, groupe centré ; l'entrée active se
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
  [`docs/dette-technique.md`](docs/dette-technique.md).
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
  recalculer le quartier). **Aucun point n'est stocké côté Iris**, ni aucune géométrie de
  quartier. Substituables sans toucher au code par `VITE_MAP_TILE_URL` / `VITE_GEOCODE_URL`
  (fournisseur dédié le jour où le volume l'exige).
- **Saisie d'adresse assistée** (`src/lib/adresse.ts` + `src/components/address/`) : une
  **ligne unique** qui propose les adresses du référentiel (combobox ARIA, ↑ ↓ / Entrée /
  Échap), un dépliant « Plus de champs » limité à ce que le contrat porte vraiment, une
  **carte de contrôle** et « Utiliser ma position ». **Il propose, il ne garde pas la
  porte** : retenir une proposition est toujours facultatif, la BAN ne couvre ni les adresses
  neuves ni l'étranger, et une panne du service n'empêche jamais de saisir.
- Textes et libellés **en français**. Formulaires en `Dialog`, confirmations destructives en
  `AlertDialog`, classes fusionnées avec `cn()`.
- Documentation : un document = un public + une question ; toute évolution de surface de
  contrat (futures API) sera tracée dans un `docs/api-changelog.md` append-only.
