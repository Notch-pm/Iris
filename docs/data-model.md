# Modèle de données — Iris

> **Public** : développeuses et développeurs travaillant sur Iris · **Question traitée** :
> quelles tables, contraintes, gardes et règles RLS portent les fondations ? ·
> **Dernière mise à jour** : 2026-08-20 · Schéma appliqué au projet Supabase
> `tqcoqlneybtbrrcvpkpk` (migrations 1 à 5, miroirs dans `supabase/migrations/`).

Réfère l'architecture validée ([`architecture-proposee.md`](architecture-proposee.md)) ; en cas
d'écart, ce document décrit **l'état réel** du schéma.

## Principes

- **Tenant Iris = organisation racine Socle** (`organizations.socle_org_id`). Pas de hiérarchie
  locale : les UUID Socle (racine, organisation destinataire, démarche, contact, type de PJ)
  sont des **références nues, sans FK inter-base**.
- **RLS activée sur toutes les tables** (+ event trigger `rls_auto_enable`, préexistant au
  projet et conservé : toute nouvelle table de `public` naît avec RLS). Le `service_role`
  contourne le RLS par attribut — **aucune policy « service » n'est écrite** (une policy au
  `TO` manquant s'ouvrirait à `authenticated`).
- **Workflow fixe à 7 statuts** (décision PO), gardé par trigger SQL — jamais par l'UI seule.
- **Aucune demande libre** (règle impérative PO, 2026-08-20) : toute **nouvelle** demande est
  fondée sur une **démarche Socle active du tenant** (`socle_procedure_id` + snapshot serveur),
  gardé par le trigger `t16_requests_require_procedure` — **service_role compris**. Les
  demandes historiques sans démarche restent lisibles et transitionnables.
- **Journal immuable** : `request_events` et `request_assignments` refusent UPDATE et DELETE
  par trigger, même en `service_role`.
- **Aucune suppression de demande** : pas de policy DELETE, FK tenant en `ON DELETE RESTRICT`.
  La purge RGPD passera par une procédure `service_role` dédiée (à venir).
- Écritures d'**ingestion** (sources `clara`, `portail`, `arpege`) : `service_role` uniquement —
  la policy INSERT cliente est verrouillée sur `source = 'iris'`.

## Helpers RLS (`SECURITY DEFINER`, `search_path = ''`)

| Fonction | Rôle | EXECUTE |
|---|---|---|
| `is_platform_admin()` | Admin plateforme | `authenticated` |
| `member_role(org_id)` | Rôle du membre courant dans le tenant (NULL sinon) | `authenticated` |
| `is_org_member(org_id)` | Membre du tenant (ou plateforme) | `authenticated` |
| `is_org_admin(org_id)` | Rôle `admin` (ou plateforme) | `authenticated` |
| `is_org_writer(org_id)` | `admin` / `superviseur` / `agent` — le **lecteur** est exclu de toute écriture | `authenticated` |
| `shares_org_with(user_id)` | Partage d'au moins un tenant (visibilité des profils) | `authenticated` |
| `is_service_context()` | `current_user` ∈ postgres / service_role — ⚠️ **INVOKER volontaire**, ne jamais passer en DEFINER | `authenticated` |

⚠️ `SECURITY DEFINER` obligatoire sur les six premiers (anti-récursion — piège Socle) ; les
advisors 0029 les signalent comme appelables par `authenticated` : **assumé et documenté**
(même posture que Socle — le RLS les évalue avec les droits de l'appelant, et ils ne révèlent
que l'appartenance de l'appelant lui-même). Toutes les **fonctions trigger** ont leur EXECUTE
révoqué de `anon`/`authenticated`/`PUBLIC` dans la même migration que leur création — à
re-révoquer à chaque `CREATE OR REPLACE`.

## Tables

### Identité

- **`organizations`** — tenants : `socle_org_id` (UNIQUE, UUID racine Socle), `name` (snapshot),
  `status` active|obsolete. Écriture : admin plateforme.
