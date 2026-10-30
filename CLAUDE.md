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

## Comment lire cette documentation

Ce fichier est un **index** (2026-10-30, motif du Socle) : chargé en entier à chaque session,
il ne garde que les règles transverses et, par feature, ce qu'il faut savoir **avant** d'ouvrir
sa fiche. Le détail — décisions datées, pièges, pointeurs de code — vit dans
**`docs/features/*.md`** (fiches transverses et écrans du parcours agent) et dans le
`CLAUDE.md` de chaque dossier de feature (chargé quand on y travaille). **Un nouveau détail
s'écrit dans la fiche, jamais ici.** `src/claudeMd.test.ts` tient chaque `CLAUDE.md` sous
40 000 caractères et vérifie que fiches et liens ne se perdent pas de vue.

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
  → [`docs/features/profils-de-droits.md`](docs/features/profils-de-droits.md),
  [`docs/droits.md`](docs/droits.md).
- **Workflow fixe à 7 statuts** (décision PO) : `a_traiter`, `en_instruction`, `en_attente`,
  `annulee`, `resolue_positive`, `resolue_negative`, `archivee`. Gardes de transition
  **serveur** (trigger), jamais UI seulement. « Résolue positivement » exige un passage par
  l'instruction — et que toute pièce **obligatoire** ait été qualifiée conforme
  (`t17_requests_require_pieces_conformes`). `en_attente` s'intitule « En attente
  d'information » : c'est là que va une demande dont une pièce est déclarée non conforme.
  Aucun 8ᵉ statut n'est à créer pour un nouveau besoin d'attente.
  **Résolution commune des demandes liées** (même incident, décision PO 2026-10-16) : une
  demande « À traiter » se résout avec son groupe sans geste préalable — c'est la RPC
  `resolve_linked_requests` qui l'ENCHAÎNE par l'instruction, la matrice de la garde n'est pas
  ouverte ; l'agent qui résout devient l'instructeur des demandes qui n'en ont pas
  ([`docs/demandes-liees.md`](docs/demandes-liees.md)).
- **Vocabulaire** : « catégorie » désigne exclusivement les catégories de **démarches** du
  Socle. La position d'une demande dans son cycle de vie est un **statut**. L'organisation
  Socle qui reçoit et traite une demande s'appelle **organisme** partout où un agent la lit —
  les clés de code, elles, restent `destinataire` (état d'écran, `?destinataire=`, variable
  d'e-mail `{{demande.destinataire}}` d'un catalogue FIGÉ).
- **Iris ne gère aucune demande libre** (PO, 2026-08-20) : toute nouvelle demande est
  **fondée sur une démarche Socle active du tenant** (`socle_procedure_id` +
  `procedure_snapshot`, trigger `t16_requests_require_procedure`, service_role compris), et le
  **snapshot est construit côté serveur**, jamais accepté d'un navigateur ou d'un partenaire.
  Ce qui ne relève d'aucune démarche est une **« demande complexe »**, relayée à Clara sans
  qu'Iris en garde ni ligne ni octet. Une démarche **en brouillon** n'est proposée nulle part
  (garde serveur) ; **interne** ou **hors période de publication**, elle est masquée sans
  refus ; **non activée pour l'organisme** (`t18_requests_require_procedure_active`, opt-in
  strict), elle est masquée ET refusée. ⚠️ `procedures.is_active_global` du Socle est mort
  → [`docs/features/demarches.md`](docs/features/demarches.md).
- **Aucun miroir local d'usagers** : les contacts vivent dans le Socle, lus / rapprochés /
  créés / corrigés via `socle-proxy`. **Une identité sans correspondance est une nouvelle
  personne : on la CRÉE dans le Socle** ; à l'ingestion, une fiche n'est réutilisée que sur un
  **identifiant fort**. « Sans rapprochement » n'est qu'une sortie de secours, **jamais en
  silence** (anomalie `usager_a_creer_dans_socle`). Iris ne conserve que le
  `requester_snapshot`, **immuable** — et seule identité qui existe pour un dépôt anonyme ou
  non rapproché → [`docs/features/usagers-et-identite.md`](docs/features/usagers-et-identite.md).
