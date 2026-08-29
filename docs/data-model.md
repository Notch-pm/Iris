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

### Administration des comptes, côté service (`20260823100100`)

L'edge function `admin-users` tourne en `service_role` : `auth.uid()` y est nul, les helpers
clients ne lui répondent pas. Deux variantes paramétrées par utilisateur, **révoquées de tout
rôle client** (motif déjà en place avec `has_any_creation_right_for`) :

- `is_org_admin_anywhere_for(p_user_id, p_org_id)` — miroir de `is_org_admin_anywhere` pour un
  utilisateur donné. Gouverne l'invitation et le test d'envoi.
- `can_manage_account(p_actor_id, p_target_id)` — autorité sur un compte : plateforme, ou
  administration d'au moins un tenant dont la cible est membre. Gouverne le renvoi d'un lien de
  mot de passe.
- `sync_smtp_settings_from_socle(...)` / `clear_smtp_settings_from_socle(p_org_id)` (service,
  `20260823150000`) — unique porte d'écriture du **miroir** du serveur d'envoi, appelée par
  `sync-socle-referentiel`. Révoquées de `anon` et `authenticated`.
  (`is_tenant_root_admin` / `is_tenant_root_admin_for`, posées le matin du 2026-08-23 pour
  réserver la saisie SMTP à la racine, ont été **retirées le même jour** : la saisie a quitté
  Iris, la garde n'avait plus d'objet.)

