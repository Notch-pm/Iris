# Backlog sécurité

> **Public** : PO et équipe Iris · **Question traitée** : qu'a trouvé l'audit de sécurité,
> qu'est-ce qui reste à corriger, et comment vérifier chaque correction ? · **Dernière mise à
> jour** : 2026-09-19

Ce document consigne les constats de l'**audit de sécurité du 2026-09-19**. Il ne double ni
[`backlog.md`](backlog.md) (demandes produit) ni [`dette-technique.md`](dette-technique.md)
(dette assumée) : ici, ce sont des **écarts à corriger**, pas des choix assumés. Une entrée
corrigée quitte ce document (section « Entrées sorties » en bas), avec le commit et le test qui
la ferment.

**Nature de l'audit — à garder en tête à la reprise.** Revue de code **en lecture seule**
(quatre relectures parallèles : PostgreSQL/RLS, authentification des edge functions,
fichiers/requêtes sortantes/IA, front/CI/secrets). **Aucun test actif n'a été exécuté** : pas
d'environnement de staging identifié, et la base du projet Iris (`tqcoqlneybtbrrcvpkpk`) n'était
pas accessible. Chaque entrée porte donc un **statut de preuve** :

- **Relu** — le code en cause a été relu une seconde fois, ligne à ligne ;
- **Rapporté** — constat d'une seule relecture, à confirmer avant de corriger ;
- **À vérifier hors dépôt** — dépend d'un réglage de dashboard ou de l'état réel de la base.

**Bilan** : aucun constat Critical, aucune fuite de données entre tenants, aucun contournement
d'authentification, aucune injection SQL, aucun secret exposé. **3 High (S1–S3), 10 Medium (S4–S13), 29 Low (S14–S42).**

**Ordre de reprise conseillé** : S1 (un `drop policy`, coût nul) → S3 → S2 → S5 et S7 (deux
corrections d'une ligne) → S4 (en-têtes sans CSP d'abord) → le reste.

---

## High

### S1 — `requests` accepte encore une insertion directe depuis le navigateur

**Statut** : Relu. **Composant** : RLS, `supabase/migrations/20260822100700_policies_droits.sql:271-280`
(policy `requests_insert`, jamais retirée par une migration ultérieure).

**Scénario.** Un agent détenant un droit de **création** sur un couple du tenant écrit une
demande par l'API REST avec la clé publiable, en choisissant lui-même `procedure_snapshot`,
`requester_snapshot`, `consents`, `form_data`, `received_at`, `identity_status`,
`socle_contact_id`, `master_request_id`. La garde d'insertion `requests_before_insert_guard`
(t10) ne contrôle que `status` et `assigned_to`.

**Impact** — tous contraires à des invariants de `CLAUDE.md` :
1. **Consentements RGPD forgés puis figés** par `t10_requests_protect_immutable` : la trace
   probante devient falsifiable par celui qui saisit le dépôt.
2. **Garde des pièces obligatoires (t17) neutralisée** par un snapshot sans champ `attachment`
   obligatoire : « Résolue positivement » s'ouvre sans pièce conforme.
3. **`received_at` arbitraire**, immuable, recopié dans `request_stats` (jamais purgée) : délais
   et flux du tableau de bord falsifiables.
4. **Démarche en brouillon** : `requests_require_procedure` (t16) ne teste que
   `obsoleted_at is null`, jamais `status = 'production'` — la règle ne vit que dans l'edge
   function.
5. **t18 affaiblie** : `requests_require_procedure_active` lit `new.socle_root_org_id`, que le
   client fournit et que **t20** ne dérive qu'après (ordre alphabétique des triggers).
6. `master_request_id` peut pointer une demande d'un autre tenant (la FK ignore le RLS) — sans
   fuite de données.

**Cause racine.** La policy date d'avant la porte unique (`create-request-from-procedure` + RPC
`create_request_from_procedure`). Plus aucun code client ne l'utilise : aucun
`.from("requests").insert` dans `src/**` (vérifié).

**Correction.**
```sql
-- 1. Fermer le chemin, comme request_attachments le 2026-09-08.
drop policy if exists requests_insert on public.requests;
```
Défense en profondeur, à garder dans tous les cas :
- trigger `before insert` (p. ex. `t07_requests_reject_client_payload`) qui, hors
  `is_service_context()`, refuse `consents <> '[]'`, refuse `procedure_snapshot is not null` et
  force `received_at := now()` ;
- `and status = 'production'` dans le `select` du cache de `requests_require_procedure` (t16) ;
- dans `requests_require_procedure_active` (t18), **dériver** la racine
  (`select o.socle_org_id from public.organizations o where o.id = new.organization_id`) au lieu
  de lire `new.socle_root_org_id`.