- **Aucune suppression de demande** (pièce administrative) : pas de policy DELETE, FK
  `ON DELETE RESTRICT` depuis le tenant, purge RGPD par procédure `service_role` dédiée.
  **Les statistiques survivent à cette purge** (PO 2026-09-18) : tables de faits
  `request_stats` / `intervention_stats`, sans donnée d'usager ni FK vers la demande,
  alimentées par trigger `t31_*`, jamais purgées ; l'écran ne lit jamais `requests`. Un script
  qui supprime des demandes de test doit vider les faits correspondants.
- **Aucun octet n'entre dans le bucket des pièces depuis un navigateur** (2026-09-08) : porte
  unique `supabase/functions/_shared/files/receive.ts` (liste FERMÉE de signatures binaires),
  zone d'attente `attachment_uploads` consommée par les seules RPC métier ; le client ne
  désigne un fichier que par `upload_id`. Aucune policy d'écriture cliente sur
  `request_attachments` ni `storage.objects`. Pas d'antivirus : la liste fermée est la défense
  → [`docs/features/pieces-justificatives.md`](docs/features/pieces-justificatives.md).
- **Consentements RGPD au dépôt** (2026-09-20) : deux questions SYSTÉMATIQUES, `traitement`
  (OBLIGATOIRE) et `partage` (facultatif, proposé coché), **jamais des champs de
  `form_schema`**, catalogue FERMÉ (`_shared/consents/catalog.ts`). Le navigateur n'envoie que
  `kind` et `granted` ; la phrase est recomposée côté serveur (`normalizeConsents`). Deux
  écritures : Socle (la personne) et `requests.consents` (ce dépôt, immuable) ; un échec Socle
  ne refuse jamais le dépôt → [`docs/features/consentements.md`](docs/features/consentements.md).
- **La messagerie de l'usager est FERMÉE par défaut** (PO 2026-10-25) : **une ouverture = une
  réponse**, gardé en base (`request_citizen_reply_state`, `record_citizen_message` refuse en
  `P0423`) → [`docs/features/echanges-usager.md`](docs/features/echanges-usager.md).
- Les **notes internes ne quittent jamais Iris** (miroir de la règle `internal_notes` du
  Socle) ; le texte de clôture destiné à l'usager est un objet distinct, facultatif, repris
  dans l'avis de clôture. Seule sortie : le scope `requests:read_tenant` de l'API (timeline).
- **Aucun mot de passe n'est généré ni affiché à un administrateur** : invitation et lien de
  réinitialisation. Le **serveur d'envoi ne se configure pas dans Iris** : `smtp_settings` est
  un miroir du Socle, mot de passe au **Vault**, aucune surface cliente
  → [`docs/features/emails.md`](docs/features/emails.md), [`docs/emails.md`](docs/emails.md).
- **Profils de droits** (PO, 2026-08-22) : droits par **couple** (organisation porteuse,
  démarche) — `création` / `instruction` / `clôture`, chacun impliquant `consultation`, défauts
  *fail closed*. L'**administration**, l'attribut **intervenant** et l'attribut **base de
  connaissances** n'accordent par eux-mêmes aucun droit sur les demandes. Les tables
  `permission_*` n'ont aucune policy d'écriture cliente : les RPC sont l'unique porte
  → [`docs/features/profils-de-droits.md`](docs/features/profils-de-droits.md).

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
  `/nouveau-mot-de-passe`, **`/api-doc`** (contrat d'ingestion rendu par Redoc, servi par
  l'app — jamais par l'edge function, dont la passerelle force le HTML en `text/plain`), et une
  route catch-all 404 (`NotFoundPage`).
- **Zone authentifiée** : `ProtectedRoute` › `AppShell` (rail + header), page d'accueil
  `DashboardPage` (tableau de bord, flux lus dans les faits insensibles à la purge, périmètre =
  ce que le RLS laisse lire →
  [`src/features/dashboard/CLAUDE.md`](src/features/dashboard/CLAUDE.md)).
- **Fondations et API d'ingestion `requests-api`** : modèle multi-source
  (`integration_sources`…, aucune logique spécifique à un émetteur), contrat OpenAPI sur
  `/v1/openapi.json`, périmètre dérivé de la clé (sauf clé PLATEFORME), démarche obligatoire,
  rejeu identique → 200 / divergent → 409 →
  [`docs/features/ingestion-partenaires.md`](docs/features/ingestion-partenaires.md),
  guide consommateurs [`docs/api-ingestion.md`](docs/api-ingestion.md), tables et gardes
  [`docs/data-model.md`](docs/data-model.md). Tests d'étanchéité :
  `supabase/tests/fondations.test.sql` + `supabase/tests/profils-droits.test.sql`.
