# Modèle de données — Iris

> **Public** : développeuses et développeurs travaillant sur Iris · **Question traitée** :
> quelles tables, contraintes, gardes et règles RLS portent les fondations ? ·
> **Dernière mise à jour** : 2026-08-22 · Schéma appliqué au projet Supabase
> `tqcoqlneybtbrrcvpkpk` (migrations fondations 1 à 5, plus le lot **profils de droits**
> `20260822100000` à `20260822100900`, miroirs dans `supabase/migrations/`).

Réfère l'architecture validée ([`architecture-proposee.md`](architecture-proposee.md)) ; en cas
d'écart, ce document décrit **l'état réel** du schéma. Sémantique métier des profils de droits,
correspondance droits ↔ actions, non-escalade, reprise : [`droits.md`](droits.md).

## Principes

- **Tenant Iris = organisation racine Socle** (`organizations.socle_org_id`). Pas de hiérarchie
  locale : les UUID Socle (racine, organisation destinataire, démarche, contact, type de PJ)
  sont des **références nues, sans FK inter-base**.
- **RLS activée sur toutes les tables** (+ event trigger `rls_auto_enable`, préexistant au
  projet et conservé : toute nouvelle table de `public` naît avec RLS). Le `service_role`
  contourne le RLS par attribut — **aucune policy « service » n'est écrite** (une policy au
  `TO` manquant s'ouvrirait à `authenticated`).
- **Visibilité et écriture par profils de droits** (décision PO, 2026-08-22, remplace le rôle
  binaire `agent | administrateur`) : la visibilité et les actions permises sur une demande
  sont gouvernées par la combinaison, **par couple** (organisation porteuse, démarche), des
  profils de droits actifs attribués à l'utilisateur — voir [`droits.md`](droits.md). Les 5
  tables `permission_*` **n'ont aucune policy d'écriture cliente** : les RPC de
  `20260822100400_profils_droits_rpc.sql` sont l'unique porte d'entrée (même posture que
  `t16_requests_require_procedure` — une garde qui ne tient qu'en RLS peut être contournée par
  une écriture directe hors du chemin prévu).
- **Workflow fixe à 7 statuts** (décision PO), gardé par trigger SQL — jamais par l'UI seule.
- **Aucune demande libre** (règle impérative PO, 2026-08-20) : toute **nouvelle** demande est
  fondée sur une **démarche Socle active du tenant** (`socle_procedure_id` + snapshot serveur),
  gardé par le trigger `t16_requests_require_procedure` — **service_role compris**. Les
  demandes historiques sans démarche restent lisibles et transitionnables.
- **Journal immuable** : `request_events`, `request_assignments` et `permission_audit_log`
  refusent UPDATE et DELETE par trigger (`forbid_change`), même en `service_role`.
- **Aucune suppression de demande** : pas de policy DELETE, FK tenant en `ON DELETE RESTRICT`.
  La purge RGPD passera par une procédure `service_role` dédiée (à venir).
- Écritures d'**ingestion** (sources `clara`, `portail`, `arpege`) : `service_role` uniquement —
  la policy INSERT cliente est verrouillée sur `source = 'iris'`.

## Helpers RLS (`SECURITY DEFINER`, `search_path = ''`)

### Fondations (miroirs 1 à 5)

| Fonction | Rôle | EXECUTE |
|---|---|---|
| `is_platform_admin()` | Admin plateforme | `authenticated` |
| `member_role(org_id)` | Rôle du membre courant dans le tenant (NULL sinon) — lit désormais la colonne **dérivée**, voir plus bas | `authenticated` |
| `is_org_member(org_id)` | Membre du tenant (ou plateforme) | `authenticated` |
| `is_org_admin(org_id)` | **Redéfinie (2026-08-22)** : administration sur la **racine** du tenant, au sens des profils de droits (`has_admin_scope`) — ne lit plus `organization_members.role`. Gouverne les gestes **globaux** (membres, journal des intégrations) ; les gestes liés à une demande précise passent par `has_admin_scope(org, socle_scope_org_id)` | `authenticated` |
| `shares_org_with(user_id)` | Partage d'au moins un tenant (visibilité des profils) | `authenticated` |
| `is_service_context()` | `current_user` ∈ postgres / service_role — ⚠️ **INVOKER volontaire**, ne jamais passer en DEFINER (voir piège ci-dessous) | `authenticated` |

`is_org_writer` a été **supprimée** (2026-08-22, migration `20260822100700`) : elle n'a plus de
sens hors du couple (organisation, démarche) porté par les profils de droits ; ses appelants
ont tous été remplacés dans la même migration que sa suppression.

### Profils de droits (lot `20260822100000` à `20260822100900`) — détail complet : [`droits.md`](droits.md)