**Test.**
```sql
-- 0 ligne attendue après correctif ('a' = INSERT)
select polname from pg_policy where polrelid = 'public.requests'::regclass and polcmd = 'a';
```
Et, dans une transaction annulée, sur le motif de `supabase/tests/fondations.test.sql` :
`set local role authenticated; set local request.jwt.claims = '{"sub":"<agent créateur>","role":"authenticated"}';`
puis `insert into public.requests (…)` ⇒ refus RLS attendu.

---

### S2 — Un administrateur de tenant rattache à son tenant n'importe quel compte de la plateforme

**Statut** : Relu. **Composants** : `supabase/functions/admin-users/index.ts:160-193` (branche
`if (existing)` d'`invite_user`) **et** la policy SQL `organization_members_insert`
(`20260820100000_identite_tenants_helpers.sql:225-235`). Les deux chemins sont à fermer.

**Scénario.** L'administrateur de la collectivité A appelle `invite_user` avec l'adresse d'un
agent de la collectivité B. Le code vérifie qu'il administre A (`isTenantAdmin`), jamais qu'il a
autorité sur le compte cible : la ligne `organization_members` est créée, sans consentement ni
notification. Côté SQL, le même administrateur peut insérer directement un `user_id` quelconque
(il lui faut l'UUID — c'est `admin-users` qui rend l'attaque praticable à partir d'un e-mail).

**Impact.**
1. **Données personnelles inter-tenant** : `users_select` = `shares_org_with` ⇒ A lit nom,
   e-mail, téléphones fixe et mobile, photo de l'agent de B ; la victime lit l'annuaire de A.
2. **Autorité acquise** : `can_manage_account(admin_A, victime)`
   (`20260823100100_administration_comptes_service.sql:41-53`) devient vrai ⇒
   `send_password_reset` à volonté vers la victime, via le relais SMTP et la charte de A (le
   jeton part bien chez la victime : pas de prise de contrôle directe, mais un primitif
   d'hameçonnage crédible).
3. **Énumération de comptes** : réponses distinctes (409 « Un compte existe déjà », 409 « déjà
   membre », 200 « rattaché », 201 compte neuf).

**Cause racine.** L'autorisation porte sur le tenant de destination, jamais sur le compte
source. `organization_members` est le seul point du modèle où l'appartenance se décrète sans
contrepartie.

**Correction.**
- `admin-users` : avant de rattacher un compte **existant**, exiger
  `can_manage_account(caller.id, existing.id)` — ou refuser si la cible est membre d'un autre
  tenant, un administrateur plateforme tranchant le reste ;
- réponses indifférenciées (motif déjà appliqué à `/mot-de-passe-oublie`) ;
- journaliser le rattachement d'un compte préexistant (aucune trace aujourd'hui) ;
- borner le débit d'`invite_user` / `send_password_reset` par appelant ;
- SQL : borner `organization_members_insert` aux comptes déjà co-membres du tenant (ou
  plateforme), ou passer l'appartenance par une RPC ; trigger interdisant de changer
  `user_id` / `organization_id` en `UPDATE`.

**Test.** Tenants A et B, agent `u_b` membre de B seul. (1) L'admin de A appelle
`invite_user {email: u_b.email, organization_id: A}` ⇒ **403**, aucune ligne dans
`organization_members`. (2) Même appel avec une adresse inconnue ⇒ même corps de réponse du point
de vue de l'appelant. (3) Sous la session de l'admin de A, `select * from users where id = u_b.id`
⇒ 0 ligne. À ajouter à `supabase/tests/fondations.test.sql` (l'étanchéité existante ne couvre
pas ce chemin).

Contrôle d'exploitation passée (membres sans profil ni activité) :
```sql
select m.organization_id, m.user_id, m.created_at
  from public.organization_members m
  left join public.permission_profile_assignments a
    on a.organization_id = m.organization_id and a.user_id = m.user_id
 where a.user_id is null;
```

---

### S3 — XSS stockée dans les infobulles des graphiques `/statistiques`

**Statut** : Relu (source et sink lus ; **chaîne non exécutée** — à confirmer par le contrôle
manuel ci-dessous avant de corriger).

**Chaîne.**
- Source : `src/features/account/useAccount.ts:160-163` — tout membre écrit librement
  `first_name` / `last_name` sur sa ligne (`identityPatch` ne fait que `trim()`).
- Transport : `stats_top_resolvers` / `stats_top_intervenants`
  (`20260918100000_statistiques.sql:490`, `:535`) renvoient
  `concat_ws(' ', u.first_name, u.last_name)` en `user_name`.
- Rendu : `src/features/stats/charts/TopAgentsChart.tsx:27` — `user_name` passé en
  `xaxis.categories`.
- Sink : `node_modules/apexcharts/src/modules/tooltip/Labels.js:281` —
  `ttCtx.tooltipTitle.innerHTML = xVal`. Les étiquettes d'axe passent par `textContent`
  (sûres) : seule l'**infobulle** est en cause.
- Même chaîne, source plus privilégiée (`organizations.name`, miroir Socle) :
  `ByOrganizationChart.tsx:22`, `ProcessingTimesChart.tsx:19`.

**Scénario.** Un agent ayant résolu au moins une demande met du HTML dans son nom depuis « Mon
compte » ; un collègue (typiquement un administrateur) ouvre `/statistiques` et survole la barre.

**Impact.** Exécution de script sur l'origine d'Iris. Le client Supabase est créé sans options
(`src/lib/supabase.ts:8`) ⇒ jetons d'accès et de rafraîchissement en `localStorage` : usurpation
complète de la victime, y compris d'un `is_platform_admin` (accès inter-tenant). Aucun CSP ne
limite l'exfiltration (S4).

**Correction** (cumulables) :
1. module pur `stats/labels.ts` qui neutralise `< > & "` dans `user_name` et `org_name`, appliqué
   dans les graphiques à catégories, avec son test ;
2. ou reprendre la main sur le rendu (`tooltip.custom` avec échappement explicite) ;
3. défense de fond : `check` SQL interdisant `<` dans `users.first_name` / `last_name`.

⚠️ Monter `apexcharts` de version **ne corrige pas** : le `innerHTML` est toujours là en 4.x/5.x.

**Test.** Unitaire : `sanitizeChartLabel("<b>x</b>")` ne contient plus `<`. Manuel : poser un nom
contenant `<b>x</b>`, ouvrir `/statistiques`, survoler — les balises s'affichent **en texte**.

---

## Medium

### S4 — Aucun en-tête de sécurité (pas de `public/_headers`, pas de CSP, pas de `frame-ancestors`)

**Statut** : Relu (`public/` ne contient que `favicon.svg`, `icons/`, `manifest.webmanifest`,
`sw.js` ; `wrangler.jsonc` ne déclare que les assets).

**Scénario.** (a) Clickjacking : l'application est encadrable, un site tiers fait cliquer un
agent sur « Résoudre positivement » ou « Transférer ». (b) Toute XSS (S3, S5) s'exécute et
exfiltre sans contrainte de `connect-src`.

**Correction.** Créer `public/_headers` (Vite le recopie dans `dist/`, Cloudflare l'applique).
Commencer par ce qui est sans risque de régression, puis ajouter la CSP en observant les
violations :
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://tqcoqlneybtbrrcvpkpk.supabase.co https://data.geopf.fr; worker-src 'self'
```
⚠️ Contraintes réelles : `camera=(self)` (photos d'intervention) et `geolocation=(self)`
(« Utiliser ma position ») sont **nécessaires** ; `style-src 'unsafe-inline'` est imposé par
ApexCharts et Redoc ; tant que `/api-doc` charge Redoc depuis jsDelivr (S12), il faut
`https://cdn.jsdelivr.net` en `script-src`. La liste `connect-src` est un point de départ à
vérifier (tuiles, géocodeur, realtime `wss:`).

**Test.** `curl -I` sur l'application montre les en-têtes ; une page tierce avec
`<iframe src="…iris…">` reste blanche ; caméra et géolocalisation fonctionnent sur mobile ;
aucune violation CSP en parcourant liste, fiche, carte, statistiques, `/api-doc`.

### S5 — Lien `javascript:` cliquable dans « Liens utiles » d'une démarche (`agentLinks`)

**Statut** : Relu. `src/features/requests/procedure/ProcedurePane.tsx:258` et
`FicheSections.tsx:410` font `href={link.url}` sans filtre ;
`supabase/functions/socle-proxy/_shared/knowledge.ts:117-128` (`parseLinks`) ne contrôle pas le
schéma. React 18 rend un `href="javascript:…"`.

**Scénario.** Quelqu'un qui édite la base de connaissances d'une démarche dans le Socle pose un
lien `javascript:` sous un libellé crédible ; l'agent qui clique exécute le script (même impact
que S3). Medium : l'attaquant est déjà privilégié dans une application sœur, et il faut un clic.

**Correction.** Appliquer `safeHref` (`src/lib/markdown.ts:50-59`) ou `safeSourceHref`
(`src/features/knowledge/guidance.ts:29`) — **ils existent déjà** — aux deux sites de rendu
(lien non sûr ⇒ carte inerte, motif de `AgentGuidanceContent.tsx:127-139`), **et** rejeter tout
ce qui n'est pas `http(s):` dans `parseLinks`.

**Test.** Unitaire sur `parseLinks` : `{ url: "javascript:alert(1)" }` ⇒ écarté. Rendu : une
démarche portant ce lien affiche une carte inerte, jamais un `<a href>`.

### S6 — Un intervenant sollicité lit TOUTES les pièces de la demande

**Statut** : Relu (`can_read_request`). **Décision PO requise avant le code.**

`20260911100100_pieces_policies_serveur.sql:90-95` (policy storage) et
`20260822100700_policies_droits.sql:407-410` (`request_attachments_select`, aucune condition sur
`kind`) s'appuient sur `can_read_request` = consultation **ou** sollicitation
(`20260914100000_interventions.sql:209-214`), alors que `request_messages` et `request_emails`
sont fermés à l'intervenant (`can_consult_request`, `:221-229`).

**Scénario.** Un agent porteur du seul attribut `is_intervenant`, sollicité sur une demande,
signe une URL pour chaque objet du préfixe : il obtient les documents `instruction_interne` et
les pièces jointes des échanges — les deux matières que le modèle lui ferme par ailleurs.

**Correction.** Pour les pièces, distinguer ce qui suit la demande de ce qui suit
l'instruction : soit `can_consult_request` exigé dès que `kind = 'instruction_interne'` ou
`email_id is not null`, soit (plus robuste) un préfixe de stockage distinct pour ces deux
natures. **À trancher** : l'intervenant doit-il voir les justificatifs de l'usager ? (Aujourd'hui
oui ; ce n'est écrit nulle part.)

**Test.** Scénario transactionnel dans `supabase/tests/` : demande avec une pièce
`instruction_interne`, une pièce d'échange, une pièce `demande` ; utilisateur `is_intervenant`
seul, sollicité. `select` sur `request_attachments` et sur `storage.objects` ne rend que
l'autorisé.

### S7 — L'objet de la demande part chez le fournisseur IA sans caviardage

**Statut** : Relu. `supabase/functions/_shared/ai/context.ts:234` — `subject: row.subject`
brut, alors que `description` (`:235`) et `closure` (`:241`) passent par `redactValue`. L'objet
entre tel quel dans le prompt (`_shared/ai/prompt.ts:190`).

**Impact.** Un courriel ou un téléphone dans l'objet (cas courant à l'ingestion Clara ou
partenaire) sort en clair, contrairement à la promesse de `docs/assistant-ia.md` §2.

**Correction.** `subject: redactValue(row.subject).value`.
**Test.** Dans `context.test.ts`, le jumeau du cas existant sur la description : « un courriel
dans l'objet ne sort pas ».

### S8 — `requests-api` : `socle_contact_id` du partenaire jamais confronté au périmètre du tenant

**Statut** : Rapporté. `supabase/functions/requests-api/index.ts:129-138` (`resolveRequester`)
et `_shared/validation.ts:180-186` (forme UUID seule). C'est la seule référence de l'enveloppe
crue sur parole.

**Impact.** Mauvaise attribution : la demande est marquée `rapprochee` sur la fiche d'un tiers,
`send-request-email` écrit à cette personne, et le consentement RGPD du dépôt s'écrit sur SA
fiche Socle. Pas de divulgation (la réponse partenaire ne renvoie pas la fiche).

**Correction.** Relire la fiche via `contacts-api` avec `X-Organization-Id = auth.socleRootOrgId`
(`socleContactsFetch` existe) ; hors périmètre ⇒ non rapprochée + anomalie
`usager_a_creer_dans_socle`, jamais un refus.
**Test.** Dépôt avec un `socle_contact_id` d'une autre collectivité ⇒
`identity_status = 'non_rapprochee'`, `socle_contact_id` nul, aucun
`POST /v1/contacts/{id}/consents`.

### S9 — `requests-api` : ni quota par clé ni plafond de corps ; quota d'uploads contournable

**Statut** : Rapporté. `requests-api/index.ts:823-824` (`POST /v1/requests` sans borne), `:508`
(`req.json()` sans plafond), `:294-308` (`recentUploads` : compte des lignes de journal écrites
**après** la réponse ⇒ N requêtes concurrentes passent ensemble, et ne compte que les
`status = 201`). `docs/architecture-proposee.md` (R-H1, §8.1) annonce un quota par clé
*obligatoire* ; seule l'idempotence est livrée, et ce n'est pas dans `dette-technique.md`.

**Impact.** Une clé compromise ou un connecteur en boucle inonde un tenant de demandes **non
supprimables** (invariant produit).

**Correction.** Compteur atomique en base (RPC qui incrémente et refuse dans la même
transaction) sur `/v1/requests` comme sur `/v1/uploads`, toutes issues comptées ; 413 sur
`content-length` avant `req.json()`.
**Test.** 100 `POST /v1/uploads` en parallèle ⇒ au plus 60 réponses 201 ; 60 envois refusés puis
un valide ⇒ 429 ; 200 `POST /v1/requests` en une minute ⇒ 429 au-delà du quota.

### S10 — Le lien de réinitialisation dépend d'une liste blanche hors dépôt

**Statut** : À vérifier hors dépôt (le code est correct).
`supabase/functions/auth-email-hook/index.ts:60-72` accroche `token_hash` au `redirect_to` validé
par GoTrue contre *Authentication › URL Configuration › Redirect URLs*. **Si cette liste
contenait un joker**, n'importe qui pourrait déclencher pour un agent un e-mail légitime dont le
lien porte le jeton vers un hôte tiers — prise de contrôle de compte. `docs/emails.md:163-175`
documente quatre entrées exactes.

**À faire.** (a) Vérifier le réglage réel du dashboard et le figer ; (b) défense en profondeur
dans le hook : n'accepter `redirect_to` que si son origine appartient à une liste close dérivée
de `IRIS_APP_URL`, sinon retomber sur `/auth/v1/verify` (le repli existe ligne 71) ; (c) retirer
`http://localhost:5174/...` de la liste de **production**.
**Test.** `resetPasswordForEmail` avec un `redirectTo` hors origine, puis avec un préfixe
trompeur (`https://<domaine-iris>.exemple.tld/`) ⇒ aucun `token_hash` hors des origines Iris dans
le message reçu.

### S11 — Bombe zip possible sur un modèle Word

**Statut** : Rapporté. `supabase/functions/_shared/document/docxZip.ts:14-16` — `unzipSync` sans
filtre ni plafond ; `generate-request-document/index.ts:273-290` ne borne que l'archive
compressée (10 Mo). Le bon filtre **existe déjà** : `_shared/ai/sources/officeText.ts:241-264`
(8 Mo/entrée, 24 Mo cumulés, ratio ≤ 200).

**Prérequis.** Pouvoir téléverser un modèle dans le Socle (administrateur de collectivité).
Impact : disponibilité de la fonction seulement.
**Correction.** Même filtre dans `openDocx` ; lecture du corps sous plafond (`readCapped`,
`_shared/ai/sources/read.ts:95-121`).
**Test.** Vitest sur `openDocx` avec une entrée déclarant une taille absurde ⇒ refus.

### S12 — Redoc chargé depuis jsDelivr sans SRI sur `/api-doc`

**Statut** : Rapporté. `src/features/public-api-docs/ApiDocsPage.tsx:20` et `:79-84` (script
injecté sans `integrity` ni `crossorigin`). Route publique, mais même origine que la session
d'un agent connecté.

**Correction.** De préférence, `redoc` en dépendance npm servi depuis l'origine
(`script-src 'self'` suffit alors) ; à défaut, `integrity` + `crossOrigin = "anonymous"` sur la
version figée.
**Test.** `/api-doc` se rend sans requête vers un domaine tiers ; un `integrity` altéré déclenche
le repli déjà écrit (`ApiDocsPage.tsx:94-106`).

### S13 — Politique de mot de passe faible, non versionnée ; pas de MFA

**Statut** : Relu côté front ; **à vérifier hors dépôt** pour le dashboard.
`src/features/auth/SetPasswordPage.tsx:28` (`MIN_LENGTH = 8`, contrôle d'écran),
`src/features/account/account.ts:133` ; `supabase/config.toml` n'a **aucune section `[auth]`**
(défaut GoTrue : 6 caractères, pas de protection contre les mots de passe compromis).

**Correction.** Dashboard : longueur ≥ 12, « Prevent use of leaked passwords », MFA (TOTP) au
moins pour `is_platform_admin`. Aligner les constantes du front, le dire dans
`docs/demarrage.md`, et déclarer `[auth]` dans `config.toml` pour que le réglage soit relisible.
**Test.** `Password1` refusé **par le serveur** ; un mot de passe connu comme compromis refusé ;
second facteur réclamé à un administrateur plateforme.

---

## Low

Tous **Rapportés** sauf mention. Aucun n'est exploitable seul.

### Edge functions

- **S14 — `http://localhost:5174` en dur dans l'allowlist CORS de production** : `admin-users:37-39`,
  `socle-proxy:59-61`, `create-request-from-procedure:36-38`, `request-attachments:52-54`,
  `send-request-email:67-69`, `generate-request-document:63-65`, `request-assistant:105-107`,
  `sync-socle-referentiel:35-37`. → Conditionner à une variable `IRIS_DEV_ORIGINS` absente en
  production. *Test* : `OPTIONS` avec cette origine en production ⇒ aucun
  `Access-Control-Allow-Origin`.
- **S15 — Huit copies du même helper CORS** (identiques et correctes aujourd'hui ; risque de
  dérive). → `_shared/http/cors.ts`, pur et testé. À traiter avec S14.
- **S16 — Comparaison non constante du secret cron** : `notifications-mailer:99`,
  `notifications-push:83`, `attachments-maintenance:142`, `sync-socle-referentiel:82`. Le *fail
  closed* est correct partout. → Comparaison à temps constant sur les octets, après égalisation
  de longueur.
- **S17 — Pas d'anti-rejeu applicatif sur le hook GoTrue** (`auth-email-hook:103-107`) : la
  signature et la tolérance d'horodatage sont vérifiées, `webhook-id` n'est pas dédupliqué. →
  Table des `webhook-id` vus, TTL 10 min. Impact : nuisance (le jeton reste à usage unique).
- **S18 — Messages d'erreur internes relayés** : `create-request-from-procedure:397`
  (`rpcError.message` brut), `requests-api:448`. Contraire à `architecture-proposee.md:798-801`.
  → Message générique + `console.error`. *Test* : provoquer une violation de contrainte ⇒ aucun
  nom de table, colonne ou contrainte dans la réponse.
- **S19 — Adresses e-mail et chemins d'objets dans les journaux** : `admin-users:281`, `:345`,
  `auth-email-hook:169`, `attachments-maintenance:148` (chemins portant des noms de fichiers
  d'usagers) — alors que `send-request-email` et `notifications-mailer` s'interdisent
  explicitement de le faire. Incohérence à trancher.
- **S20 — `request_id` choisi par le navigateur avant que la demande existe**
  (`create-request-from-procedure/index.ts:339-354`, insert en `:369`) : un agent peut déposer
  un objet sous le préfixe de la demande d'un collègue. Aucune lecture de données d'autrui,
  objet invisible à l'écran, évacué par `?mode=reconcile`. → Déplacer les objets **après** la
  RPC, ou générer `request_id` côté serveur. *Test* : rejouer avec un `request_id` existant ⇒
  409, aucun objet neuf sous ce préfixe.
- **S21 — Contrôle de configuration avant authentification** : `socle-proxy:177-185`,
  `create-request-from-procedure:125-131`, `sync-socle-referentiel:217` répondent 503 « Secrets
  manquants : … » à un appelant non authentifié. → Authentifier d'abord (comme
  `request-assistant:297-338`).
- **S22 — `GET /v1/openapi.json` reflète `X-Forwarded-Host`** dans `servers[].url`
  (`requests-api/index.ts:794-800`, `_shared/openapi.ts:19-28`). → Base fixe issue d'un secret.

### Fichiers, requêtes sortantes, e-mails, IA

- **S23 — Plafond de taille contournable sans `Content-Length`**
  (`_shared/files/multipart.ts:46-53`) : en `chunked`, la pré-garde est sautée et le corps entier
  est bufferisé. Appelant authentifié. → Lire le corps sous plafond (`readCapped`) ou refuser
  l'absence de `Content-Length`. *Test* : `Request` sans `content-length`, corps > `maxBytes` ⇒
  `payload_too_large`.
- **S24 — Aucune borne de dépôt côté navigateur** (`request-attachments/index.ts:150`). → Même
  compteur d'une minute que côté partenaire, sur `attachment_uploads`. À traiter avec S9.
- **S25 — Requête sortante aveugle via l'endpoint Web Push**
  (`20260915100000_notifications_push.sql:98` : seule garde `^https://`) : un agent enregistre
  n'importe quelle URL `https` comme appareil. Impact faible (aveugle, corps chiffré, 443). →
  Liste blanche des services de push connus, ou a minima réutiliser
  `_shared/ai/sources/urlGuard.ts`. *Test* : `register_push_subscription` avec une IP littérale
  ou un hôte interne ⇒ exception.
- **S26 — Nom de fichier d'affichage conservé brut** (`_shared/files/inspect.ts:48-51`) :
  caractères de contrôle et marques bidi. Le **chemin**, lui, est sûr. → Retirer `\p{C}` et les
  marques bidi à l'inspection.
- **S27 — Retours à la ligne dans le sujet d'e-mail venu du navigateur**
  (`send-request-email/index.ts:305`) : injection d'en-tête **non démontrée** (nodemailer encode),
  à neutraliser quand même. → `subject.replace(/[\r\n]+/g, " ").slice(0, 200)`, idem pour le
  `heading` de `_shared/email/usager.ts`.
- **S28 — Lien vers une origine déclarée : la query string survit dans une réponse de
  l'assistant** (`_shared/ai/links.ts:88`), et `:41` accepte les origines `http:`. → Retirer
  `?`/`#` hors URL déclarée ; exclure `http:` de `allowedLinkOrigins`.
- **S29 — Détection des macros Office par le NOM de la partie VBA** (`_shared/files/magic.ts:214`).
  Pas d'exploitation identifiée. → Lire `[Content_Types].xml` et refuser tout type
  `*macroEnabled*`. Sans urgence.
- **S30 — `parseClientHistory` valide avant de borner** (`_shared/ai/messages.ts:46-83`). →
  Refuser d'emblée `raw.length > 100`.

### PostgreSQL

- **S31 — `integration_deliveries` lisible par tout membre du tenant, sans filtre par couple**
  (`20260820100200_requests_satellites.sql:338-340`). Impact nul aujourd'hui (outbox non
  branchée). → Aligner sur les satellites (`exists (select 1 from public.requests r where r.id = …)`)
  **avant** la phase 4.
- **S32 — Policies `avatars` : cast `::uuid` non protégé**
  (`20260824120000_compte_utilisateur.sql:43-72`) : un objet au premier segment non-UUID fait
  lever `22P02` ⇒ panne de lecture des photos, pas une fuite. → `public.uuid_or_null()`.
- **S33 — `request_exists(uuid)` : oracle d'existence sans appelant**
  (`20260822100200_requests_scope_org.sql:269-276`). → Révoquer de `authenticated`.
- **S34 — `is_intervenant` et `knowledge_base_access` hors du contrôle de non-escalade**
  (`assert_editor_can_manage_profile`, `20260822100400_profils_droits_rpc.sql:79-117`). Sans
  effet sur les données aujourd'hui — à reprendre le jour où l'un d'eux ouvre une donnée.
- **S35 — Aucune table en `FORCE ROW LEVEL SECURITY`** : toute fonction `SECURITY DEFINER`
  propriété de `postgres` contourne le RLS. Modèle Supabase habituel, et chaque RPC relue porte
  sa garde. → **Inscrire dans `CLAUDE.md` § Pièges connus** : « une nouvelle RPC `DEFINER`
  accordée à `authenticated` doit porter sa garde elle-même — le RLS ne la rattrapera pas ».
- **S36 — Deux RPC de service font confiance à leurs paramètres** :
  `create_request_from_procedure(p jsonb)` et `start_request_email(...)` — la garde vit dans
  l'edge function, les RPC sont révoquées de `authenticated`. Rien d'exploitable ; défense en
  profondeur.

### Front, CI, poste de développement

- **S37 — CI sans bloc `permissions:`, actions sur tags mutables**
  (`.github/workflows/ci.yml`). Par ailleurs sain (`pull_request`, aucun secret, aucune
  interpolation d'événement). → `permissions: contents: read`, épinglage par SHA, Dependabot.
- **S38 — Export CSV sans garde contre les formules** (`src/lib/csv.ts:8-14`) ; consommateurs :
  annuaire des usagers, liste des demandes. → Préfixer toute valeur commençant par
  `= + - @ \t \r`. *Test* dans `src/lib/csv.test.ts`.
- **S39 — Polices chargées depuis `fonts.googleapis.com`** (`src/index.css:10`) : IP et
  `User-Agent` de chaque agent partent chez Google. → Auto-héberger Nunito Sans (la CSP de S4 se
  resserre d'autant).
- **S40 — Brouillon de création en `localStorage`, sans expiration ni purge à la déconnexion**
  (`src/features/requests/creation/draft.ts:23-37`, `useCreationDraft.ts:38-47`) : identité
  **déclarée** de l'usager, objet, corps, réponses. ⚠️ Le commentaire d'en-tête « Rien de
  sensible n'y transite » est **faux** pour la branche `sans_rapprochement`. → Effacer
  `iris.draft.*` dans `signOut` (`AuthProvider.tsx:79-84`), TTL (p. ex. 7 jours, `savedAt` est
  là), corriger le commentaire.
- **S41 — `external_url` et `origin.url` en `href` sans filtre**
  (`src/features/requests/instruction/ResumePane.tsx:131`, `:146`). Non exploitable aujourd'hui
  (validés `^https?://` à l'ingestion). → `safeHref`, à traiter avec S5.
- **S42 — `.secrets/VAPID_PRIVATE_KEY.txt` en clair sur le poste** (ignoré par git). Ne donne
  accès à aucune donnée (spam de notification au pire). → La détruire, comme l'ont été
  `SOCLE_API_KEY.txt` et `CRON_SECRET.txt` ; noter dans `demarrage.md` que la rotation invalide
  tous les abonnements.

---

## À confirmer par le relecteur RLS

- La policy de `request_links` sur `created_by` (fourni par le client,
  `src/features/requests/useRequests.ts:535`) n'a pas été lue. `request_messages_insert`, elle,
  impose bien `author_id = auth.uid()`.

## Risques résiduels jugés acceptables

Consignés pour ne pas les redécouvrir — ce ne sont pas des entrées à traiter.

- **Jeton de session en `localStorage`** (défaut supabase-js) : acceptable **à condition** que
  S3, S5, S12 soient traités et qu'une CSP existe (S4).
- **Isolation portée par le code pour tout ce qui passe en `service_role`** : déjà assumé
  (`architecture-proposee.md:823-826`). La compensation est en place pour les demandes ; elle
  manquait pour l'appartenance (S2).
- **Injection de prompt** : bornée (bloc délimité, `sanitizeBlock`, aucun outil à effet,
  politique de liens), jamais éliminée — assumé dans `assistant-ia.md` §2.
- **DNS rebinding sur les sources IA** : `Deno.resolveDns` absent du runtime edge ; documenté en
  tête de `_shared/ai/sources/read.ts`.
- **Pas d'antivirus** (décision PO 2026-09-08) : la liste fermée est la défense, et elle est
  bien appliquée.
- **Confiance dans le référentiel Socle** (libellés, base de connaissances, relais SMTP,
  modèles Word) : invariant d'architecture. S5 et S11 ferment les vecteurs d'exécution.
- **Pas de verrouillage de session par inactivité** : relève de la politique de poste.
- **`register_push_subscription` permet la reprise d'un endpoint** : délibéré (poste partagé).

## Ce que l'audit a trouvé solide

Pour mémoire, et pour ne pas le casser : RLS activé sur les 30 tables + event trigger
`rls_auto_enable` ; aucune policy `USING (true)` cliente, `TO` explicite partout ; `search_path`
fixé sur toutes les `SECURITY DEFINER` ; aucun SQL dynamique avec entrée utilisateur ; aucune
vue ; secrets de `pg_cron` lus dans le Vault ; clés d'intégration hachées, périmètre dérivé de
la clé (pas d'IDOR partenaire) ; JWT réellement validé (`auth.getUser`) dans les 13 fonctions,
aucune route ni méthode hors garde ; secret cron et hook *fail closed* ; CORS en liste close ;
porte unique des fichiers et zone d'attente (`consume_attachment_upload` revérifie tout) ;
`socle-proxy` en liste fermée de routes ; `urlGuard.ts` ; gabarits d'e-mail et fusion Word
échappés ; aucun `dangerouslySetInnerHTML` ni `console.*` dans `src/` ; Markdown maison sûr par
construction ; service worker sans cache ; sélecteur de tenant *fail closed* ; non-escalade des
profils de droits ; `20260921100000_premier_administrateur_tenant_neuf.sql` correct ;
`20260916100000_permaliens_partenaires_publics.sql` ne rend rien public (réparation de données).

---

## Requêtes de contrôle en lecture seule

À exécuter sur la base Iris pour confirmer l'état **réel** (l'audit n'a lu que les migrations).

```sql
-- 1. RLS activé / forcé sur toutes les tables de public
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relrowsecurity, c.relname;
-- Attendu : rls_enabled = true partout ; rls_forced = false partout (cf. S35).

-- 2. Tables sans AUCUNE policy (fermées — à confirmer voulu)
select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
   and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
 order by 1;

-- 3. Inventaire complet des policies
select schemaname, tablename, policyname, roles, cmd, qual, with_check
  from pg_policies
 where schemaname in ('public','storage')
 order by schemaname, tablename, cmd, policyname;

-- 4. Policies dangereuses : true hors service_role, ou rôle public
select tablename, policyname, roles, cmd, qual, with_check
  from pg_policies
 where schemaname in ('public','storage')
   and ( ( (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true')
           and not (roles::text[] @> array['service_role']) )
         or roles::text = '{public}' )
 order by tablename;
-- Attendu : 0 ligne.

-- 5. Policies UPDATE sans WITH CHECK
select tablename, policyname, roles, qual, with_check
  from pg_policies
 where schemaname in ('public','storage') and cmd = 'UPDATE' and with_check is null
 order by tablename;

-- 6. SECURITY DEFINER sans search_path figé
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and (p.proconfig is null or not (p.proconfig::text like '%search_path%'))
 order by 2;
-- Attendu : 0 ligne.

-- 7. Fonctions exécutables par anon / authenticated
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as definer,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 order by anon desc, auth desc, p.proname;
-- Attendu : anon = true seulement pour immutable_unaccent / request_search_text.
-- auth = false pour : *_trigger, claim_*, settle_*, skip_*, rebuild_*, sync_*, ingest_*,
-- consume_*, purge_*, start_request_email, create_request_from_procedure,
-- permission_pairs_of, request_scope_org, request_right_for, has_*_for.

-- 8. Privilèges de table accordés à anon / authenticated
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated')
 group by 1,2 order by 1,2;
-- requests : INSERT présent ? (S1) ; smtp_settings : doit être absent.

-- 9. Buckets : aucun public
select id, public, file_size_limit, allowed_mime_types from storage.buckets;

-- 10. Vues : aucune ; sinon security_invoker = true
select c.relname, c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('v','m');

-- 11. Ordre des triggers de requests (S1 point 5 : t18 avant t20)
select tgname, pg_get_triggerdef(oid)
  from pg_trigger where tgrelid = 'public.requests'::regclass and not tgisinternal
 order by tgname;

-- 12. pg_cron : aucun secret littéral dans une commande planifiée
select jobid, jobname, schedule, command from cron.job order by jobname;
```

S'y ajoutent les **advisors de sécurité Supabase** du projet (dashboard › Advisors), non
consultés pendant l'audit.

## Pour reprendre avec des tests actifs

L'audit s'est arrêté à la lecture. Pour aller plus loin il faut : un **environnement de
staging** pour Iris (URL et projet Supabase distincts de la production), **deux comptes de test
dans deux tenants fictifs** (vérification d'étanchéité sans donnée réelle), et un accès en
lecture à la base de ce staging.

## Entrées sorties de ce document

*(aucune pour l'instant)*