- **`socle-proxy`** (edge, JWT vérifié en code + périmètre) : la seule route du navigateur vers
  le référentiel. Réponses **sanitisées par whitelist** (`_shared/sanitize.ts`) —
  `internal_notes`, relations, `external_references` ne passent jamais ; `X-Organization-Id`
  toujours dérivé côté serveur ; les routes `organizations/*` ne prennent **aucun identifiant
  du navigateur** ; `/v1/ai/usage` est réservée aux administrateurs, **garde réécrite dans la
  fonction** → [`docs/features/socle-proxy.md`](docs/features/socle-proxy.md).
- **E-mails** : gabarit unique `supabase/functions/_shared/email/`, serveur d'envoi hérité du
  Socle avec repli `IRIS_SMTP_*`. Chemins : `auth-email-hook`, `admin-users`,
  `send-request-email` (réponse et avis de clôture), accusé de réception enfilé
  (`request_receipts`, drainé par `notifications-mailer`, jamais pour une demande issue de
  Clara). Charte de la collectivité lue chez le Socle, jamais bloquante
  → [`docs/features/emails.md`](docs/features/emails.md).
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

## Index des features

Chaque dossier de feature a son `CLAUDE.md`, chargé automatiquement quand on y travaille ;
les invariants ci-dessus restent la référence.

