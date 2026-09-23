# Dette technique — backlog

> **Public** : équipe Iris · **Question traitée** : qu'est-ce qui est assumé comme dette, et
> que faut-il faire pour la solder ? · **Dernière mise à jour** : 2026-09-23

Ce document ne recopie rien : il ne porte que la dette **sans autre domicile** (outillage,
conventions, transverse). La dette de modèle de données et d'API vit là où elle se constate :

| Où | Quoi |
|---|---|
| [`data-model.md`](data-model.md) § Écarts et suites | Outbox non branchée (phase 4), purge RGPD (phase 5), FK non indexées de l'audit, `version` incrémentée par le recalcul de périmètre, archivage d'usager non repris |
| [`api-ingestion.md`](api-ingestion.md) § 3 | ~~Worker de copie des pièces ingérées non actif~~ — **fermé le 2026-09-08** : le mode pull est retiré (contrat 2.0.0), les partenaires déposent les octets sur `POST /v1/uploads` ; purge de la zone d'attente et outbox de suppression des objets livrées le même jour (`attachments-maintenance`). Reste : la **purge RGPD des demandes** (`retention_until`, levée de `t01`) — l'outbox la rend désormais possible sans orphelin |
| [`droits.md`](droits.md) | `organization_members.role` subsiste en colonne dérivée transitoire, à retirer |

## O1 — Le garde-fou du design system ne s'exécute plus

**Constat (2026-08-23)** : `npx oxlint -c _adherence.oxlintrc.json src` échoue au chargement
de la configuration :

```
x Rule 'no-restricted-syntax' not found in plugin 'eslint'
```