- **`users`** — profils (`id` = `auth.users.id`, créés par le trigger `handle_new_user`,
  jamais par le client) : `email`, `first_name`, `last_name`, `is_platform_admin` (trigger
  anti-escalade `users_prevent_admin_escalation`).
- **`organization_members`** — PK composite `(organization_id, user_id)`, `role` CHECK
  `agent|administrateur` (décision PO 2026-08-20 : l'administrateur voit tout — paramètres,
  réouverture, archivage, membres — l'agent instruit sans les paramètres ; migration
  `roles_agent_administrateur`). Visible des membres du tenant, géré par les administrateurs.

### Cœur métier

- **`request_sequences`** — compteurs `(organization_id, year)` ; upsert atomique par le
  trigger de numérotation (contention bornée au même tenant la même année).
- **`requests`** — la demande. Colonnes clés :
  - `reference` `DEM-{année}-{n°}` (+ `reference_year`/`reference_seq`, UNIQUE par tenant) ;
  - références Socle : `socle_root_org_id` (NOT NULL, **toujours dérivée du tenant par
    trigger**, jamais du payload), `socle_organization_id` (destinataire éventuelle) +
    `socle_organization_label`, `socle_procedure_id` + `socle_procedure_label` +
    `socle_category_label` (catégorie de démarche Socle), `socle_contact_id` ;
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
    `(org, created_at desc)`, `(org, assigned_to)`, `master_request_id` partiel.

### Gardes SQL de `requests` (ordre d'exécution = ordre alphabétique des noms)

| Trigger | Moment | Rôle |
|---|---|---|
| `t10_requests_before_insert_guard` (INVOKER) | BEFORE INSERT | Naissance en `a_traiter` obligatoire (sauf contexte de service : reprise/ingestion) ; `version := 1` |
| `t15_requests_check_source` (DEFINER) | BEFORE INSERT | Toute source non-`iris` doit être une `integration_sources` **active du tenant**, service_role compris |
| `t16_requests_require_procedure` (DEFINER) | BEFORE INSERT | **Règle impérative** : `socle_procedure_id` obligatoire, présent dans `socle_procedure_cache` du tenant et non obsolète ; `procedure_snapshot` objet non vide dont l'`id` correspond ; libellés démarche/catégorie **réécrits depuis le cache** (vérité serveur). S'applique à tout le monde, service_role compris |
| `t20_requests_set_reference` (DEFINER) | BEFORE INSERT | Numérotation atomique + `socle_root_org_id` dérivée du tenant |
| `t10_requests_protect_immutable` (INVOKER) | BEFORE UPDATE | `reference`, `organization_id`, `socle_root_org_id`, `source`, `external_ref`, `received_at`, `created_at`, **`requester_snapshot`** immuables ; demande **archivée gelée** (seul le statut peut changer, pour désarchiver — `procedure_snapshot` compris) |
| `t11_requests_guard_transition` (INVOKER) | BEFORE UPDATE | Matrice fixe + exigences + portes par rôle (ci-dessous) ; pose/purge `closed_at` ; purge la clôture à la réouverture |
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
| terminal (`annulee`/`resolue_*`) | `en_instruction` (**réouverture**) | rôle **administrateur** ; purge closed_at + clôture |
| terminal | `archivee` | rôle **administrateur** |
| `archivee` | statut terminal (**désarchivage**) | rôle **administrateur** ; aucune autre colonne ne change |

Toute autre transition est refusée. `resolue_positive` est inatteignable sans passage par
`en_instruction` (règle métier conservée).

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
**`create-request-from-procedure`** (JWT + appartenance + rôle agent/administrateur vérifiés
en code, CORS allowlist) — plus aucun INSERT direct de demande depuis le navigateur :

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

## Policies RLS (rôle `authenticated` ; le `service_role` contourne par attribut)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `organizations` | membre | plateforme | plateforme | plateforme |
| `users` | soi / plateforme / tenant partagé | — (trigger) | soi / plateforme (escalade bloquée par trigger) | — |
| `organization_members` | soi ou admin | admin | admin | admin |
| `request_sequences` | membre (diagnostic) | — | — | — |
| `requests` | membre | writer **et `source='iris'`** | writer (gardes par triggers) | — |
| `request_events` | membre | — | — (trigger raise) | — (trigger raise) |
| `request_assignments` | membre | — | — (trigger raise) | — (trigger raise) |
| `request_messages` | membre | writer + `author_id = auth.uid()` | auteur ou admin | auteur ou admin |
| `request_attachments` | membre | writer + `uploaded_by = auth.uid()` | — | admin |
| `request_links` | membre | writer | — | admin |
| `integration_deliveries` | membre (diagnostic) | — | — | — |