La règle reste écrite une seule fois, en SQL ; l'edge function la consulte.

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
- **`smtp_settings`** (`20260823100000`, réécrite par `20260823150000`) — **miroir** du
  serveur d'envoi défini **dans le Socle** pour l'organisation principale du tenant. Ce n'est
  pas une table de paramétrage : Iris n'offre aucune saisie (décision PO 2026-08-23), la source
  de vérité est le Socle et le miroir est rafraîchi par `sync-socle-referentiel`, au même titre
  que `socle_organizations` et `socle_procedure_cache`. **Une ligne par tenant** (PK
  `organization_id` — un tenant Iris EST une organisation racine Socle), valable pour tout le
  sous-arbre : `host`, `port` (défaut 587, CHECK 1–65535), `username`, `from_email`,
  `from_name`, `use_tls`, plus la provenance et la fraîcheur (`socle_org_id`,
  `socle_updated_at`, `synced_at`). Le **mot de passe n'y figure pas** : `password_secret_id`
  pointe un secret **Vault** (`vault.create_secret`, chiffré au repos) — le Socle le sert en
  clair par son API, Iris ne le repose jamais en clair dans une colonne. Écriture : **RPC de
  service uniquement** (`sync_smtp_settings_from_socle` / `clear_smtp_settings_from_socle`),
  aucune policy d'écriture cliente. Lecture : **aucune surface cliente** — ni policy, ni grant
  pour `authenticated` (l'écran de consultation a disparu avec la saisie ; la configuration se
  lit dans le Socle). Déchiffrement réservé au service : `smtp_config_for_org(org)` et
  `mail_context_for_user(user)`, révoquées de `anon` et `authenticated`. Détail et parcours :
  [`emails.md`](emails.md).

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
    `{ declared: {...} | null, socle_contact_id: uuid | null }`. **Jamais d'internal_notes**
    (justification et coût mesuré : § « Pourquoi figer l'identité au dépôt » ci-dessous) ;
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
| `t17_requests_require_pieces_conformes` (DEFINER) | BEFORE UPDATE | **Qualification des pièces (2026-08-28)** : refuse `en_instruction → resolue_positive` tant qu'une exigence de pièce **obligatoire** n'est pas conforme (manquante, pas encore qualifiée, ou non conforme) — `request_pieces_blocking`, qui relit `procedure_snapshot -> form_schema` et rejoue les conditions sur `form_data`. **Elle seule** est fermée : mise en attente, annulation et résolution négative restent ouvertes (on refuse souvent PARCE QU'une pièce manque). Ne vise pas le désarchivage (`archivee → resolue_positive`), qui restaure un état déjà jugé. S'applique à tout le monde, service_role compris (règle métier, motif `t16`) |
| `t19_requests_touch` (INVOKER) | BEFORE UPDATE | `version := version + 1`, `updated_at := now()` |
| `t30_requests_log_insert` / `t30_requests_log_update` (DEFINER) | AFTER | Journal `request_events` (`created`, `status_changed`, `assigned`, et **`form_data_updated`** depuis le 2026-08-28) + historique `request_assignments`. NB : `piece_qualifiee` et `piece_ajoutee` sont écrits par leurs RPC (`qualify_request_attachment`, `attach_request_piece`), pas par un trigger |

### Anomalies (`requests.anomalies`)

**Un TABLEAU D'OBJETS `{"code": "..."}`, jamais de chaînes nues.** C'est la forme qu'impose
`requests_set_scope_org`, qui filtre par `a ->> 'code'` : une chaîne nue y donne NULL et se
fait **silencieusement effacer** au premier recalcul de périmètre. `requests-api` poussait des
chaînes — corrigé le 2026-08-26, avant qu'une anomalie n'ait jamais été posée en production
(vérifié : aucune demande n'en portait).

| Code | Posé par | Signification |
|---|---|---|
| `destinataire_inconnu` | trigger `requests_set_scope_org` | Le destinataire n'est pas (ou plus) dans le miroir du tenant ; le périmètre retombe sur la racine Socle |
| `referentiel_indisponible` | `requests-api` | Socle injoignable au dépôt : `procedure_snapshot` minimal issu du cache |
| `usager_a_creer_dans_socle` | `create-request-from-procedure`, `requests-api` | L'usager n'a pu être ni rapproché ni créé dans le Socle (panne avérée) : la demande est passée quand même, en `non_rapprochee`, et reste à régulariser |

Les anomalies décrivent un **geste restant à faire**, jamais un refus : la doctrine de la
gamme est qu'un référentiel muet ne fait pas perdre une demande.

### Pourquoi figer l'identité au dépôt (question PO du 2026-08-26)

La question revient à chaque relecture du modèle, d'autant plus depuis que la fiche d'une
demande **relit** la fiche Socle (« identité vivante », `requesterView`) : si l'identité du jour
est affichée, à quoi sert encore l'instantané, et que coûte-t-il quand on prévoit beaucoup de
demandes ?

**Trois raisons, dont une décisive.**

1. **Toutes les demandes n'ont pas de fiche Socle à relire.** Pour `identity_status =
   non_rapprochee` (identité déclarée au guichet, payload d'un partenaire arrivé par
   `requests-api`) ou `anonyme`, il n'y a **aucun** `socle_contact_id` : le snapshot *est*
   l'identité, il n'y a rien d'autre à lire. C'est la raison décisive — elle ne dépend d'aucun
   arbitrage d'ergonomie.
2. **Une demande est une pièce administrative et ne se supprime jamais.** Ce qui fait foi, c'est
   l'identité *retenue au dépôt* : l'usager changera de nom d'usage, déménagera, sera archivé,
   ou purgé du Socle au titre du RGPD. Sans instantané, une demande de 2026 afficherait
   l'adresse de 2029 — ou plus rien. L'écart entre les deux est lui-même une information, et
   c'est ce que montre le dépliant « N champs modifiés depuis le dépôt ».
3. **Aucune FK ne franchit la frontière de projet, aucun flux base-à-base.** Sans instantané,
   afficher un nom coûterait un appel HTTP à `contacts-api` par demande, via edge function, avec
   le Socle en point de panne unique. La carte (500 demandes), l'export CSV (5 000 lignes) et la
   détection de « demandes proches » (`ilike` côté Iris sur `requester_snapshot->declared->>…`)
   deviendraient impraticables ou impossibles.

**Ce qu'il coûte, mesuré** (2026-08-26, base `tqcoqlneybtbrrcvpkpk`) :

| Colonne | Moyenne | Max | Part de la ligne |
|---|---|---|---|
| `requester_snapshot` | **250 o** | 394 o | ~12 % |
| `procedure_snapshot` | **1 267 o** | 1 718 o | **~63 %** |
| `form_data` | 107 o | — | ~5 % |
| ligne complète | ~2 000 o | 2 529 o | 100 % |

L'identité pèse donc **5× moins que le snapshot de démarche**, et ne coûte rien sur le chemin
chaud : `LIST_SELECT` (`src/features/requests/useRequests.ts`) ne la sélectionne pas — la liste
n'a pas de colonne « Usager ». À 50 000 demandes par tenant : 12 Mo. À 1 million : 250 Mo.

**Le vrai sujet était ailleurs.** La mesure a montré que la table TOAST de `requests` était
**vide** (`relpages = 0`, `reloptions` nul, seuil par défaut 2048 o) pour une ligne moyenne de
1 999 o : tout tenait en ligne, à un octet du seuil, ~4 lignes par page de 8 ko. Chaque balayage
de liste, de facettes ou d'export traînait ~1,3 ko de `procedure_snapshot` par ligne que
personne ne lit sur ce chemin. D'où la migration `20260826130000_requests_toast_tuple_target`
(`toast_tuple_target = 1024`), qui n'évince **que** `procedure_snapshot` : vérifié sur les
7 lignes réelles, le reste après éviction va de 558 à 898 o — sous le seuil partout, donc
l'éviction s'arrête et `requester_snapshot`, `subject` et les libellés restent en ligne. Un
seuil plus bas serait contre-productif (voir le commentaire de la migration). ⚠️ Le réglage ne
vaut que pour les lignes **écrites après** : il a été posé table quasi vide, plus tard il
exigerait un `VACUUM FULL`.

**Deux leviers repérés et volontairement NON pris** (à rouvrir si le volume le justifie) :

- `procedure_snapshot.requester_config` pèse **668 o par demande** et n'est **jamais relu après
  la création** — ses deux seuls consommateurs (`creation/NewRequestPage.tsx`,
  `create-request-from-procedure/index.ts`) lisent la démarche **rechargée depuis Socle**, pas
  le snapshot de la demande. Le retirer de la whitelist ferait un tiers du plus gros JSONB de la
  table, au prix de la trace de ce que la démarche exigeait comme identité au dépôt.
- `useNearbyRequests` filtre par `ilike` sur `requester_snapshot->declared->>{field}` :
  **aucun index** ne couvre ce chemin, c'est un balayage séquentiel du tenant. C'est aussi
  pourquoi il ne faut pas sortir `requester_snapshot` de la ligne.

**Matrice des transitions** (le contexte de service la contourne explicitement — une garde
sans contournement bloquerait la péremption automatique et l'ingestion, leçon Clara) :

| Depuis | Vers | Exigences |
|---|---|---|
| `a_traiter` | `en_instruction` | `assigned_to` NOT NULL |
| `a_traiter` | `resolue_negative` | motif ∈ irrecevable/doublon/reorientation (le commentaire pour l'usager est FACULTATIF depuis le 2026-08-28) |
| `a_traiter` | `annulee` | motif ∈ abandon/retrait_usager |
| `en_instruction` | `en_attente` · `resolue_positive` · `resolue_negative` · `annulee` · `a_traiter` | résolutions : **aucune exigence de données** depuis le 2026-08-28 (`closure_text` facultatif) ; annulation : motif |
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
- **`request_emails`** *(2026-08-26)* — échanges **sortants** vers l'usager : `sent_by`,
  `to_email` (adresse RÉELLEMENT servie, figée), `subject`, `body` (le texte réellement parti),
  `template_id` (`on delete set null`) + `template_name` figé, `status`
  `en_cours|envoye|echec`, `error`, `sent_at`. Même trigger de cohérence.
  **Aucune écriture cliente et aucune suppression** : la seule porte est l'edge function
  `send-request-email`, en service_role, via `start_request_email` / `settle_request_email`.
  Le pendant de `request_messages` : celles-ci ne sortent jamais, celle-ci ne fait que sortir.
- **`request_attachments`** — pièces : `storage_path`
  (`{organization_id}/{request_id}/{uuid}-{slug}`), `checksum` (dédup),
  `copy_status` `copied|pending|error` (copie asynchrone à venir), type de PJ Socle en
  UUID nu + libellé figé, `form_field_key` (nullable — clé machine `key` du champ « pièce
  justificative » du `form_schema` auquel la pièce répond ; NULL = pièce hors formulaire),
  `email_id` (nullable — pièce jointe à un échange sortant, dont elle suit le sort ; NULL =
  pièce déposée par l'usager ou par l'ingestion, seule catégorie affichée dans « Pièces de la
  demande »). Même trigger de cohérence.
  **Qualification** *(2026-08-28)* : `compliance` (`NULL` = pas encore examinée, `conforme`,
  `non_conforme`), `compliance_motif` (catalogue FERMÉ de cinq, obligatoire si non conforme et
  interdit sinon), `compliance_note` (précision libre, 500 car. — écrite POUR l'usager, reprise
  telle quelle dans le courriel de signalement), `compliance_by`, `compliance_at`. Cohérence
  tenue par un CHECK (pas de motif sans verdict, pas de trace sans verdict).
  **Aucune policy UPDATE cliente** (la table n'en a jamais eu) : la seule porte est la RPC
  `qualify_request_attachment`.
  **Remplacement** *(2026-08-28)* : `superseded_by` (auto-référence, `on delete set null`) +
  `superseded_at`, posés par la seule RPC `attach_request_piece`. Non-NULL = pièce hors du
  calcul de conformité, mais **toujours au dossier** — une pièce administrative ne se supprime
  pas. CHECKs : les deux colonnes vont ensemble, et une pièce ne se remplace pas elle-même.
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
(4 étapes, brouillon local, demandes proches, liaison `liee_a`).

**Jeu de démonstration ACCM (2026-08-28)** : le tenant porte 42 demandes de démonstration,
`DEM-2026-000008` à `DEM-2026-000049`, posées après l'enrichissement du référentiel Socle
(15 démarches, 8 organisations). Elles exercent les 15 démarches, les 8 organisations du
sous-arbre et les 7 statuts, sur 8 semaines, avec un journal antidaté. Elles ne portent
**aucune pièce jointe** : 23 d'entre elles ont donc une exigence obligatoire « manquante »
et leur résolution *positive* est fermée par `t17` — état authentique, pas artefact.
Détail, gardes neutralisées et justification de la recopie des snapshots :
[`supabase/migrations/20260828160000_seed_demandes_exemple_accm.sql`](../supabase/migrations/20260828160000_seed_demandes_exemple_accm.sql).
Purge (jamais via `apply_migration`) :
[`supabase/rollback/20260828_demandes_exemple_accm_purge.sql`](../supabase/rollback/20260828_demandes_exemple_accm_purge.sql).
Les 7 demandes antérieures (`DEM-2026-000001` à `000007`) subsistent à côté.

Le **brouillon de saisie** n'existe pas côté serveur : il vit dans le localStorage du poste
(un par tenant et utilisateur), ne transporte que des identifiants et des saisies (usager
rapproché = `socle_contact_id` seul, relu via `socle-proxy /v1/contacts/get` à la reprise ;
démarche rechargée ; pièces à redéposer) et le `request_id` du brouillon sert d'idempotence
à la création (rejeu → 409).

### Base de connaissances des démarches (2026-08-28) — lue, jamais stockée

Le Socle attache à chaque démarche une **base de connaissances** (`procedures.knowledge_base`)
qui s'adresse à **deux destinataires** : l'agent (consignes, procédures internes, documents
d'aide, liens utiles, FAQ, garde-fous) et l'assistant IA (documents d'entraînement, sources
de connaissance). Iris affiche **la part agent**, dans l'onglet « Procédure » du rail — au
guichet comme à l'instruction.

Ce lot n'ajoute **aucune table, aucune colonne, aucune migration** : la base de connaissances
est lue à la demande par `socle-proxy /v1/procedures/get` et n'est ni mise en cache côté
serveur, ni copiée dans une table, ni versée au `procedure_snapshot`. Trois raisons, dans cet
ordre :

1. **La fraîcheur est le service rendu.** Une consigne corrigée ce matin doit être celle que
   l'agent lit cet après-midi. Le snapshot fige le *formulaire du dépôt* — ce que l'usager a
   rempli, qui ne doit plus bouger. Une consigne d'instruction est l'inverse : elle doit
   suivre le service.
2. Le cache des démarches exclut déjà `form_schema`, `requester_config` et `knowledge_base`
   ([`architecture-proposee.md`](architecture-proposee.md) §D) — rien n'est changé à cette
   ligne.
3. Le volume est celui d'un document de service (textes Markdown, FAQ) : le recopier par
   demande coûterait bien plus que `procedure_snapshot`, pour une donnée qui n'a aucune
   valeur probante.

**Ce qui ne franchit pas la frontière** : `trainingDocuments` et `aiSources`, retirés par la
whitelist `parseAgentKnowledge` (`supabase/functions/socle-proxy/_shared/knowledge.ts`, pur,
testé). Un corpus de prompt n'a rien à faire dans un navigateur ; le jour où l'assistant
existera, il le lira côté serveur. Les **garde-fous**, eux, s'adressent explicitement « à
l'agent ET à l'IA » (libellé du Socle) : ils sont affichés.

**Documents d'aide agent** : ils vivent dans le bucket **Socle** `procedure-documents`. Iris
n'en copie aucun : `socle-proxy /v1/procedures/document-url` relaie l'URL signée du Socle,
après trois gardes — la démarche appartient au tenant, le chemin demandé est cité par les
`agentDocuments` de **cette** démarche (rechargée à l'instant), et le Socle revérifie le
préfixe d'organisation. Sans la deuxième, la route serait un lecteur libre du bucket dans
tout le périmètre de la clé, documents d'entraînement IA compris.

### Plafond d'utilisation IA (`20260828170000` à `20260828170200`)

Trois tables, un seul métier : borner ce que l'assistant IA coûte, par tenant et par mois.
**`ai_usage_quotas`** (le plafond), **`ai_usage_counters`** (consommé + réservé par
organisation, fournisseur et période `'YYYY-MM'`), **`ai_usage_events`** (le grand livre —
une ligne par appel, de la réservation au règlement, **sans aucun texte de prompt ni de
réponse**).

**Le cycle d'un appel : réserver → appeler → solder.**
`reserve_ai_usage` fait **UN SEUL `UPDATE` conditionnel**
(`where used + reserved + estimation <= plafond`) : Postgres prend le verrou de ligne dès
l'évaluation du `WHERE`, donc deux appels concurrents se sérialisent d'eux-mêmes (MVCC
standard, dès `READ COMMITTED` — ni `SERIALIZABLE` ni verrou consultatif). **0 ligne
affectée = plafond atteint** : refus sans incrément, et **le fournisseur n'est jamais
appelé**. `settle_ai_usage` est idempotent (ne transitionne que depuis `reserved`) :
`completed` corrige la réservation par la consommation réelle, `failed`/`timeout` libère la
réservation et **ne touche jamais `used_tokens`** — un appel qui n'a pas abouti n'est pas
facturé. `release_stale_ai_reservations(15)` (job cron **SQL pur**, toutes les 5 minutes,
sans secret Vault) rattrape les réservations orphelines d'une edge function morte en route.

**Aucun plafond configuré ⇒ illimité** : un tenant sans ligne n'est pas cassé par l'arrivée
de l'assistant. `counter_provider` vaut alors `NULL` sur l'événement, pour dire que rien n'a
été décompté.

**Périmètre de lecture** : administration du tenant ou admin plateforme. Une consommation est
un chiffre de gestion ; l'agent, lui, apprend le dépassement par le 429 de l'edge function.
Comme pour `permission_audit_log`, l'administrateur d'un **sous-arbre** voit le tenant entier
(risque résiduel assumé, [`droits.md`](droits.md)).

**Trois divergences délibérées avec Clara**, dont ce lot est le portage :

1. **La sentinelle `'__global__'` est là dès la première migration.** Clara écrivait
   `provider = NULL` pour « tous fournisseurs » et a dû migrer (`20260617090000`) : deux
   `NULL` ne sont jamais égaux pour un `UNIQUE`, donc `ON CONFLICT` ne rattrapait rien et
   empilait les lignes. Épinglé par le cas Q7 du test.
2. **Aucune policy d'écriture cliente, sur aucune des trois tables.** Chez Clara, le
   navigateur du superadmin fait lui-même l'`UPSERT` sous une policy RLS. Ici
   `set_ai_usage_quota` / `delete_ai_usage_quota` sont l'unique porte, avec la garde
   `is_platform_admin()` **dans** la fonction (motif `smtp_settings` et `permission_*`).
   ⚠️ Jamais `is_service_context()` dans ces fonctions : en `SECURITY DEFINER`, il vaut
   toujours vrai.
3. **Aucune policy `service_role` non plus** : l'écriture vient de RPC `SECURITY DEFINER`,
   qui s'exécutent comme le propriétaire et sortent du RLS. (`smtp_settings`, `notifications`
   et `email_templates` en portent une parce qu'elles sont écrites par le *client* service,
   pas par une RPC definer — la différence n'est pas un oubli.)

L'unité est le **jeton, jamais l'euro** : le prix au jeton est une donnée commerciale qui
bouge sans préavis, un montant affiché serait faux le jour du changement de tarif.

Test : `supabase/tests/plafond-ia.test.sql` (24 assertions, transactionnel annulé — cycle,
idempotence, filet, régression Clara, étanchéité cross- et intra-tenant, portes fermées).
Vérifié en navigateur réel le 2026-08-28 : depuis une session d'administrateur de tenant,
la RPC répond `403 « Le plafond d'utilisation IA se règle depuis la zone superadmin. »`,
l'`INSERT` direct `403 permission denied for table ai_usage_quotas`, et `reserve_ai_usage`
`403 permission denied for function`.

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

### Compteurs de demandes par usager (`20260823160000`)

`contact_request_counts(p_org_id)` → `(contact_id, total, open_count)` : une ligne par usager
Socle rapproché du tenant. Sert la **liste des usagers** (`/usagers`), qui ne peut pas être
servie par une seule base — les fiches viennent du Socle, les compteurs d'Iris.

- **`SECURITY INVOKER` volontairement** : le RLS s'applique donc à l'appelant et les compteurs
  ne comptent que les demandes de son périmètre. Deux agents peuvent lire deux nombres
  différents pour le même usager — même règle que la liste des demandes et la fiche usager.
  La passer en `DEFINER` fuirait une volumétrie hors périmètre (et rejouerait le piège
  `current_user` ci-dessus). `EXECUTE` révoqué de `public`/`anon`, accordé à `authenticated`.
- `open_count` = les trois statuts non finaux (`a_traiter`, `en_instruction`, `en_attente`) —
  miroir exact de `isFinal()` côté front.
- Index d'appui : `requests_org_contact_idx (organization_id, socle_contact_id)
  where socle_contact_id is not null`.
- Noms de colonnes de sortie **distincts** des colonnes de `requests` : en `language sql`, les
  colonnes d'un `RETURNS TABLE` sont des paramètres `OUT` visibles dans le corps
  (`socle_contact_id` y serait ambigu).

### Notifications in-app (`20260824100000`, `20260824100100`)

`notifications` — une ligne par (destinataire, événement). **Produite exclusivement par des
triggers `SECURITY DEFINER`** : aucune policy d'écriture cliente, un navigateur ne peut pas en
fabriquer pour autrui.

- Colonnes : `organization_id`, `user_id` (destinataire), `request_id`, `kind`
  (`assigned` | `unassigned` | `status_changed` | `note_added` | `new_request_in_scope`),
  `payload jsonb`, `actor_id` (NULL = système/ingestion), `created_at`, `read_at`.
- Trois FK en `on delete cascade` : la purge RGPD d'une demande emporte ses notifications.
- Index : `(user_id, organization_id, created_at desc)` pour le volet, index **partiel**
  `(user_id, organization_id) where read_at is null` pour la pastille, `(request_id)`.
- **`created_at default clock_timestamp()`** et non `now()` : `now()` est l'heure de DÉBUT DE
  TRANSACTION, donc les deux notifications d'une réaffectation (« retirée » à l'un, « affectée »
  à l'autre) portaient une date identique et l'ordre antichronologique du volet devenait
  indéterminé. Constat du test T6c.
- Le `payload` est un **instantané** (`reference`, `subject`, `actor_name`, statuts, démarche,
  destinataire) : le volet se rend sans jointure et reste lisible si le périmètre du
  destinataire change ensuite. **Jamais le corps d'une note interne** (invariant : les notes
  internes ne quittent pas Iris).

Triggers (nommés `t40_*`, donc après le journal `t30_*`) :

| Trigger | Table | Produit |
|---|---|---|
| `t40_requests_notify_insert` | `requests` (AFTER INSERT) | `assigned` à l'affectataire, puis fan-out `new_request_in_scope` aux membres détenant **instruction** sur le couple — affectataire et acteur exclus |
| `t40_requests_notify_update` | `requests` (AFTER UPDATE) | affectation changée → `assigned` au nouveau + `unassigned` à l'ancien ; **sinon** statut changé → `status_changed` à l'affectataire |
| `t40_request_messages_notify_insert` | `request_messages` (AFTER INSERT) | `note_added` à l'affectataire de la demande |

Fonctions d'appui, **toutes sans `EXECUTE` cliente** :

- `push_notification(...)` — insertion unitaire, porte la règle **« jamais pour son propre
  geste »** (`p_user_id = p_actor_id` → no-op) en un seul endroit. L'acteur est `auth.uid()`,
  NULL en contexte de service : `is [not] distinct from` sert alors tout le monde, ce qui est
  le comportement voulu pour une demande ingérée.
- `can_process_request_for(user, org, socle_org, procedure)` — droit d'instruction d'un tiers.
  **Même moteur** que partout (`permission_pairs_of`, ADR-04), sans la garde anti-sondage de
  `user_has_request_right` : cette garde protège un appel RPC client, elle n'a pas de sens dans
  un trigger et ferait taire les notifications quand l'auteur du geste n'est pas membre du
  tenant (administrateur de plateforme).
- `user_display_name(uuid)` — nom affichable figé dans le payload, repli sur le courriel.

RPC clientes (les seules, `EXECUTE` accordée à `authenticated` — advisor 0029 assumé, même
posture que les helpers existants) : `mark_notifications_read(uuid[])` et
`mark_all_notifications_read(uuid)`, toutes deux filtrées sur `user_id = auth.uid()` — les
identifiants d'autrui sont ignorés silencieusement.

**Temps réel** : la table est ajoutée à la publication `supabase_realtime`. Realtime ré-applique
le RLS par abonné ; le filtre `user_id` posé côté client n'est qu'une économie de trafic.

### Doublage e-mail et préférences par canal (`20260824110000`)

**Un événement, une ligne, N canaux.** On ne duplique pas la ligne par canal : `notifications`
porte l'état de chacun. Ajouter un canal (SMS, push) = ajouter des colonnes, sans toucher aux
déclencheurs ni au volet.

- `in_app boolean` — `false` : la ligne existe UNIQUEMENT pour porter l'e-mail (canal in-app
  coupé par préférence). Le volet filtre dessus ; le RLS est inchangé.
- `email_status` — boîte d'envoi : `pending` · `sending` (réclamée) · `sent` · `skipped`
  (canal coupé, destinataire sans adresse, tenant sans relais) · `failed` (abandon).
  Plus `email_attempts`, `email_attempted_at`, `email_sent_at`, `email_next_attempt_at`,
  `email_error`. Index partiel `notifications_email_queue_idx` sur la file.

**L'envoi ne part JAMAIS du déclencheur** : un appel SMTP dans la transaction métier la fait
traîner (le relais met des secondes) et la fait échouer quand le relais est indisponible — on
n'annule pas une affectation parce qu'un serveur de mail tousse. La ligne est une boîte
d'envoi drainée par l'edge function `notifications-mailer` sur `pg_cron` (`* * * * *`), même
motif que `integration_deliveries` et que le cron de `sync-socle-referentiel` (secret au Vault).

| Fonction | Rôle |
|---|---|
| `claim_notification_emails(limit)` | réclame un lot ET le marque `sending` **atomiquement** (`for update skip locked`) — deux mailers concurrents n'expédient jamais deux fois ; récupère les lignes `sending` figées depuis 15 min |
| `settle_notification_email(id, ok, error)` | succès → `sent` ; échec → retour en file avec temporisation croissante (2, 4, 8, 16 min), puis `failed` au-delà de 5 tentatives |
| `skip_notification_email(id, raison)` | renonce définitivement (pas d'adresse, pas de relais) |

Toutes `service_role` uniquement — aucune `EXECUTE` cliente.

**Préférences** (`notification_preferences`, réglées depuis « Mon compte ») : clé
`(user_id, kind)` — **GLOBALES à tous les tenants du compte** (décision PO 2026-08-24,
migration `20260824130000` ; la clé portait d'abord `organization_id`). « Je ne veux pas de
courriel pour les notes internes » est une décision sur SOI, pas sur une organisation : un
agent rattaché à deux collectivités ne règle pas deux fois la même chose. `'*'` porte le défaut
du compte, une ligne de motif le surcharge. `notification_channels_for(user, kind)` est la
SEULE porteuse de cette sémantique, et elle est **fail OPEN** — l'absence de préférence notifie
sur tous les canaux. C'est l'inverse du modèle de droits (*fail closed*) et c'est délibéré :
un droit manquant doit fermer, une préférence manquante ne doit pas faire taire une information.
Si les deux canaux sont coupés, **aucune ligne n'est créée**.

Contrairement à `notifications` (aucune écriture cliente : ce n'est pas un geste d'utilisateur),
une préférence **est** le geste de son titulaire : policies SELECT/INSERT/UPDATE/DELETE bornées
à `user_id = auth.uid()`, l'écriture exigeant en plus l'appartenance au tenant.

### Compte utilisateur — photo et verrouillage de l'adresse (`20260824120000`)

- `public.users.avatar_path` — chemin de la photo dans le bucket **privé** `avatars`
  (`{user_id}/{uuid}.{ext}`). NULL = initiales. Lu par **URL signée** (1 h) : un bucket public
  servirait la photo d'un agent à qui connaît l'adresse, sans authentification ni trace.
- Bucket `avatars` : privé, 2 Mio, `allowed_mime_types` limité aux images. Le **premier segment
  du chemin EST l'identifiant** — c'est lui que la policy compare à `auth.uid()`. Écriture et
  suppression : **son dossier uniquement** (aucun administrateur ne pose la photo d'un autre,
  ce n'est pas un attribut administré). Lecture : la sienne + celle des membres du même tenant
  (`shares_org_with`). Un nouvel envoi écrit un NOUVEAU chemin, l'ancien est supprimé ensuite :
  pas de cache de navigateur à combattre.
- **`t03_users_protect_email`** — `public.users.email` est un miroir de `auth.users.email`,
  c'est-à-dire l'identifiant de connexion. La policy `users_update` autorise un utilisateur à
  écrire SA ligne (nom, photo) ; sans cette garde il pourrait aussi y réécrire son adresse et
  désynchroniser le miroir **sans que sa connexion change pour autant**. Le contexte de service
  et l'administrateur de plateforme passent — même posture que l'anti-escalade voisine.
- Le **changement de mot de passe** n'a aucune empreinte SQL : il vit dans GoTrue. GoTrue
  n'ayant pas d'« update with current password », la revérification se fait par une
  **reconnexion** avec l'ancien mot de passe avant `updateUser` — Iris ne stocke ni ne voit
  jamais un mot de passe.

### Mentions dans les notes internes (`20260824140000`)

La mention vit **dans le corps** de la note : `@[Nom affiché](uuid)`. Pas de table satellite —
la note est auto-portante, la base valide et notifie depuis le seul corps, et le nom figé suit
la philosophie d'instantané du projet.

- `message_mentions(text) → uuid[]` (IMMUTABLE, interne) — le motif n'accepte que des UUID bien
  formés. Jumeau exact du motif front (`src/features/requests/instruction/mentions.ts`).
- **`t03_request_messages_guard_mentions`** (BEFORE INSERT OR UPDATE) — refuse la note si un
  mentionné n'est pas membre du tenant, ou n'a pas **consultation** sur le couple de la demande.
  C'est la garde : le sélecteur de l'écran n'en est que le reflet.
- `mentionable_users(request_id)` (RPC `authenticated`, gardée par `can_read_request`) — membres
  détenant consultation, **avec `avatar_path`** (migration `20260824150000` : le sélecteur
  montre un visage). Sœur d'`eligible_assignees`, autre droit. **Inclut l'appelant à dessein** :
  elle sert aussi à résoudre les noms et photos des mentions déjà écrites, les siennes
  comprises. Ne pas se proposer soi-même est une décision d'interface, prise à l'écran.
- `request_right_for(user, org, socle_org, procedure, right)` — enveloppe **générique** du
  moteur (`permission_pairs_of`) pour un tiers, sans la garde anti-sondage de
  `user_has_request_right`. **Remplace `can_process_request_for`** : une enveloppe paramétrée
  par droit plutôt que deux quasi-identiques.
- Nouveau motif **`mentioned`** dans `notifications.kind` et `notification_preferences.kind`.
  Il **prime sur `note_added`** : l'affectataire cité reçoit `mentioned` et pas les deux — même
  règle « un geste, une notification par personne » que pour l'affectation.

⚠️ Le nom figé dans le jeton n'est pas de confiance (`@[Le Maire](uuid-d-un-autre)` s'écrit à la
main). Le normaliser côté base coûterait une réécriture de chaîne dans un trigger pour un gain
nul : **l'affichage** préfère toujours le nom vivant de l'annuaire.

### Modèles d'e-mail (`20260826100000`, `20260826100100`, `20260826110000`)

`email_templates` — textes réutilisables du tenant : `name` (unique par tenant, casse et
espaces ignorés), `description`, `subject`, `body`, `version` (verrou optimiste RM-56),
traçabilité `created_by` / `updated_by`. Texte BRUT à variables `{{groupe.cle}}`.

**Écriture par policies, pas par RPC** — à rebours des tables `permission_*`, et délibérément :
une ligne, un prédicat simple (`is_org_admin_anywhere`), aucune lecture de cette table par le
moteur de droits, aucun secret. Le seul invariant qui dépasse le prédicat est porté par un
trigger. Lecture ouverte à tout membre (`is_org_member`) : un agent choisira un modèle depuis
une demande, rien ne justifie de le lui cacher.

**Le catalogue de variables est un contrat** : `email_template_variables()` (liste figée) et
`email_template_unknown_variables(text)`, toutes deux internes, alimentent
`t03_email_templates_guard_variables` qui **refuse** l'écriture citant une variable inconnue.
⚠️ Cette garde doit être **`SECURITY DEFINER`** : en `INVOKER` elle s'exécute comme l'agent,
qui n'a aucun droit sur le catalogue — c'est le défaut corrigé par `20260826100100`, invisible
au test tant que celui-ci se contentait de constater « une erreur a été levée ».

**Activation par organisation** (`email_template_organizations`, clé
`(template_id, socle_org_id)`) — satellite au motif de `permission_profile_organizations` :
`socle_org_id` est un UUID Socle **nu** (aucune FK ne franchit une frontière de projet), la
cohérence de tenant étant tenue par `t01_email_template_organizations_scope`.

- **Un modèle neuf n'est activé nulle part.** L'absence de ligne vaut « inactif ».
- **Pas de descendance implicite** (contrairement au périmètre d'un profil) : chaque
  organisation est activée nommément.
- Écriture gouvernée par **`has_admin_scope(tenant, socle_org)`** et non
  `is_org_admin_anywhere` : ouvrir un modèle à la Voirie est une décision sur la Voirie.
- Pas de policy UPDATE : on active (insert) ou on désactive (delete).
- `administrable_organizations(p_org_id)` (RPC `authenticated`) rend les organisations du
  tenant que l'appelant administre — la LISTE que `has_admin_scope` ne donne que nœud à nœud.

### Qualification des pièces (`20260828100000`, `20260828100100`)

L'agent déclare chaque pièce **conforme** ou **non conforme**. Trois effets, tous serveur :

1. une exigence de pièce **obligatoire** non conforme ferme `en_instruction → resolue_positive`
   (garde `t17`, tableau ci-dessus) ;
2. déclarer une pièce non conforme place la demande **`en_attente`** — le statut existe déjà et
   s'intitule « En attente d'information » : aucun 8ᵉ statut, l'invariant du workflow fixe tient.
   Depuis `a_traiter`, la matrice interdit la transition : le statut ne bouge pas, et la RPC le
   **dit** dans son retour (`status_changed: false`) plutôt que de laisser l'écran le deviner ;
3. le retour en instruction reste un **geste d'agent** : l'UI le propose quand tout est
   redevenu conforme, elle ne le fait pas à sa place.

**Ce que « obligatoire » veut dire.** La garde ne peut pas se contenter des lignes déposées —
une exigence jamais honorée n'a aucune ligne, et c'est justement le cas qu'il faut voir. Elle
relit donc `procedure_snapshot -> 'form_schema'` et rejoue les conditions sur `form_data`,
comme l'écran. D'où un **jumeau SQL du moteur de formulaire** (contrat Socle `form_schema` v1) :
`form_condition_valid` / `form_condition_met` / `form_value_empty` / `form_rule_target` /
`form_rule_equals` / `form_rule_includes` / `form_field_valid` / `form_node_valid` /
`form_schema_content` / `form_data_key` / `form_attachment_required` /
`form_attachment_requirements` — toutes `IMMUTABLE`, sans accès aux tables, `EXECUTE` révoqué
partout. Le jumeau TypeScript est
[`src/features/requests/instruction/conformite.ts`](../src/features/requests/instruction/conformite.ts).

**Le parseur est fidèle, pas tolérant** : côté TS, un seul nœud illisible vide le schéma ENTIER
(parité Socle). Le SQL refait ce choix à l'identique. Sans cela, la base bloquerait sur une
exigence que l'écran ne sait pas afficher — un refus qu'un agent ne pourrait ni comprendre ni
lever. En cas de doute, le SQL ne trouve **aucune** exigence et ne bloque rien.

⚠️ **La propagation de NULL est le piège de tout jumeau SQL d'un contrat JSON** (correctif
`20260828100100`, trouvé par le test avant toute mise en service). `p_field -> 'requiredIf'`
vaut SQL NULL quand la clé est absente, donc `jsonb_typeof(...) <> 'object'` vaut **NULL, pas
TRUE** : le `CASE` ne prend pas cette branche, tombe dans le `else` et appelle
`form_condition_met(NULL)` — qui répond TRUE à juste titre, mais à la mauvaise question. Toute
pièce **facultative** devenait ainsi obligatoire. Six fonctions étaient touchées, toujours dans
le sens dangereux (accepter un nœud illisible, donc garder un schéma que l'écran aurait vidé).
**Règle : comparer un `jsonb_typeof` sans `coalesce(..., '')` est un bug en attente**, et seul
un test qui passe par la garde RÉELLE — pas par la seule fonction — l'attrape.

**`qualify_request_attachment(attachment_id, compliance, motif, note)`** est l'unique porte
d'écriture (motif `permission_*` et `request_emails`) : elle vérifie le droit d'**instruction**,
refuse une pièce jointe à un échange sortant (c'est un envoi du service, pas une pièce de
l'usager) et une demande close, écrit le verdict, journalise `piece_qualifiee`, puis bascule le
statut. Elle rend `{attachment_id, request_id, compliance, motif, status, status_changed}`.

⚠️ Elle est `SECURITY DEFINER`, donc son UPDATE de statut traverse `requests_guard_write` en
**contexte de service** (`is_service_context()` y vaut toujours vrai — piège documenté plus
haut) : les portes par droit y sont contournées. C'est assumé, et c'est **pourquoi le droit
d'instruction est vérifié dans la RPC elle-même**, explicitement, avant toute écriture. La
matrice des transitions, les exigences de données et la garde `t17` restent appliquées : elles
ne dépendent pas du contexte.

**Reprise** : les demandes déjà en cours n'ont aucune pièce qualifiée, donc ne peuvent être
résolues positivement qu'après qualification. C'est le comportement voulu, pas un effet de bord.

### Ajouter une pièce, modifier les réponses (`20260828110000`)

Deux gestes de la fiche d'instruction, décidés le 2026-08-28.

**Ajouter une pièce — « la plus récente fait foi » (décision PO).** La pièce déposée sur une
exigence REMPLACE celles qui y étaient actives : elles passent en `superseded_by` et sortent du
calcul, sans quitter le dossier. Sans cela, corriger un justificatif ne débloquerait rien —
l'ancien, non conforme, continuerait de compter.

> ⚠️ **Conséquence assumée, signalée au PO avant sa décision** : sur le motif « la pièce est
> incomplète », la page manquante ne s'AJOUTE pas, elle remplace. Le dialogue l'annonce avant
> l'envoi (« remplacera les N pièces déjà déposées, qui resteront au dossier »). Le jour où le
> besoin se précise, seule change la LISTE des lignes que la RPC marque : la colonne tient déjà
> les deux régimes, et `pieceRequirements` distingue déjà actives et remplacées.

**`attach_request_piece(request_id, storage_path, file_name, mime, size, form_field_key,
replaces_id)`** — porte unique. Pourquoi une RPC alors que `request_attachments_insert` autorise
déjà le client : l'ajout, le remplacement et le journal doivent être **atomiques**. Un INSERT
client suivi d'un UPDATE client laisserait, sur coupure, une pièce neuve à côté d'une ancienne
toujours active — une exigence bloquée que personne ne comprendrait. Elle vérifie le droit
d'**instruction** (piège DEFINER : `is_service_context()` y vaut toujours vrai, donc le contrôle
est fait ICI), refuse une demande close, et **vérifie le préfixe du `storage_path`**
(`{organization_id}/{request_id}/`) : le chemin porte le RLS storage, il ne peut désigner ni une
autre demande ni un autre tenant. Sans `form_field_key`, seule la ligne nommée par `replaces_id`
est remplacée — il n'y a pas d'exigence à laquelle rattacher un groupe. Journalise
`piece_ajoutee` (avec le nombre de remplacées).

**Modifier les réponses (`requests.form_data`)** — aucune garde nouvelle : `requests_guard_write`
exige déjà le droit d'**instruction** pour toucher `form_data`, et `requests_protect_immutable`
gèle une demande archivée. Ce qui manquait, c'est la **trace** : `requests_log_update` émet
désormais `form_data_updated`. Le payload ne porte que les **clés** touchées, jamais les
valeurs — une réponse peut contenir des données personnelles, et le journal est immuable : on
n'y écrit pas ce qu'une purge devrait plus tard effacer.

⚠️ Le `procedure_snapshot` reste **FIGÉ**. On corrige les réponses au formulaire retenu au dépôt,
jamais la définition de la démarche : elle vit dans le Socle, et Iris ne la redéfinit pas
(invariant). C'est pourquoi aucune relecture Socle n'intervient ici, contrairement à la création.

⚠️ **Conséquence de sécurité connue** : `form_data` conditionne ce que `t17` juge obligatoire
(`requiredIf`). Un agent pourrait donc modifier une réponse pour qu'une pièce cesse d'être
exigée, et clore. Ce n'est **pas** une escalade — le même agent peut tout aussi bien déclarer la
pièce conforme —, et les deux gestes sont journalisés. À revoir si le PO veut un second regard
sur la clôture.

### Avis de clôture à l'usager (`20260828120000`)

Résoudre une demande PRÉVIENT l'usager par courriel (décision PO 2026-08-28) — objets figés
« Votre demande a été résolue positivement » et « Nous ne pouvons répondre positivement à votre
demande » —, et l'échange est enregistré dans `request_emails` comme n'importe quel autre.

**Le commentaire de l'agent devient facultatif.** La migration réémet `requests_guard_write`
sans l'exigence `closure_text` (une seule ligne de moins, le reste copié à l'identique — le prix
assumé d'une porte unique). L'exigence servait à garantir qu'on dise QUELQUE CHOSE à l'usager ;
c'est désormais l'avis lui-même qui s'en charge, et il se tient sans commentaire. Le motif de
clôture, lui, reste obligatoire là où il l'était.

**`send-request-email` gagne un mode** `kind: "cloture"` : le navigateur n'envoie QUE
l'identifiant de la demande, et le serveur compose objet, salutation, phrase d'annonce,
commentaire et signature depuis l'état enregistré (`_shared/email/cloture.ts`, pur/testé).
C'est cette composition serveur qui autorise le mode à exiger la **clôture** plutôt que
l'instruction — le droit qui vient d'autoriser la transition : détenir `cloture` ne donne pas le
pouvoir d'écrire n'importe quoi à un habitant, seulement celui d'annoncer une décision qu'on
vient de prendre. Ni pièce jointe ni modèle ne sont acceptés dans ce mode.

⚠️ **Le motif de clôture ne sort jamais.** `closure_motif` (« irrecevable », « réorientation »,
« doublon ») classe le dossier pour le service ; il n'explique rien à un habitant. Seul le texte
libre de l'agent l'atteint — ce que la colonne `closure_text` promet depuis l'origine.

⚠️ **L'envoi SUIT la transition, il ne la conditionne pas.** La demande est résolue quoi qu'il
arrive ; un échec s'affiche comme tel sans laisser croire que la clôture a échoué, et le cas le
plus courant — aucune adresse au dossier — est annoncé comme un fait, pas comme une erreur.
Résidu connu : si le navigateur meurt entre la transition et l'appel, l'avis ne part pas et
aucune trace n'est écrite. Le jour où ça gêne, la sortie est une boîte d'envoi drainée sur cron
(motif `notifications-mailer`), pas un envoi synchrone plus robuste.

⚠️ **Une civilité se normalise avant de sortir** (`civilityLabel`, `_shared/identity/declared.ts`) :
le Socle la stocke en minuscules, et le premier envoi réel a produit « monsieur Laurent Jacquot, »
en tête d'un avis pendant que l'écran affichait « Monsieur ». Le catalogue est désormais PARTAGÉ
entre l'écran et le serveur — il n'y en a qu'un.

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
| `smtp_settings` | — (aucune surface cliente : miroir du Socle) | — (RPC de service) | — (RPC de service) | — (RPC de service) |
| `request_sequences` | membre (diagnostic) | — | — | — |
| `requests` | couple **consultation** (`(org, socle_scope_org_id, coalesce(socle_procedure_id, nil_procedure())) IN my_permission_pairs('consultation')`) | couple **création** **et** `source='iris'` | couple **écriture** (USING) ; `with check` = appartenance seule, la finesse par droit vit dans `t11_requests_guard_write` | — |
| `request_events` | `EXISTS` demande visible (couple consultation, via le RLS de `requests`) | — | — (trigger raise) | — (trigger raise) |
| `request_assignments` | idem | — | — (trigger raise) | — (trigger raise) |
| `request_messages` | idem (RM-10 : notes internes comprises dans la consultation) | couple **écriture** + `author_id = auth.uid()` | auteur avec couple écriture **ou** `has_admin_scope` sur l'organisation de la demande | idem UPDATE |
| `request_attachments` | `EXISTS` demande visible | couple **instruction** + `uploaded_by = auth.uid()` | — | `has_admin_scope` sur l'organisation de la demande |
| `request_emails` | `EXISTS` demande visible (un échange avec l'usager n'est pas une note interne) | **aucune** — service seul | **aucune** — le corps doit rester celui qui est parti | **aucune** — un e-mail parti ne se dé-envoie pas |
| `request_links` | `EXISTS` demande visible (la ligne appartient à la source) | couple **écriture** sur la source ; trigger `request_links_check_scope` exige en plus la **consultation** de la cible (hors contexte de service) | — | `has_admin_scope` sur l'organisation de la demande |
| `integration_deliveries` | membre (diagnostic) | — | — | — |
| `notifications` | **soi seul** (`user_id = auth.uid()`) | — (triggers DEFINER) | — (RPC `mark_*_read`) | — |
| `notification_preferences` | soi seul | soi seul | soi seul | soi seul |
| `email_templates` | membre du tenant | `is_org_admin_anywhere` + `created_by = auth.uid()` | `is_org_admin_anywhere` | `is_org_admin_anywhere` |
| `email_template_organizations` | membre du tenant du modèle | **`has_admin_scope`** sur l'organisation visée | — (rien à modifier) | **`has_admin_scope`** sur l'organisation visée |
| `storage.objects` (bucket `avatars`) | son dossier, ou celui d'un membre du même tenant | **son dossier seul** | son dossier seul | son dossier seul |
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

[`../supabase/tests/qualification-pieces.test.sql`](../supabase/tests/qualification-pieces.test.sql) —
**8 groupes, tous passés le 2026-08-28** : le jumeau SQL du moteur rend les MÊMES exigences que
`conformite.test.ts` (14 cas littéralement jumeaux : `required` statique, `requiredIf` satisfaite
ou non, champ et section masqués par `visibleIf`, clé machine vide, nœud illisible, version non
prise en charge, snapshot dégradé, combinator `or`, `isNotEmpty` sur tableau vide, `equals` valant
« contient », `requiredIf` sans règle) · `request_pieces_blocking` bloque sur manquante / à
qualifier / non conforme, jamais sur une pièce facultative, jamais sur une pièce d'échange
SORTANT · la garde `t17` ferme la résolution POSITIVE et **elle seule** (attente, annulation et
résolution négative passent), même en contexte de service · la RPC écrit le verdict, normalise la
précision, journalise, bascule en attente depuis l'instruction et **pas** depuis « À traiter » ·
refus de verdict inconnu / motif manquant / motif hors catalogue / précision > 500 / pièce
d'échange sortant / demande close · le droit d'**instruction** est exigé (consultant, autre
sous-arbre, autre tenant refusés **avec le bon message**) · aucune écriture directe possible
(0 ligne affectée) et les fonctions du jumeau restent fermées aux clients · les CHECK de la table
tiennent la cohérence en dernier recours.
⚠️ **C'est ce test qui a trouvé le bug de propagation de NULL** (correctif `20260828100100`) : il
n'apparaissait qu'en passant par la garde RÉELLE, sur une pièce **facultative** — la fonction
prise isolément n'aurait rien montré.

[`../supabase/tests/pieces-remplacees.test.sql`](../supabase/tests/pieces-remplacees.test.sql) —
**7 groupes, tous passés le 2026-08-28** : la pièce ajoutée remplace TOUTES les actives de son
exigence (y compris une conforme — c'est la règle choisie) · une pièce d'échange sortant portant
la même clé n'est PAS touchée, ni une pièce hors formulaire · l'exigence retombe « à qualifier »
puis se débloque une fois la neuve conforme — ce que l'ancienne empêchait · le journal porte le
nombre de remplacées · hors formulaire, le remplacement se désigne nommément, et sans clé ni
cible rien n'est remplacé · gardes de la RPC (chemin hors de la demande, nom vide, demande close,
fuite intra-tenant, toutes vérifiées **sur le message**) · `form_data_updated` compte les clés,
n'écrit aucune valeur, ne se déclenche pas sur une écriture sans changement, et le CCAS ne peut
pas modifier les réponses de la Voirie · les CHECK de cohérence de `superseded_*`.
⚠️ Deux faux échecs de ce test valent d'être notés, tous deux dans le TEST et non dans le code :
appeler `request_pieces_blocking` en se faisant passer pour un client (EXECUTE révoqué — ce qui
CONFIRME la garde), et vérifier « `superseded_by` sans `superseded_at` » sur une ligne déjà
remplacée, où `superseded_at` était donc déjà posé.

[`../supabase/tests/echanges-usager.test.sql`](../supabase/tests/echanges-usager.test.sql) —
**10 groupes, tous passés le 2026-08-26** : la RPC de service ouvre l'échange ET ses pièces en
une transaction · `settle` pose `sent_at` / tronque le motif d'échec à 500 · la lecture SUIT la
demande (instructeur **et** simple consultant) · fuite intra-tenant (sous-arbre frère) et
cross-tenant · **aucune écriture cliente**, pas même par l'expéditeur (INSERT refusé par le RLS
avec le bon message, UPDATE et DELETE sans effet) · une pièce à `email_id` exige le droit
d'**instruction** · RPC fermées aux clients et `request_right_for` ouverte au seul
`service_role` · le moteur de droits distingue instructeur / consultant / autre sous-arbre ·
cascade depuis la demande · garde de périmètre cross-tenant.
⚠️ Ce test a établi qu'**une demande n'est pas supprimable par un simple DELETE** : la cascade
atteint `request_events`, que `t01_request_events_immutable` protège. La purge RGPD (écart 3)
devra lever cette garde.

[`../supabase/tests/modeles-email.test.sql`](../supabase/tests/modeles-email.test.sql) —
**8 groupes, tous passés le 2026-08-26** : création par un administrateur · variable inconnue
refusée **avec le bon message** (le test vérifie le TEXTE du refus : un
`exception when others` accueillait un `permission denied` comme un refus légitime, et c'est
ainsi qu'un vrai défaut est passé) · texte entre accolades ordinaire accepté · nom unique par
tenant · verrou optimiste · étanchéité cross-tenant · un agent lit sans écrire · catalogue hors
de portée d'`authenticated`.

[`../supabase/tests/modeles-email-organisations.test.sql`](../supabase/tests/modeles-email-organisations.test.sql)
— **10 groupes, tous passés le 2026-08-26** : un modèle neuf n'est actif nulle part ·
administrateur racine vs **administrateur borné à une branche** (le cœur du fichier : il active
sur sa branche, jamais sur le CCAS ni sur la racine) · un agent ne voit aucune organisation
administrable · étanchéité cross-tenant · garde de cohérence de tenant · cascade à la
suppression du modèle.

[`../supabase/tests/mentions.test.sql`](../supabase/tests/mentions.test.sql) — **10 scénarios,
tous passés le 2026-08-24**, transactionnel annulé : extraction et dédoublonnage · mention d'un
CONSULTANT acceptée et notifiée · mention d'un non-consultant **refusée** et mention d'un membre
d'un autre tenant **refusée** (attaques directes sur l'insertion, écran contourné) · se
mentionner soi-même ne notifie pas · l'affectataire cité reçoit `mentioned` et **pas** en plus
`note_added`, l'affectataire non cité reçoit bien `note_added` · la préférence « mentioned »
coupée fait taire les deux canaux · `mentionable_users` ne rend que les consultants ·
`request_right_for` et `message_mentions` hors de portée d'`authenticated`.

[`../supabase/tests/compte-utilisateur.test.sql`](../supabase/tests/compte-utilisateur.test.sql)
— **9 scénarios, tous passés le 2026-08-24**, transactionnel annulé : je modifie mes noms et le
chemin de ma photo · **je ne peux pas réécrire mon adresse e-mail**, mais le contexte de service
le peut (sans quoi la garde bloquerait aussi l'administration légitime) · le profil d'autrui
reste hors d'atteinte · dépôt et suppression bornés à mon dossier · lecture de la photo d'un
collègue du même tenant, **jamais** celle d'un autre tenant.

[`../supabase/tests/notifications-email.test.sql`](../supabase/tests/notifications-email.test.sql)
— **11 scénarios, tous passés le 2026-08-24**, transactionnel annulé : sans préférence les deux
canaux sont servis (*fail open*) · e-mail coupé → la ligne existe mais l'envoi est `skipped` ·
la **même préférence s'applique dans un second tenant** (le décor rattache l'agent à deux
collectivités — c'est tout l'objet de la portée globale) ·
in-app coupé → ligne **muette** qui ne sert qu'à l'envoi · les deux coupés → **aucune ligne** ·
une ligne de motif surcharge le défaut `'*'` · le **fan-out** respecte les préférences, pas
seulement l'envoi unitaire · **double réclamation impossible** · règlement : succès, échec
temporisé (avec vérification que la temporisation est bien posée), abandon au-delà du plafond ·
la boîte d'envoi est hors de portée d'`authenticated` · une préférence n'est lisible et
écrivable que par son titulaire.

[`../supabase/tests/notifications.test.sql`](../supabase/tests/notifications.test.sql) — **11
scénarios, tous passés le 2026-08-24**, transactionnel annulé : les cinq motifs · **jamais pour
son propre geste** (changement de statut, note, auto-affectation puis auto-désaffectation) · le
fan-out sert l'**instruction** et ni la consultation seule ni un autre couple (organisation,
démarche) · une demande ingérée (acteur NULL) sert tout le périmètre sans inventer d'acteur ·
le **corps de la note interne ne fuite pas** dans le payload · un client ne voit que les
siennes et ne peut ni en fabriquer, ni en modifier, ni en supprimer · `push_notification` et
`can_process_request_for` hors de portée d'`authenticated` · les RPC d'accusé de lecture ne
touchent que ses propres lignes · la table est bien publiée en temps réel.

[`../supabase/tests/messagerie.test.sql`](../supabase/tests/messagerie.test.sql) — **12
scénarios, tous passés le 2026-08-23** (version « miroir du Socle ») : les RPC de saisie et
leurs gardes n'existent plus (`to_regprocedure`) · le service écrit le miroir en normalisant
(hôte détouré, adresse en minuscules) et trace la provenance (`socle_org_id`,
`socle_updated_at`) · secret rangé au Vault, déchiffré par `smtp_config_for_org` seul ·
**aucune surface cliente** : un administrateur ne lit même plus `host`, et INSERT/UPDATE/DELETE
directs sont refusés · les quatre fonctions de service sont hors de portée d'un client
authentifié · un mot de passe changé **remplace** le secret sans doublon · un mot de passe
retiré côté Socle **supprime** le secret (miroir strict, à l'inverse de l'ancienne saisie où le
champ vide valait « inchangé ») · déclaration inexploitable refusée, port hors bornes ramené à
587 · un agent de branche est servi par le relais de son tenant · effacement du miroir emportant
le secret Vault (et second effacement honnête) · étanchéité cross-tenant · l'invitation d'un
agent reste ouverte à tout administrateur du tenant.

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
transitions refusées (matrice, agent non assigné) · **T6 inversé le 2026-08-28** : une résolution SANS commentaire est désormais acceptée, et le commentaire reste écrivable après coup · réouverture
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
   `service_role` de purge reste à écrire (phase 5). ⚠️ Elle devra **lever l'immuabilité de
   `request_events`** : sans cela un `delete from requests` échoue, la cascade butant sur
   `t01_request_events_immutable` (constaté par `echanges-usager.test.sql`). Les satellites,
   `request_emails` compris, cascadent sans difficulté une fois cette garde levée.
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
7. **Archivage d'un usager non repris (2026-08-23)** : la fiche usager Iris sait désormais
   **modifier** un usager du Socle (`socle-proxy /v1/contacts/update`), mais pas l'archiver ni
   le restaurer. Le Socle expose pourtant `POST /v1/contacts/{id}/archive` et `/restore`
   (idempotents, sans corps, réponse = fiche complète), et Clara les propose depuis sa fiche
   contact. Le champ `status` est explicitement **refusé** par `filterContactUpdate` — un
   archivage ne doit pas passer pour une modification de champ. Ce qu'il faudrait pour le
   livrer : deux routes proxy (relais des deux endpoints), un bouton « Archiver » /
   « Restaurer » en `AlertDialog` de confirmation sur la fiche, et **une décision PO sur le
   droit requis** (voir le risque résiduel correspondant dans [`droits.md`](droits.md)).
   Aujourd'hui la fiche se contente de **refléter** un usager non actif (badge de statut) et
   reste consultable ; les demandes déjà déposées ne sont pas affectées (leur
   `requester_snapshot` est figé au dépôt).
8. **Retrait futur de `organization_members.role`** : colonne dérivée transitoire depuis le
   2026-08-22 (filet de compatibilité front/edge functions pendant la bascule) — planifiée pour
   suppression dans une vague ultérieure, une fois toute la surface applicative migrée vers les
   droits effectifs (`my_rights`), pour éviter une seconde source de vérité.