| Fonction | Rôle | EXECUTE |
|---|---|---|
| `nil_procedure()` | Pseudo-démarche « sans démarche (historique) », constante `IMMUTABLE` | `authenticated` |
| `uuid_or_null(text)` | Cast protégé texte→uuid (segments de chemin storage, jamais de `22P02`) | `authenticated` |
| `rights_array(bool,bool,bool,bool)` | Sérialise 4 booléens de droits vers `['consultation',…]` | `authenticated` |
| `request_scope_org(org_id, socle_org_id)` | Organisation Socle porteuse des droits (destinataire si connu du miroir, racine sinon) | **interne**, aucun grant |
| `permission_profile_scope(profile_id)` | Expansion seule du périmètre d'un profil (sous-arbre, profondeur ≤ 10, anti-cycle) | **interne** |
| `permission_pairs_of(profile_ids[], right, org_id?)` | **Moteur unique** de la combinaison par couple — toutes les policies et tous les contrôles unitaires en dépendent | **interne** |
| `my_permission_pairs(right)` | Couples autorisés de l'utilisateur courant — utilisée par les policies (`IN` non corrélé, hashed SubPlan) | `authenticated` |
| `user_has_request_right(user_id, org_id, socle_org_id, socle_procedure_id, right)` | Contrôle unitaire par arguments bruts ; sondage d'un tiers restreint aux co-membres du même tenant côté client | `authenticated` |
| `has_admin_scope(org_id, socle_org_id)` | Administration effective sur une organisation (remontée d'ascendance) | `authenticated` |
| `is_org_admin_anywhere(org_id)` | Administration quelque part dans le tenant — ouvre les Paramètres | `authenticated` |
| `has_any_creation_right(org_id)` | Création quelque part dans le tenant (utilisateur courant) — storage brouillon | `authenticated` |
| `has_any_creation_right_for(user_id, org_id)` | Idem, paramétrée par utilisateur — appelée par `socle-proxy` en service_role uniquement | **révoquée aussi de `authenticated`** |
| `can_read_request` / `can_write_request` / `can_process_request` / `can_admin_request(request_id)` | Enveloppes par id de demande — policies storage et usages ponctuels (les satellites utilisent un `EXISTS` direct) | `authenticated` |
| `request_exists(id)` | Existence brute d'une demande, **hors RLS** — distingue un vrai brouillon d'une demande existante mais invisible | `authenticated` |
| `is_last_root_admin(org_id, user_id)` | Vrai si l'utilisateur est l'unique détenteur actif de l'administration racine | `authenticated` |
| `member_role_derived(org_id, user_id)` | `role` dérivé (`administrateur`/`agent`) | **interne** |
| `refresh_member_roles(org_id)` | Recalcule `organization_members.role` pour un tenant | **interne** |
| `refresh_request_scope_org(org_id?)` | Recalcule `requests.socle_scope_org_id` + anomalie `destinataire_inconnu` après une sync Socle | **interne**, appelée par `sync-socle-referentiel` |
| `validate_permission_profile_shape`, `assert_tenant_keeps_root_admin`, `assert_editor_can_manage_profile` | Gardes d'intégrité des profils (RM-05/06/38/39/42), appelées **explicitement** par les RPC — jamais par un trigger différé (piège ci-dessous) | **interne** |

⚠️ `SECURITY DEFINER` obligatoire sur l'ensemble ci-dessus (anti-récursion — piège Socle) ; les
advisors 0029 les signalent comme appelables par `authenticated` : **assumé et documenté**
(même posture que Socle — le RLS les évalue avec les droits de l'appelant, et elles ne révèlent
que l'appartenance/les droits de l'appelant lui-même, sauf `user_has_request_right` qui porte sa
propre garde anti-sondage). Toutes les **fonctions trigger et internes** ont leur EXECUTE
révoqué de `anon`/`authenticated`/`PUBLIC` dans la même migration que leur création — à
re-révoquer à chaque `CREATE OR REPLACE`.

### Piège SECURITY DEFINER / `current_user` (règle de projet, vérifié empiriquement 2026-08-22)

À l'intérieur d'une fonction `SECURITY DEFINER`, `current_user` devient le **propriétaire** de
la fonction (ex. `postgres`), y compris en cascade derrière plusieurs `DEFINER` imbriqués —
`is_service_context()` (fondée sur `current_user`) y vaut donc **toujours vrai**, même pour un
vrai client authentifié passé par une RPC `DEFINER`. **Ne jamais tester `is_service_context()`
à l'intérieur d'une fonction `SECURITY DEFINER`** : utiliser `is_platform_admin()` (fondée sur
`auth.uid()`, insensible au changement de `current_user`) pour un contournement explicite, ou
`current_setting('role', true)` (rôle positionné par PostgREST pour la requête, lui aussi
insensible à `SECURITY DEFINER`) pour distinguer un appel client d'un appel service_role — ou
décider le contournement côté appelant, dans une fonction restée `SECURITY INVOKER`
(`requests_guard_write`, `requests_before_insert_guard`,
`organization_members_protect_last_admin`). Détail et historique de la découverte :
[`droits.md`](droits.md) (section « Piège SECURITY DEFINER / current_user »).

## Tables

### Identité

- **`organizations`** — tenants : `socle_org_id` (UNIQUE, UUID racine Socle), `name` (snapshot),
  `status` active|obsolete. Écriture : admin plateforme.
- **`users`** — profils (`id` = `auth.users.id`, créés par le trigger `handle_new_user`,
  jamais par le client) : `email`, `first_name`, `last_name`, `is_platform_admin` (trigger
  anti-escalade `users_prevent_admin_escalation`).
- **`organization_members`** — PK composite `(organization_id, user_id)`, `role` CHECK
  `agent|administrateur`. **Colonne DÉRIVÉE transitoire depuis le 2026-08-22** (RM-43) : un
  trigger BEFORE INSERT/UPDATE (`organization_members_force_role`) écrase toute valeur cliente
  par `member_role_derived(organization_id, user_id)` (`administrateur` si l'utilisateur détient
  une attribution active à un profil de droits `is_admin` dans ce tenant, `agent` sinon) —
  filet de compatibilité pendant la bascule vers les profils de droits ([`droits.md`](droits.md)),
  retrait planifié dans une vague ultérieure. Trigger `t05_organization_members_protect_last_admin`
  (BEFORE DELETE, contourné en contexte de service) : refuse la suppression du dernier membre
  détenant l'administration sur la racine du tenant. Visible des membres du tenant, géré par les
  administrateurs.

### Cœur métier

- **`request_sequences`** — compteurs `(organization_id, year)` ; upsert atomique par le
  trigger de numérotation (contention bornée au même tenant la même année).
- **`requests`** — la demande. Colonnes clés :
  - `reference` `DEM-{année}-{n°}` (+ `reference_year`/`reference_seq`, UNIQUE par tenant) ;
  - références Socle : `socle_root_org_id` (NOT NULL, **toujours dérivée du tenant par
    trigger**, jamais du payload), `socle_organization_id` (destinataire éventuelle) +
    `socle_organization_label`, `socle_procedure_id` + `socle_procedure_label` +
    `socle_category_label` (catégorie de démarche Socle), `socle_contact_id` ;
  - `socle_scope_org_id` UUID NOT NULL (2026-08-22) — organisation Socle **porteuse des
    droits** : le destinataire s'il est connu du miroir du tenant (obsolescence comprise),
    la **racine Socle du tenant** sinon (destinataire NULL ou inconnu → anomalie
    `destinataire_inconnu`). Calculée par trigger (`requests_set_scope_org`), **jamais posée
    par le client** — recalculée **inconditionnellement** à chaque UPDATE (pas seulement sur
    changement de `socle_organization_id` : un client omettant cette colonne de son `SET` ne
    peut pas en survivre l'ancienne valeur). Support exclusif du RLS par couple
    ([`droits.md`](droits.md)) ;
  - `procedure_snapshot` JSONB (objet) — démarche figée au dépôt (`id`, `name`, `type`,
    `category_id`, `form_schema`, `requester_config` ; `degraded: true` si Socle était
    injoignable → snapshot minimal du cache + anomalie `referentiel_indisponible`).
    **Construit CÔTÉ SERVEUR depuis Socle** (edge function ou socle-proxy) — jamais accepté
    comme vérité d'un navigateur ou d'un partenaire ;
  - `requester_snapshot` JSONB (objet, **immuable**) — identité retenue au dépôt :
    `{ declared: {...} | null, socle_contact_id: uuid | null }`. **Jamais d'internal_notes** ;
  - `form_data` JSONB — réponses au formulaire, indexées par la **clé machine `key`** des
    champs du `form_schema` Socle (jamais `id`) ; jamais validé à l'ingestion ;
  - `identity_status` `rapprochee|non_rapprochee|anonyme` ;
  - origine : `source` (**registre dynamique** — CHECK de format + garde
    `t15_requests_check_source` : toute source non-`iris` doit être une
    `integration_sources` **active du tenant**, y compris en service_role),
    `external_ref` (CHECK : `source='iris'` ⟺ `external_ref` NULL),
    `idempotency_key` + `ingest_fingerprint` (empreinte SHA-256 du contenu
    canonique — rejeu identique → 200, divergent → 409 ; UNIQUE partiel
    `(org, source, idempotency_key)`), `external_url`, `channel`,
    `received_at` (date d'origine, immuable) ;
  - contenu : `subject` (NOT NULL), `body` ;
  - cycle de vie : `status` (7 valeurs), `closure_motif`
    (`irrecevable|abandon|retrait_usager|doublon|reorientation` ; `doublon` ⇒
    `master_request_id` NOT NULL, CHECK), `closure_text` (destiné à l'usager),
    `priority`, `assigned_to`, `anomalies` JSONB (tableau), `version` (monotone, +1 à
    chaque UPDATE — idempotence des webhooks sortants), `due_at`, `closed_at` ;
  - RGPD : `retention_until`, `purged_at`.
  - **Index** : idempotence UNIQUE partiel `(organization_id, source, external_ref)` ;
    `(org, status)`, `(org, socle_organization_id)`, `(org, socle_procedure_id)`,
    `(org, created_at desc)`, `(org, assigned_to)`, `master_request_id` partiel,
    `requests_org_scope_proc_idx (org, socle_scope_org_id, socle_procedure_id)` — support
    exclusif du prédicat RLS par couple (2026-08-22, [`droits.md`](droits.md)).

### Gardes SQL de `requests` (ordre d'exécution = ordre alphabétique des noms)

| Trigger | Moment | Rôle |
|---|---|---|
| `t10_requests_before_insert_guard` (INVOKER) | BEFORE INSERT | Naissance en `a_traiter` obligatoire (sauf contexte de service) ; **RM-16 (2026-08-22)** : si `assigned_to` est fourni dès la création, l'agent affecté doit détenir l'**instruction** sur le couple — sinon une demande peut naître déjà orpheline ; `version := 1` |
| `t15_requests_check_source` (DEFINER) | BEFORE INSERT | Toute source non-`iris` doit être une `integration_sources` **active du tenant**, service_role compris |
| `t16_requests_require_procedure` (DEFINER) | BEFORE INSERT | **Règle impérative** : `socle_procedure_id` obligatoire, présent dans `socle_procedure_cache` du tenant et non obsolète ; `procedure_snapshot` objet non vide dont l'`id` correspond ; libellés démarche/catégorie **réécrits depuis le cache** (vérité serveur). S'applique à tout le monde, service_role compris |
| `t20_requests_set_reference` (DEFINER) | BEFORE INSERT | Numérotation atomique + `socle_root_org_id` dérivée du tenant |
| `t21_requests_set_scope_org` (DEFINER) | BEFORE INSERT | Calcule `socle_scope_org_id` + anomalie `destinataire_inconnu`, **après** `t20` (dépend de `socle_root_org_id`) |
| `t09_requests_set_scope_org` (DEFINER) | BEFORE UPDATE | Même calcul, **inconditionnel** à chaque UPDATE (pas seulement `OF socle_organization_id` — correctif de sécurité 2026-08-22 : un client omettant cette colonne de son `SET` ne pouvait sinon pas en survivre l'ancienne valeur) ; repart toujours de `old.anomalies`, jamais de `new.anomalies` (même motif) ; **avant** `t10`/`t11` |
| `t10_requests_protect_immutable` (INVOKER) | BEFORE UPDATE | `id` (2026-08-22 : une clé primaire ne se réécrit jamais, service_role compris), `reference`, `organization_id`, `socle_root_org_id`, `source`, `external_ref`, `received_at`, `created_at`, **`requester_snapshot`** immuables ; demande **archivée gelée** (seul le statut peut changer, pour désarchiver — `procedure_snapshot` compris) — **dérogation service (2026-08-22)** : en contexte de service uniquement, une demande archivée peut recevoir un simple recalcul de `socle_scope_org_id`/`anomalies` (reparentage Socle post-sync) sans que ce soit traité comme une modification interdite |
| `t11_requests_guard_write` (INVOKER, **remplace `t11_requests_guard_transition` le 2026-08-22**) | BEFORE UPDATE | **Porte unique** (fusion garde de transition + garde d'édition, ADR-07) : matrice fixe + exigences de données **inchangées** (ci-dessous) ; en plus, portes **par droit** : édition du dossier = **instruction** sur le couple actuel (liste exhaustive de colonnes « métier », `closure_*` compris hors changement de statut) ; affectation (RM-16) = le destinataire doit détenir l'**instruction** sur le couple retenu ; requalification (RM-18) = instruction sur le couple **actuel et cible** ; transfert d'organisation (RM-19) = instruction sur le couple actuel, cible libre dans le sous-arbre du tenant ; transitions courantes = **instruction**, transitions terminales/archivage = **clôture**, réouverture/archivage/désarchivage = **administration** (`has_admin_scope`) **en plus** de la clôture ; `closed_at` **neutralisée en entrée** (`new.closed_at := old.closed_at` avant tout calcul — seule la section Effets, plus bas dans la même fonction, la fait évoluer) ; pose/purge `closed_at` ; purge la clôture à la réouverture. Contournement `is_service_context()` conservé intégralement (fonction restée `SECURITY INVOKER`, voir piège DEFINER ci-dessus) |
| `t19_requests_touch` (INVOKER) | BEFORE UPDATE | `version := version + 1`, `updated_at := now()` |
| `t30_requests_log_insert` / `t30_requests_log_update` (DEFINER) | AFTER | Journal `request_events` (`created`, `status_changed`, `assigned`) + historique `request_assignments` |

**Matrice des transitions** (le contexte de service la contourne explicitement — une garde
sans contournement bloquerait la péremption automatique et l'ingestion, leçon Clara) :

| Depuis | Vers | Exigences |
|---|---|---|
| `a_traiter` | `en_instruction` | `assigned_to` NOT NULL |
| `a_traiter` | `resolue_negative` | motif ∈ irrecevable/doublon/reorientation + texte de clôture |
| `a_traiter` | `annulee` | motif ∈ abandon/retrait_usager |
| `en_instruction` | `en_attente` · `resolue_positive` · `resolue_negative` · `annulee` · `a_traiter` | résolutions : `closure_text` obligatoire ; annulation : motif |
| `en_attente` | `en_instruction` · `annulee` | annulation : motif |
| terminal (`annulee`/`resolue_*`) | `en_instruction` (**réouverture**) | droit **clôture** + **administration** (`has_admin_scope`) sur la demande ; purge closed_at + clôture |
| terminal | `archivee` | droit **clôture** + **administration** |
| `archivee` | statut terminal (**désarchivage**) | droit **clôture** + **administration** ; aucune autre colonne ne change |

Toute autre transition est refusée. `resolue_positive` est inatteignable sans passage par
`en_instruction` (règle métier conservée). Depuis le 2026-08-22, les portes ci-dessus
(instruction/clôture/administration) remplacent les anciennes portes par **rôle**
`agent | administrateur` — sémantique inchangée pour les profils de reprise (« Administrateur »
= administration + tous droits, « Agent » = tous droits sans administration), voir
[`droits.md`](droits.md).

### Satellites

- **`request_events`** — journal immuable (voir Principes). `event_type` **texte libre par
  conception** (motif `courier_events` Clara) ; `created_by` NULL = système/intégration.
- **`request_assignments`** — historique append-only des affectations, alimenté par trigger ;
  `assigned_to` NULL = désaffectation.
- **`request_messages`** — notes internes (`kind='note_interne'`). **Ne quittent jamais Iris.**
  Trigger de cohérence `t01_*_check_org` (demande visible et du même tenant).
- **`request_attachments`** — pièces : `storage_path`
  (`{organization_id}/{request_id}/{uuid}-{slug}`), `checksum` (dédup),
  `copy_status` `copied|pending|error` (copie asynchrone à venir), type de PJ Socle en
  UUID nu + libellé figé, `form_field_key` (nullable — clé machine `key` du champ « pièce
  justificative » du `form_schema` auquel la pièce répond ; NULL = pièce hors formulaire).
  Même trigger de cohérence.
- **`request_links`** — relations : `doublon_de` / `issue_de_scission` / `liee_a`
  (demande↔demande, même tenant imposé par trigger — une cible invisible par RLS est
  « introuvable ») et `externe` (`external_type` + `external_id` + `external_url`).
  CHECKs d'exclusivité + unicités partielles. NB : la référence externe **primaire**
  (idempotence) reste `requests.external_ref`. Premier usage client (2026-08-21) : le parcours
  de création propose les **demandes proches** de l'usager désigné (détection best-effort
  côté client, même `socle_contact_id` ou nom déclaré) et, sur geste explicite de l'agent,
  insère APRÈS création deux liens `liee_a` symétriques (demande ↔ cible) en une seule
  insertion — RLS writer + trigger de périmètre revalident ; échec affiché, jamais bloquant.
  Aucune clôture `doublon` automatique : la décision reste humaine.
- **`integration_deliveries`** — outbox du retour d'état (contrat §6) : `event_id` UNIQUE,
  `target` (`clara`), `status` `pending|delivered|failed`, `attempts`, `next_attempt_at`,
  `last_error`. **Aucune émission n'est encore branchée** (phase 4) ; aucune écriture cliente.

### Intégrations (API d'ingestion — voir [`api-ingestion.md`](api-ingestion.md))

- **`integration_sources`** — systèmes sources enregistrés, **un par tenant et par code**
  (`UNIQUE (organization_id, code)`, format contraint, `iris` réservé). `status`
  `active|suspended` : la suspension coupe l'ingestion sans révoquer les clés. C'est l'ancrage
  du périmètre : une intégration n'agit que dans son tenant. Aucune logique par émetteur —
  Clara, portail ou tiers sont de simples lignes.
- **`integration_credentials`** — clés d'une source : `key_hash` SHA-256 UNIQUE (jamais en
  clair), `key_prefix` d'affichage, `scopes` CHECK `⊆ {requests:write, requests:read}`,
  `expires_at` NOT NULL, `revoked_at`, `last_used_at`. Plusieurs clés actives par source
  (rotation double clé). RLS : plateforme uniquement (motif api_keys Socle).
- **`integration_api_logs`** — journal d'audit **append-only** des appels (méthode, chemin,
  statut, clé, demande — jamais les payloads), garde `forbid_change`. SELECT admin du tenant.
- **`request_attachments.fetch_url`** — URL signée temporaire fournie à l'ingestion
  (`copy_status='pending'`), consommée par le futur worker de copie, jamais re-servie.

L'edge function **`requests-api`** (`verify_jwt=false`, auth par clé dans le code, aucun
en-tête CORS) opère en service_role : le périmètre est reconstruit à chaque appel **depuis la
clé** (tenant + code source), le `source_system` et le `socle_root_organization_id` déclarés
sont vérifiés contre elle (403 sinon), et une source ne lit que ses propres demandes (404
au-delà). La **démarche est obligatoire** (contrat v1.1.0) : vérifiée dans le cache du tenant
(400 explicite sinon), puis le `procedure_snapshot` est **construit côté serveur** depuis
Socle (whitelist ; dégradé + anomalie si injoignable) — un émetteur ne peut jamais l'imposer
(clé `procedure_snapshot` dans l'enveloppe → 400). Logique pure dans `_shared/` (validation
whitelist, empreinte canonique, sérialisation whitelist, snapshot, OpenAPI), testée par vitest.

### Création guidée (`create-request-from-procedure` + RPC)

La création manuelle par un agent passe EXCLUSIVEMENT par l'edge function
**`create-request-from-procedure`** (JWT + appartenance + **droit de création** sur le couple
(destinataire, démarche) vérifié en code via `user_has_request_right` — remplace, depuis le
2026-08-22, l'ancienne vérification de rôle `["agent","administrateur"]`, CORS allowlist) —
plus aucun INSERT direct de demande depuis le navigateur :

- **payload whitelisted strictement** (toute clé inconnue → 400) : identifiants, objet,
  priorité, destinataire, demandeur (`contact | sans_rapprochement | anonyme`), valeurs de
  formulaire par **id de champ**, références de pièces déjà déposées sur
  `{org}/{draft_request_id}/…` (préfixe vérifié). **Jamais de snapshot fourni par le client** ;
- la démarche doit être **active dans le cache du tenant** ET est **rechargée depuis Socle**
  (schéma d'autorité ; Socle injoignable → 502, l'agent réessaie — l'ingestion, elle, n'est
  jamais refusée) ;
- validation serveur via le **moteur pur partagé** `_shared/procedureForm.ts` (aussi importé
  par le front sous l'alias `@fn`) : `requester_config` (publics, champs
  masqué/visible/obligatoire, anonymat permis seulement sans identité obligatoire),
  `form_schema` v1 (sections, types, options, conditions visibleIf/requiredIf, `form_data`
  normalisé par clé machine — repli id si clé vide, collision → repli id), pièces
  (cardinalité ≤ maxFiles ≤ 5, formats, obligation conditionnelle, pièce orpheline refusée) ;
- contact rapproché : **relu depuis contacts-api** (introuvable → 400), identité whitelistée
  → `requester_snapshot.declared` + `socle_contact_id`, `identity_status = rapprochee` ;
- écriture via la RPC **`create_request_from_procedure(p jsonb)`** (SECURITY DEFINER,
  EXECUTE révoqué des clients — service uniquement) : **une transaction** = demande + pièces
  (`copy_status='copied'`, `uploaded_by` agent) + événement
  **`request_created_from_procedure`** (+ `created` par trigger), attribution à l'agent via
  `set_config('request.jwt.claims', …)` — aucune insertion partielle possible ; le brouillon
  rejoué → 409. Les triggers (t15 source, **t16 démarche**, numérotation, journal) restent le
  filet final.

Vérifié le 2026-08-20 : matrice HTTP 10/10 (auth, périmètre, snapshot imposé refusé,
anonymat gouverné par la démarche, champs demandeur obligatoires, options de formulaire,
destinataire hors sous-arbre, création atomique avec conditions, 409) + parcours navigateur
complet. Données de test purgées. Re-vérifié le 2026-08-21 avec le parcours redessiné
(4 étapes, brouillon local, demandes proches, liaison `liee_a`) : deux demandes de test
ACCM (DEM-2026-000001 / 000002, contact de démo, liées entre elles) **restent à purger**
lors de la prochaine campagne de nettoyage.

Le **brouillon de saisie** n'existe pas côté serveur : il vit dans le localStorage du poste
(un par tenant et utilisateur), ne transporte que des identifiants et des saisies (usager
rapproché = `socle_contact_id` seul, relu via `socle-proxy /v1/contacts/get` à la reprise ;
démarche rechargée ; pièces à redéposer) et le `request_id` du brouillon sert d'idempotence
à la création (rejeu → 409).

### Profils de droits (`20260822100000` à `20260822100900`)

Sémantique métier complète (vocabulaire, correspondance droits ↔ actions, non-escalade,
reprise, risques résiduels) : [`droits.md`](droits.md). Cinq tables, **aucune policy
d'écriture cliente** — les RPC de `20260822100400_profils_droits_rpc.sql` sont l'unique porte.

- **`permission_profiles`** — un profil de droits par tenant (`organization_id`, `name` UNIQUE
  insensible à la casse dans le tenant, `description`, `is_admin`, `default_view/create/
  process/close` — droits appliqués aux démarches non listées et à la pseudo-démarche « sans
  démarche », CHECK d'implication vers `default_view` —, `status` active|inactive, `version`
  int NOT NULL — verrou optimiste —, `created_by`/`updated_by`).
- **`permission_profile_organizations`** — PK `(profile_id, socle_org_id)`, `socle_org_id`
  UUID Socle **nu, sans FK** (le miroir peut soft-delete un nœud, RM-30 : une organisation
  obsolète reste utilisable). Sémantique **sous-arbre**, expansée côté serveur.
- **`permission_profile_procedures`** — PK `(profile_id, socle_procedure_id)`, `socle_procedure_id`
  UUID Socle nu (`nil_procedure()` = pseudo-démarche « Sans démarche (historique) »),
  `right_view/create/process/close` booléens, CHECK d'implication vers `right_view`. Une ligne
  à 4 booléens FALSE est une **exception explicite** qui prime sur le défaut du profil.
- **`permission_profile_assignments`** — PK `(profile_id, user_id)`, `organization_id`
  dénormalisé, FK **composite** vers `organization_members(organization_id, user_id) ON DELETE
  CASCADE` (une attribution n'existe que pour un membre du tenant ; la perte de la qualité de
  membre purge ses attributions).
- **`permission_audit_log`** — journal append-only (`forbid_change`, même trigger que
  `request_events`) : `action` CHECK (création/modification/activation/désactivation/
  suppression de profil, attribution/retrait accordés), `profile_id` **sans FK** (le profil
  peut être supprimé, le journal survit), `before`/`after` JSONB.

Cohérence intra-tenant **sans FK** entre les tables filles et le miroir/cache Socle : trigger
`permission_check_tenant_scope` (BEFORE INSERT/UPDATE sur les trois tables filles) — une
organisation ou une démarche référencée doit appartenir au miroir/cache du **même tenant** que
le profil ; vérifié **à l'écriture uniquement** (une démarche disparue du cache plus tard
conserve sa ligne, affichée « Démarche inconnue »).

⚠️ **Écart assumé vs la conception initiale** (voir en-tête de
`20260822100300_profils_droits_gardes.sql`) : les invariants RM-05/06/38/39/42 devaient
initialement être portés par des *constraint triggers différés* — abandonnés après
vérification empirique du piège `SECURITY DEFINER`/`current_user` (ci-dessus) : ils étaient
soit systématiquement court-circuités, soit en échec « permission denied » au COMMIT en
production. Les validations sont appelées **explicitement et immédiatement** par les RPC.

## Policies RLS (rôle `authenticated` ; le `service_role` contourne par attribut)

Toutes les policies par couple ci-dessous enveloppent `is_platform_admin()` en `(select …)`
(InitPlan évalué une fois par requête, pas une fois par ligne — correctif de performance
appliqué au passage) et s'appuient sur `my_permission_pairs(droit)` (`requests`) ou un `EXISTS`
direct vers `requests` (satellites, ADR-05 — pas de seconde implémentation de la sémantique par
couple, pas de dénormalisation `socle_scope_org_id`/`socle_procedure_id` sur les satellites,
qui sont pour deux d'entre eux immuables même en service_role).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `organizations` | membre | plateforme | plateforme | plateforme |
| `users` | soi / plateforme / tenant partagé | — (trigger) | soi / plateforme (escalade bloquée par trigger) | — |
| `organization_members` | soi ou admin | admin | admin | admin (garde `t05` : refuse le dernier administrateur racine, service excepté) |
| `request_sequences` | membre (diagnostic) | — | — | — |
| `requests` | couple **consultation** (`(org, socle_scope_org_id, coalesce(socle_procedure_id, nil_procedure())) IN my_permission_pairs('consultation')`) | couple **création** **et** `source='iris'` | couple **écriture** (USING) ; `with check` = appartenance seule, la finesse par droit vit dans `t11_requests_guard_write` | — |
| `request_events` | `EXISTS` demande visible (couple consultation, via le RLS de `requests`) | — | — (trigger raise) | — (trigger raise) |
| `request_assignments` | idem | — | — (trigger raise) | — (trigger raise) |
| `request_messages` | idem (RM-10 : notes internes comprises dans la consultation) | couple **écriture** + `author_id = auth.uid()` | auteur avec couple écriture **ou** `has_admin_scope` sur l'organisation de la demande | idem UPDATE |
| `request_attachments` | `EXISTS` demande visible | couple **instruction** + `uploaded_by = auth.uid()` | — | `has_admin_scope` sur l'organisation de la demande |
| `request_links` | `EXISTS` demande visible (la ligne appartient à la source) | couple **écriture** sur la source ; trigger `request_links_check_scope` exige en plus la **consultation** de la cible (hors contexte de service) | — | `has_admin_scope` sur l'organisation de la demande |
| `integration_deliveries` | membre (diagnostic) | — | — | — |
| `permission_profiles` | administration quelque part dans le tenant (`is_org_admin_anywhere`), sinon **seulement** les profils auxquels on est attribué | — | — | — |
| `permission_profile_organizations`, `permission_profile_procedures` | même règle, via jointure vers `permission_profiles` | — | — | — |
| `permission_profile_assignments` | soi-même ou administration quelque part dans le tenant | — | — | — |
| `permission_audit_log` | administration quelque part dans le tenant | — | — | — |

Les 5 tables `permission_*` n'ont **aucune** policy INSERT/UPDATE/DELETE pour
`authenticated`/`anon` : PostgreSQL refuse par défaut toute opération non couverte par une
policy — comportement recherché (les RPC, qui s'exécutent comme le propriétaire des fonctions,
contournent le RLS de la même façon qu'un trigger `SECURITY DEFINER`).

« couple écriture » = `my_permission_pairs('ecriture')`, où `ecriture` (pseudo-droit interne à
`permission_pairs_of`) = création OU instruction OU clôture — utilisé par la policy UPDATE de
`requests` et par les satellites qui n'exigent pas un droit plus précis. `is_org_writer` est
**supprimée** (2026-08-22) : elle n'a plus de sens hors du couple (organisation, démarche).

## Storage

Bucket privé **`request-attachments`** (25 Mio max/fichier). Chemin porteur du RLS :
`{organizations.id}/{request_id}/{uuid}-{slug}` — 1er segment = tenant **local** (pas l'UUID
Socle). Policies `storage.objects` (scopées au bucket, réécrites le 2026-08-22) :

| Opération | Règle |
|---|---|
| SELECT | `can_read_request` sur le 2ᵉ segment du chemin (demande existante et consultable) **ou** brouillon : `(owner_id = auth.uid()::text OR owner = auth.uid())` **ET** `NOT request_exists(2ᵉ segment)` |
| INSERT | `has_any_creation_right` sur le 1ᵉʳ segment (tenant) **ET** (le 2ᵉ segment ne correspond à aucune demande existante — dépôt du brouillon — **OU** `can_process_request` sur cette demande — ajout de pièce après création, exige l'instruction) |
| DELETE | `can_admin_request` sur le 2ᵉ segment **ou** même règle de brouillon que SELECT |
| UPDATE | Aucune (un objet se remplace par suppression + nouvel envoi) |

`request_exists` répond **hors RLS** (`SECURITY DEFINER`) — nécessaire pour distinguer un vrai
brouillon (id inexistant) d'une demande existante mais devenue invisible pour l'appelant :
tester `NOT EXISTS (SELECT … FROM requests WHERE id = …)` en RLS ordinaire aurait fait passer
la seconde pour la première, laissant un ancien déposant garder l'accès à des pièces d'un
dossier dont il a perdu tout droit. `owner_id` (texte) et `owner` (UUID, déprécié côté
Supabase) sont testés tous les deux. ⚠️ Les policies storage vivent dans des migrations
versionnées (le `db dump` ne couvre pas le schéma `storage` — constat Socle) :
`20260820100300_storage_attachments.sql` puis `20260822100700_policies_droits.sql`.

## Tests

[`../supabase/tests/fondations.test.sql`](../supabase/tests/fondations.test.sql) — test SQL
transactionnel **toujours annulé** (l'exception finale porte le verdict, aucune donnée ne
subsiste). Simule les identités par `request.jwt.claims` + `SET LOCAL ROLE authenticated` ; enregistre
une `integration_sources` de test (`source-test`) — le registre dynamique refuse toute source
non enregistrée, même en service_role.
**15 scénarios, tous passés le 2026-08-20, rejoués et toujours passants le 2026-08-22** avec le
nouveau décor « profils de droits » (deux profils par tenant, `Administrateur`/`Agent`,
reproduisant exactement la reprise M6, au lieu du rôle `organization_members.role` direct) :
création par un agent (référence, statut de naissance, racine dérivée, journal, **libellés
démarche/catégorie réécrits depuis le cache même si falsifiés**) · numérotation indépendante
par tenant · isolation lecture et écriture entre deux tenants (cache des démarches compris) ·
transitions refusées (matrice, agent non assigné, texte de clôture manquant) · réouverture
refusée sans administration, permise avec · archivage refusé sans administration, permis avec ·
gel des archivées (désarchivage avec altération du `procedure_snapshot` refusé) · colonnes
immuables (`requester_snapshot` compris) · DELETE impossible · lien cross-tenant refusé ·
journal immuable même en service · idempotence `(source, external_ref)` · source externe
interdite aux clients · **règle impérative en contexte de service** (sans démarche, démarche
d'un autre tenant, obsolète, sans snapshot, snapshot incohérent : 5 refus) · **demande
historique sans démarche** toujours transitionnable, garde réactivée derrière.

[`../supabase/tests/profils-droits.test.sql`](../supabase/tests/profils-droits.test.sql) —
même harnais, dédié aux profils de droits : **CA-01 à CA-21** (étanchéité par organisation et
par démarche, sous-arbre inclus, combinaison par couple **sans produit cartésien**, consultation
seule = lecture stricte, création sans instruction, instruction sans clôture, réouverture/
archivage = administration + clôture, administration n'ouvre pas les dossiers, demande sans
destinataire, affectation à un collègue éligible uniquement, non-escalade de périmètre et de
niveau, dernier administrateur, reprise sans régression, effet immédiat d'un retrait, nouvelle
démarche *fail closed*, storage et satellites suivent la demande, profils invalides refusés,
étanchéité cross-tenant) et **CL-01/02/04/05/06/11/15/16/22** (cas limites), plus
l'**équivalence** `user_has_request_right` ⟺ `permission_pairs_of` et une section dédiée au
storage. Rejoue aussi les items des deux revues de sécurité du 2026-08-22 (correctifs C, D, E,
F, F-3, F-4, F-7, M-1, M-2, M-4 — recalcul inconditionnel de `socle_scope_org_id`, RM-16 dès
l'INSERT, `request_exists` hors RLS, restriction de `permission_profiles_select`…). ⚠️ Pose
`set_config('storage.allow_delete_query', 'true', true)` en tête : `storage.objects` porte un
garde-fou **plateforme** Supabase (`storage.protect_delete()`, trigger STATEMENT) qui interdit
tout DELETE direct hors API Storage sauf ce GUC transactionnel — nécessaire pour que le test
observe l'effet des **policies** (0 ligne affectée pour un appelant sans droit), pas ce
garde-fou distinct ; sans incidence en production, où les suppressions passent par l'API
Storage.

Procédure de rejeu complète (ordre des 9 migrations, lecture du verdict, vérification de
performance de la liste paginée par `EXPLAIN ANALYZE`, abandon/rollback) :
[`../supabase/tests/README-profils.md`](../supabase/tests/README-profils.md).

Exécution : contexte postgres en lecture-écriture (SQL editor du dashboard). Le MCP
`execute_sql` est en lecture seule → passer par `apply_migration` (l'échec final volontaire
empêche l'enregistrement d'une migration).

## Écarts et suites (assumés)

1. **Visibilité par sous-arbre Socle et par démarche — SOLDÉ le 2026-08-22.** Le miroir
   (`socle_organizations` + `socle_procedure_cache` + `sync_runs`) est désormais **exploité**
   par les profils de droits ([`droits.md`](droits.md)) : la visibilité et l'écriture sur les
   demandes sont gouvernées par la combinaison, **par couple (organisation, démarche)**, des
   profils actifs attribués — au lieu de l'ancien filtrage par tenant seul. `has_socle_org_access`
   n'a **pas** été livrée telle que l'architecture §4.2 l'esquissait (une seule dimension,
   organisation) : elle est remplacée par `permission_pairs_of`/`has_admin_scope`, qui portent
   en plus la dimension démarche, absente de l'architecture validée — voir l'amendement du
   2026-08-22 en tête de [`architecture-proposee.md`](architecture-proposee.md) §4.
   `socle_organization_members` (esquissée par l'architecture) **n'existe pas** : remplacée par
   `permission_profile_organizations` (périmètre d'un profil, pas d'un utilisateur direct).
2. **Outbox non branchée** : `integration_deliveries` existe, l'émission d'événements et les
   workers arrivent en phase 4 (webhook signé + réconciliation).
3. **Purge RGPD** : colonnes prêtes (`retention_until`, `purged_at`), la procédure
   `service_role` de purge reste à écrire (phase 5).
4. **Advisors** : les WARN 0029 sur les helpers (fondations + profils de droits) sont assumés
   (voir plus haut) ; `rls_auto_enable` a été verrouillé (migration 5).
5. **FK non indexées sur l'audit** : `permission_audit_log.actor_id`/`target_user_id`
   (`ON DELETE SET NULL` vers `users`) n'ont pas d'index dédié — volume de paramétrage, jamais
   le chemin chaud des listes de demandes ; à revoir si le journal devient un écran de recherche
   à part entière.
6. **`requests.version` incrémentée par le recalcul de périmètre** : `refresh_request_scope_org`
   (appelée après chaque sync Socle) incrémente `version` sur toute demande dont
   `socle_scope_org_id`/`anomalies` change — sans conséquence tant que l'outbox webhook n'est
   pas branchée (écart n°2), à revoir en phase 4 (le contrat de retour promet `version`
   **monotone côté transitions de statut**, pas côté recalcul de périmètre).
7. **Retrait futur de `organization_members.role`** : colonne dérivée transitoire depuis le
   2026-08-22 (filet de compatibilité front/edge functions pendant la bascule) — planifiée pour
   suppression dans une vague ultérieure, une fois toute la surface applicative migrée vers les
   droits effectifs (`my_rights`), pour éviter une seconde source de vérité.