oxlint (1.79.0 ici, tiré par `npx` — le paquet n'est **pas** une dépendance du projet)
n'implémente pas `no-restricted-syntax`, qui suppose un moteur de sélecteurs ESTree. Les trois
règles d'adhérence (hex bruts, px bruts, polices hors DS) ne sont donc **jamais évaluées** :
le fichier `_adherence.oxlintrc.json` documente une intention, il ne garde rien.

**Pourquoi ça compte** : le respect du design system Notch/Ariane repose aujourd'hui
entièrement sur la relecture humaine. Rien n'échouerait si une couleur en dur entrait dans le
code.

**État réel du code, mesuré le 2026-08-23** (avant tout correctif) :

- **0 couleur hexadécimale brute** dans `src/**` — la règle qui compte n'a rien à rattraper ;
- **231 occurrences de `px`**, presque toutes des **valeurs arbitraires Tailwind légitimes**
  (`w-[52px]` du rail, `text-[13px]`, `min-w-[240px]`) qui reproduisent *littéralement* la
  spécification du shell. La règle « px brut », telle qu'écrite, produirait donc surtout du
  bruit.

**Piste recommandée** (petit item, à faire d'un bloc) :

1. Re-scoper les règles : garder **hex bruts** et **polices hors DS** (celles qui protègent
   vraiment le DS), abandonner la règle « px brut » ou la restreindre aux styles inline
   (`style={{ … }}`), où la valeur échappe réellement aux tokens.
2. Remplacer le porteur : plutôt qu'un oxlint tiré par `npx` avec une règle qu'il n'a pas, un
   **test vitest** qui balaie `src/**` (module pur + test, convention du dépôt) — il tourne
   avec `npm test`, échoue en CI, et ne dépend d'aucun outil externe. Sinon, un vrai ESLint
   plat en `devDependency`, ce que le projet a explicitement évité jusqu'ici (`npm run lint`
   = `tsc -b` seul).
3. Supprimer `_adherence.oxlintrc.json` une fois le porteur remplacé, pour ne pas laisser un
   fichier qui promet une garde inexistante.

Repéré en livrant la page `/api-doc` (la vérification d'adhérence des nouveaux fichiers a dû
se faire à la main : aucun hex ni px brut).

## O2 — Deux chemins livrés sans épreuve de bout en bout

**Constat (2026-08-26)** : la règle « sans correspondance, on crée l'usager dans le Socle »
(décision PO) est couverte par des tests unitaires — `isSocleOutage`, `hasStrongMatch`,
`contactCreatePayload`, `matchIdentityFromDeclared` — et le retrait de « Poursuivre sans
rapprochement » a été vérifié en navigateur. Mais **deux chemins n'ont jamais tourné en
réel** :

- **la sortie de secours** (panne avérée du Socle) : il faudrait provoquer une indisponibilité
  de `contacts-api`, ou injecter une erreur dans `socle-proxy` ;
- **l'ingestion `requests-api`** (rapprochement puis création) : il faudrait poster une demande
  réelle, qui **ne se supprime jamais**, et qui créerait au passage une fiche de test dans le
  référentiel Socle.

**Pourquoi ça compte** : ce sont précisément les chemins qui écrivent dans le référentiel
d'une autre application de la gamme. Un défaut y produit des fiches parasites que personne ne
verra passer.

**Piste** : campagne E2E avec seed à UUID fixes et migration de cleanup, sur le motif du
2026-08-22 (voir la convention dans les tests SQL) — en y ajoutant la purge des fiches Socle
créées, que le cleanup Iris ne couvre pas.

## O3 — Doublons d'usagers attendus à l'ingestion

**Constat (2026-08-26)** : à l'ingestion, une fiche existante n'est réutilisée que sur un
**identifiant fort** (courriel, téléphone, SIRET). Un partenaire qui envoie deux fois le même
habitant **sans** identifiant fort créera **deux fiches** dans le Socle.

**C'est un choix, pas un oubli.** L'alternative — rapprocher sur le nom — a été écartée :
aucun agent n'arbitre les homonymes à l'ingestion, et rattacher la demande d'un habitant à son
homonyme lui donnerait accès aux échanges d'un autre. Un doublon se fusionne ; une fuite, non.

**Ce qui a été fait pour le borner** : le contrat OpenAPI 1.2.0 et
[`api-changelog.md`](api-changelog.md) disent explicitement aux émetteurs d'envoyer un
identifiant fort chaque fois qu'ils en ont un.

**Piste, si le volume devient gênant** : le levier n'est pas dans Iris mais dans la **fusion
de fiches** côté Socle. À défaut, un rapport « fiches créées par l'ingestion, sans identifiant
fort » permettrait au moins de les repérer.

## O4 — Deux leviers de volumétrie repérés et volontairement non pris

**Constat (2026-08-26)**, mesuré sur la base réelle en répondant à une question du PO sur le
coût des snapshots :

- `procedure_snapshot.requester_config` pèse **668 octets par demande** et n'est **jamais relu
  après la création** — ses deux seuls consommateurs (`creation/NewRequestPage.tsx`,
  `create-request-from-procedure/index.ts`) lisent la démarche **rechargée depuis Socle**, pas
  le snapshot de la demande. C'est un tiers du plus gros JSONB de la table. Le retirer de la
  whitelist coûterait la trace de ce que la démarche exigeait comme identité au dépôt.
- `useNearbyRequests` (`creation/useCreationData.ts`) filtre par `ilike` sur
  `requester_snapshot->declared->>{field}` : **aucun index** ne couvre ce chemin, c'est un
  balayage séquentiel des demandes du tenant. C'est aussi la raison pour laquelle
  `toast_tuple_target` a été réglé à 1024 et pas plus bas — sortir `requester_snapshot` de la
  ligne rendrait ce balayage nettement plus coûteux.

**Pourquoi ne rien faire maintenant** : le volume visé est de quelques dizaines de milliers de
demandes par collectivité (PO, 2026-08-26). À cette échelle, rien de tout cela ne se voit.
Détail et chiffres : [`data-model.md`](data-model.md) § « Pourquoi figer l'identité au dépôt ».

## O5 — Une migration appliquée sans miroir dans le dépôt

**Constat (2026-08-26)** : `echanges_usager_commentaire_purge` (appliquée le 2026-08-26 à
16:05 UTC) n'a **pas** de fichier miroir dans `supabase/migrations/`. La convention du dépôt
veut que toute migration appliquée y laisse son jumeau, faute de quoi un rejeu du schéma
depuis zéro ne reproduit pas la base.

**Piste** : relire la définition appliquée (`supabase_migrations.schema_migrations`) et écrire
le miroir manquant. Antérieure aux travaux du 26 août au soir ; repérée en ajoutant les deux
migrations de cette vague.

## O6 — L'assistant IA peut être facturé deux fois, et rien ne borne son débit

**Constat (2026-08-29)**, deux coûts assumés à la centralisation de l'IA dans le Socle.

**a) Double facturation possible.** Iris confie l'appel au guichet du Socle, qui réserve,
appelle le fournisseur et solde. Si Iris **expire pendant que le Socle réussit**, l'agent voit
un échec, réessaie, et la collectivité paie deux fois. La parade habituelle — une clé
d'idempotence — **exige de stocker la réponse**, ce que la décision PO n°1 (passe-plat, rien
n'est persisté) interdit. Il n'y a donc pas de correctif, seulement une atténuation : la
**chaîne de délais Mistral 55 s < Socle 60 s < Iris 75 s**, qui rend le cas rare en rendant
l'abandon d'Iris plus tardif que la fin du Socle.