« writer » = `is_org_writer` (le rôle `lecteur` ne peut rien écrire).

## Storage

Bucket privé **`request-attachments`** (25 Mio max/fichier). Chemin porteur du RLS :
`{organizations.id}/{request_id}/{uuid}-{slug}` — 1er segment = tenant **local** (pas l'UUID
Socle). Policies `storage.objects` (scopées au bucket) : SELECT membre · INSERT writer ·
DELETE admin · pas d'UPDATE. Consultation par URL signée temporaire (5 min). ⚠️ Les policies
storage vivent dans la migration versionnée `20260820100300_storage_attachments.sql` (le
`db dump` ne couvre pas le schéma `storage` — constat Socle).

## Tests

[`../supabase/tests/fondations.test.sql`](../supabase/tests/fondations.test.sql) — test SQL
transactionnel **toujours annulé** (l'exception finale porte le verdict, aucune donnée ne
subsiste). Simule les identités par `request.jwt.claims` + `SET LOCAL ROLE authenticated` ; enregistre
une `integration_sources` de test (`source-test`) — le registre dynamique refuse toute source
non enregistrée, même en service_role.
**15 scénarios, tous passés le 2026-08-20 (rejoués après la migration
`demande_fondee_sur_demarche`)** : création par un agent (référence, statut de naissance,
racine dérivée, journal, **libellés démarche/catégorie réécrits depuis le cache même si
falsifiés**) · numérotation indépendante par tenant · isolation lecture et écriture entre
deux tenants (cache des démarches compris) · transitions refusées (matrice, agent non
assigné, texte de clôture manquant) · réouverture refusée à l'agent, permise à
l'administrateur · archivage refusé à l'agent, permis à l'administrateur · gel des archivées
(désarchivage avec altération du `procedure_snapshot` refusé) · colonnes immuables
(`requester_snapshot` compris) · DELETE impossible · lien cross-tenant refusé · journal
immuable même en service · idempotence `(source, external_ref)` · source externe interdite
aux clients · **règle impérative en contexte de service** (sans démarche, démarche d'un autre
tenant, obsolète, sans snapshot, snapshot incohérent : 5 refus) · **demande historique sans
démarche** toujours transitionnable, garde réactivée derrière.

Exécution : contexte postgres en lecture-écriture (SQL editor du dashboard). Le MCP
`execute_sql` est en lecture seule → passer par `apply_migration` (l'échec final volontaire
empêche l'enregistrement d'une migration).

## Écarts et suites (assumés)

1. **Visibilité par sous-arbre Socle différée** : le **miroir existe désormais**
   (`socle_organizations` + `socle_procedure_cache` + `sync_runs`, migration
   `socle_referentiel_miroir`, sync par l'edge `sync-socle-referentiel`, RLS SELECT membre /
   écriture service_role) — mais les policies des demandes isolent toujours au **tenant** :
   « l'administrateur ne voit que son arbre » exige encore `socle_organization_members`
   (affectations) + son UI + le helper `has_socle_org_access`, à livrer ensemble pour ne pas
   aveugler les utilisateurs sans affectation. `requests.socle_organization_id` est prêt.
2. **Outbox non branchée** : `integration_deliveries` existe, l'émission d'événements et les
   workers arrivent en phase 4 (webhook signé + réconciliation).
3. **Purge RGPD** : colonnes prêtes (`retention_until`, `purged_at`), la procédure
   `service_role` de purge reste à écrire (phase 5).
4. **Advisors** : les WARN 0029 sur les sept helpers sont assumés (voir plus haut) ;
   `rls_auto_enable` a été verrouillé (migration 5).