- **Parcours agent** (`src/features/requests`, `src/features/tenant`) : liste, fiche,
  création guidée, échanges, pièces, transfert, documents, interventions, carte, tableau —
  index des fiches dans [`src/features/requests/CLAUDE.md`](src/features/requests/CLAUDE.md).
  ⚠️ Le transfert passe par la RPC `transfer_request`, **seule porte**.
  Fiches : [création](docs/features/creation-de-demande.md),
  [liste](docs/features/liste-des-demandes.md),
  [fiche d'instruction](docs/features/fiche-instruction.md),
  [échanges](docs/features/echanges-usager.md),
  [pièces](docs/features/pieces-justificatives.md),
  [transfert](docs/features/transfert-organisme.md),
  [documents](docs/features/documents-instruction.md),
  [interventions](docs/features/interventions.md),
  [carte](docs/features/carte-des-interventions.md),
  [tableau](docs/features/tableau-des-demandes.md),
  [mobile](docs/features/demandes-mobile.md).
- **Demande complexe** (`src/features/requests/complexe`, edge `relay-courrier-clara`) :
  relayée à Clara de serveur à serveur, rien n'est stocké, idempotence par `submission_id`
  → [`docs/features/demande-complexe.md`](docs/features/demande-complexe.md).
- **Contacts / Usagers** (`src/features/contacts`) : identification du demandeur, fiche
  usager `/usagers/:contactId`, liste `/usagers` — fiches du Socle sans rétention, compteurs
  Iris bornés par le RLS → [`src/features/contacts/CLAUDE.md`](src/features/contacts/CLAUDE.md).
- **Base de connaissances** (`src/features/knowledge`, `/base-de-connaissances`) : catalogue
  des démarches publiées et recommandations générales de la collectivité (rédigées dans le
  Socle) ; ouverte par `knowledge_base_access` — un écran, pas une frontière de données
  → [`src/features/knowledge/CLAUDE.md`](src/features/knowledge/CLAUDE.md).
- **Statistiques** (`src/features/stats`, `/statistiques`) : motif Clara, RPC `stats_*`
  `SECURITY INVOKER` sur les tables de faits, bornées par les droits de consultation
  → [`src/features/stats/CLAUDE.md`](src/features/stats/CLAUDE.md).
- **Recherche globale** (`src/features/search`) : demandes par `search_requests` (RLS,
  `unaccent` côté serveur, aucun jumeau JS), usagers par `socle-proxy` (droit de création,
  sans rétention) → [`src/features/search/CLAUDE.md`](src/features/search/CLAUDE.md).
- **Droits / Paramètres** (`src/features/permissions`, `src/features/rights`) : profils,
  reflet pur `rights.ts` (miroir de `permission_pairs_of`), zone `/parametres` (`AdminRoute`)
  → [`src/features/permissions/CLAUDE.md`](src/features/permissions/CLAUDE.md).
- **Notifications** (`src/features/notifications`, edges `notifications-mailer`,
  `notifications-push`) : la base est le seul producteur (`t40_*`), un événement = une ligne,
  N canaux (in-app, e-mail, push par appareil)
  → [`src/features/notifications/CLAUDE.md`](src/features/notifications/CLAUDE.md).
- **Mon compte** (`src/features/account`, `/mon-compte`) : photo (bucket privé), mot de passe,
  préférences ; l'e-mail n'est pas modifiable par son titulaire (`t03_users_protect_email`)
  → [`src/features/account/CLAUDE.md`](src/features/account/CLAUDE.md).
- **Modèles d'e-mail** (`src/features/templates`) : variables `{{groupe.cle}}` d'un catalogue
  FIGÉ, activation organisation par organisation, texte BRUT
  → [`src/features/templates/CLAUDE.md`](src/features/templates/CLAUDE.md).
- **Zone superadmin** (`src/features/superadmin`) : organisations, utilisateurs, edge
  `admin-users` → [`src/features/superadmin/CLAUDE.md`](src/features/superadmin/CLAUDE.md).
- **Assistants IA** (assistant d'instruction, rédaction assistée des échanges, rapprochement
  des demandes liées) : **Iris n'appelle pas Mistral**, il compose le prompt côté serveur et le
  confie au guichet `ai-api` du Socle, qui porte le plafond. Aucun champ d'identité connu ne
  sort ; jamais les notes internes dans un brouillon. ⚠️ Chaîne de délais **Mistral 55 s <
  Socle 60 s < Iris 75 s** à ne pas inverser
  → [`docs/features/assistants-ia.md`](docs/features/assistants-ia.md),
  [`docs/assistant-ia.md`](docs/assistant-ia.md).

## Conventions

- **Mobile = pages dédiées, même URL** (PO 2026-09-14) : les écrans de bureau ne sont pas
  responsives ; `Adaptive` rend la page mobile sous 768 px (ou commutateur mémorisé — jamais
  le User-Agent). Chaque écran mobile **réutilise les hooks et modules purs du bureau, jamais
  un second chemin d'écriture** → [`src/components/layout/CLAUDE.md`](src/components/layout/CLAUDE.md).
- **Organisation par feature** sous `src/features/<domaine>/` (hook `useX.ts`, dialogues,
  pages). Primitives UI génériques dans `src/components/ui/`, layout dans
  `src/components/layout/`.
- **Données serveur = TanStack Query** : un hook `useXxx` par ressource, `queryKey` explicite,
  invalidation dans `onSuccess`. Pas d'appel `supabase` direct dans les composants de page.
- **Logique métier en modules purs testés** (sans DOM ni réseau), y compris la logique des edge
  functions co-localisée dans `_shared/` sans dépendance Deno (le `include` vitest couvre
  `supabase/functions/**`).
- **Design system Notch/Ariane** (projet Claude Design « Ariane Design System », tokens copiés
  tels quels dans `src/index.css`, police Nunito Sans seule) et **shell calqué sur Clara**
  (header `h-14`, rail vert 52 px, entrée active décidée par `nav.ts`, gabarit demandé par la
  page via `shellLayout.tsx`, Paramètres hors du rail). ⚠️ `_adherence.oxlintrc.json` ne
  s'exécute plus (dette O1) → [`docs/features/shell-et-design-system.md`](docs/features/shell-et-design-system.md).
- **Cartographie libre et saisie d'adresse** : tuiles OpenStreetMap (attribution ODbL
  obligatoire), géocodage BAN via la Géoplateforme, sans clé. Ce qui transite, c'est une
  **ADRESSE et rien qui l'accompagne**. **Iris ne géocode jamais pour stocker** ; le point
  déclaré par l'usager (`location`) est une réponse au formulaire et prime. La saisie
  assistée **propose, elle ne garde pas la porte**
  → [`docs/features/adresse-et-cartographie.md`](docs/features/adresse-et-cartographie.md).
- Textes et libellés **en français**. Formulaires en `Dialog`, confirmations destructives en
  `AlertDialog`, classes fusionnées avec `cn()`.
- Documentation : un document = un public + une question ; toute évolution de surface de
  contrat (futures API) sera tracée dans un `docs/api-changelog.md` append-only. Le détail
  d'une feature s'écrit dans sa fiche `docs/features/` ou dans le `CLAUDE.md` de son dossier.