⚠️ **Ce qui doit être surveillé** : toute modification d'un de ces trois délais. Les inverser
transforme un cas rare en cas courant, sans qu'aucun test ne le voie.

**b) Aucun garde-fou de DÉBIT, nulle part.** Un plafond mensuel n'est pas un rate-limit : une
boucle accidentelle (un `useEffect` mal gardé, un agent qui laisse un onglet ouvert sur une
relance) brûle le mois en quelques minutes, et le refus n'arrive qu'une fois l'argent dépensé.

**Piste** : une seconde ligne de compteur à période **horaire** dans `ai_usage_counters`, côté
**Socle** — le mécanisme de réservation existe déjà, il ne manque qu'une seconde borne à
vérifier dans `reserve_ai_usage`. À arbitrer avec le PO : un plafond horaire trop bas gêne une
journée d'instruction chargée.

**c) Les LECTURES de sources ne sont pas bornées non plus** (2026-09-19, relecture de sécurité
de « répondre d'abord, proposer ensuite »). Les sources approuvées sont lues **avant** l'appel
au guichet : un agent qui relance en boucle une question avec quatre sources autorisées
retélécharge jusqu'à 100 Mo depuis le Socle et resollicite les sites tiers **même quand le
plafond IA est épuisé**, puisque le 429 n'arrive qu'après. Atténuations en place : cache des
textes (30 min pour un document, 10 min pour une page), **cache des échecs** (2 min), échéance
commune de 20 s, documents lus en série. Manque une vraie limite par utilisateur — en mémoire
d'instance elle serait approximative, en base elle coûte une écriture par question.

⚠️ **Le cache est en MÉMOIRE, par instance** : un démarrage à froid relit tout. C'est assumé
tant que rien n'est mesuré ; une table d'extraits serait la suite, avec sa purge.

## O7 — Les démarches internes sont masquées, et rien ne le rappellera

**Constat (2026-08-30)** : le sélecteur de démarche ne propose que les démarches
`type = 'externe'` (`useSocleProcedureRows`, et le même filtre dans `socle-proxy
/v1/procedures/list`). Ce n'est **pas** une règle métier — c'est une décision d'affichage
explicitement temporaire du PO (« les démarches internes seront affichées ultérieurement »).

**Pourquoi c'est de la dette** : la restriction est invisible depuis l'écran. Une démarche
interne paramétrée en production dans le Socle n'apparaît nulle part et **rien ne dit
pourquoi** — l'état vide du sélecteur mentionne le cas, mais un tenant qui a par ailleurs des
démarches externes ne verra jamais ce message. Le risque est d'oublier la ligne et de croire à
une panne de synchronisation.

**Ce qu'il faudra faire** : retirer les deux `.eq("type", "externe")` (hook + proxy) et décider
ce que le sélecteur en dit — vraisemblablement une facette « externe / interne » plutôt qu'un
mélange muet, puisque les deux publics ne se déposent pas de la même façon. **Aucune garde
serveur n'est à défaire** : elle n'a volontairement jamais été posée sur le type, contrairement
au statut `brouillon`.

## O8 — Ouvrir un client n'a aucun geste applicatif

**Constat (2026-09-13, ouverture de SNA27)** : rien dans Iris ne crée un **tenant**.
`/superadmin` › Organisations est consultation seule (« la hiérarchie se gère dans le Socle »),
et `sync-socle-referentiel` n'itère que sur les tenants **déjà** présents dans
`public.organizations` (`index.ts:247`) : une racine créée dans le Socle n'apparaît donc jamais
d'elle-même. Les trois premiers tenants avaient été posés à la main le 2026-08-20, sans seed
au dépôt ; le quatrième l'a été de la même façon.

**Pourquoi c'est de la dette** : l'ouverture d'un client tient aujourd'hui en quatre gestes
dont **un seul** a un écran — (1) `insert into public.organizations` (racine Socle),
(2) « Synchroniser maintenant », (3) `organization_members` pour chaque compte, y compris un
admin plateforme (le sélecteur d'organisation lit les appartenances, pas le RLS),
(4) les profils de droits, qu'aucun trigger ne crée pour un tenant neuf — ceux des trois
premiers viennent de la migration de reprise `20260822*`. Tant que (4) n'est pas fait, le
tenant est **en lecture seule à l'écran** même pour un admin plateforme : le SQL le laisserait
tout faire (`is_platform_admin()` court-circuite `requests_*` et `user_has_request_right`),
mais l'UI reflète les couples et est *fail closed* — `/demandes/nouvelle` répond « Vous n'avez
pas de droit de création de demande ». C'est aussi ce chemin qui a révélé le verrou circulaire
du dernier administrateur (corrigé par `20260921100000`, cf.
[`droits.md`](droits.md) § « Dernier administrateur »).

**Ce qu'il faudra faire** : un geste « Ouvrir un client » dans la zone superadmin — racine
Socle choisie dans le référentiel (proxy, jamais un UUID saisi), synchro immédiate,
rattachement de l'ouvrant, et **création des deux profils de reprise** (Administrateur, Agent)
dans la même transaction, par la RPC existante. Décision PO du 2026-09-13 : à faire plus tard,
le provisioning manuel tient pour l'instant.

## O9 — Le reste de l'audit purge / performance du 2026-09-23

**Constat** : l'audit transverse de la gamme (avant mise en production) a soldé le même jour la
plomberie pg_cron / pg_net — `cron.job_run_details` pesait 54 Mo, 73 % de la base, faute de
purge — et la rétention des journaux techniques (`purge_retention_journaux`, 03:30). Restent,
mesurés sur la base réelle (`pg_stat_statements`, advisors) :

- **6 policies RLS réévaluent `auth.uid()` à chaque ligne** (advisor `auth_rls_initplan`),
  toutes antérieures à la convention `(select auth.uid())` adoptée le 2026-08-22 (les tables
  `permission_*` et `notifications*` sont déjà corrigées, `20260822100900`) : `users_select`,
  `users_update` et `organization_members_select`
  (`20260820100000_identite_tenants_helpers.sql`), `request_messages_insert` / `_update` /
  `_delete` (`20260820100200_requests_satellites.sql`). Impact faible aujourd'hui (petites
  tables, opérations unitaires), correctif trivial sans changement de sémantique.
  ⚠️ `is_org_member(p_org_id)` et ses sœurs prennent un argument qui varie par ligne : les
  envelopper dans `(select …)` n'aurait pas de sens.
- **33 clés étrangères sans index** (advisor), surtout des colonnes d'auteur (`created_by`,
  `uploaded_by`, `assigned_by`…) et `organization_id` de tables satellites
  (`notifications`, `request_emails`, `request_interventions`, `integration_deliveries`). Aucune
  n'est sur un chemin chaud mesuré ; à reprendre quand une purge RGPD (phase 5) supprimera des
  utilisateurs ou des demandes — c'est là qu'un `ON DELETE` sans index balaie la table.
- **Temps réel** : le poller WAL de Realtime est la première charge CPU de la base (735 000
  appels, 71 min cumulées) pour la seule table `notifications`, doublée du filet
  `refetchInterval` de 60 s. Rien à faire au volume actuel ; piste le jour où le nombre
  d'agents connectés grandit : Realtime *Broadcast* émis par le trigger plutôt que
  `postgres_changes`.
- **Deux jobs à la minute** (`notifications-mailer`, `notifications-push`) : ~2 900 lignes/jour
  dans `cron.job_run_details` et `net._http_response`, bornées depuis le 2026-09-23 (7 jours,
  VACUUM nocturne). Clara a ramené son push à 3 minutes le 2026-09-22 pour la même raison ;
  à arbitrer par le PO (c'est le délai maximal d'un e-mail ou d'un push).
- **`integration_deliveries`** (outbox du retour vers Clara, phase 4) n'a pas encore
  d'écrivain : prévoir la purge des lignes `delivered` / `failed` **dans le même lot** que le
  worker, pas après coup.
