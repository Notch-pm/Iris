# Emails — Iris

> **Public** : développeuses et développeurs, et l'administrateur qui met un tenant en
> service · **Question traitée** : par où partent les mails d'Iris, avec quel gabarit, et que
> faut-il configurer pour qu'ils partent ? · **Dernière mise à jour** : 2026-08-23

Iris envoie aujourd'hui **deux messages**, tous deux liés au compte agent :

| Message | Déclencheur | Chemin d'envoi |
|---|---|---|
| **Réinitialisation de mot de passe** | l'agent depuis `/mot-de-passe-oublie` (self-service) | GoTrue → hook `auth-email-hook` |
| **Réinitialisation de mot de passe** | un administrateur ayant autorité sur le compte, bouton « lien de réinitialisation » | edge function `admin-users` (`send_password_reset`) |
| **Activation de compte (invitation)** | un administrateur qui invite un agent | edge function `admin-users` (`invite_user`) |

Les notifications métier (affectation, changement de statut…) viendront ensuite : elles
réutiliseront le gabarit et le serveur d'envoi décrits ici.

## 1. Le gabarit

`supabase/functions/_shared/email/` — **modules purs, testés par vitest** (le rendu ne
dépend d'aucun runtime), plus un module d'envoi qui, lui, dépend de Deno :

| Module | Rôle |
|---|---|
| `template.ts` | Rend le HTML et la version texte. Carte centrée 520 px, bandeau de marque, bouton, lien de repli, pied — **reprise du gabarit Clara**, rhabillée aux tokens du DS Ariane. |
| `messages.ts` | Catalogue des textes, en français, un objet par type d'email. |
| `config.ts` | Résolution du serveur d'envoi : tenant d'abord, relais de plateforme en repli. |
| `transport.ts` | `nodemailer` — la seule brique qui parle au réseau. |

Trois règles portées par le gabarit :

- **Couleurs en hexadécimal, styles inline.** Un client de messagerie ne lit ni `hsl()`, ni
  les variables CSS, ni un `<style>` externe. Les valeurs de `EMAIL_COLORS` sont les tokens de
  `src/index.css` convertis une fois pour toutes — à retoucher **ensemble**.
- **Tout est échappé.** Le nom du tenant vient du Socle, le nom du destinataire de la base :
  ce sont des données, jamais du HTML. Une URL d'action non `http(s)` est neutralisée en `#`.
- **Toujours une version `text/plain`.** Un message sans partie texte part au spam.

Différence assumée avec Clara : la vérification du certificat TLS du relais **n'est pas
désactivée**. Clara pose `rejectUnauthorized: false`, ce qui fait du TLS une décoration. Ici
un relais à certificat auto-signé échoue franchement, et le message d'erreur remonte dans les
journaux de la fonction (`supabase functions logs admin-users`).

## 2. Le serveur d'envoi

### La source de vérité est le **Socle**, pas Iris

Le relais de messagerie d'une collectivité est défini **une seule fois pour toute la gamme**,
dans le Socle, sur l'**organisation principale** (page de l'organisation → onglet « Emails
(SMTP) », visible sur la seule racine). **Iris n'offre aucune saisie** — décision PO du
2026-08-23 : l'invariant « Socle est la source de vérité » vaut ici comme pour les
organisations et les démarches, et une collectivité n'a pas à ressaisir ses identifiants dans
chaque application. C'est ce qui distingue Iris de Clara, qui porte encore sa propre table
`smtp_settings` alimentée par un écran à elle.

`public.smtp_settings` (Iris) est donc un **miroir**, rafraîchi comme les autres miroirs
Socle — par `sync-socle-referentiel`, c'est-à-dire chaque nuit à 4 h UTC et à chaque
« Synchroniser maintenant » (Paramètres › Référentiel, ou zone superadmin).

```
Socle · organisation principale        Iris
┌──────────────────────────┐          ┌──────────────────────────────┐
│ smtp_settings (racine)   │  HTTP    │ smtp_settings (miroir)       │
│ hôte, port, identifiant, │ ───────► │ hôte, port, identifiant,     │
│ mot de passe EN CLAIR    │  sync    │ expéditeur, TLS              │
│ expéditeur, TLS          │          │ + mot de passe au **Vault**  │
└──────────────────────────┘          └──────────────────────────────┘
   onglet « Emails (SMTP) »              aucune saisie, aucun écran
```

Un tenant Iris **est** une organisation racine Socle : le miroir a pour clé primaire
`organization_id`, donc **une ligne par tenant, pas davantage**, et elle vaut pour tout le
sous-arbre — `mail_context_for_user` remonte du destinataire à son tenant par
`organization_members` et lit cette unique ligne. Un agent de la Voirie, du CCAS ou d'une
antenne reçoit ses mails par le serveur de la collectivité, sans rien à répéter.

**Ce qui circule, et ce qui n'en sort pas.** La route Socle
`GET /v1/organizations/{id}/smtp` est la **seule** de son API publique à servir un secret ;
elle est gardée trois fois : scope **`smtp`** explicite sur la clé API (le scope `read` du
référentiel ne suffit pas), organisation dans le périmètre de la clé, et **racine uniquement**.
Côté Iris, le mot de passe passe de la réponse HTTP à la RPC de service, qui le range au
**Vault Postgres** (`vault.create_secret`, chiffré au repos) : la table n'en garde que
`password_secret_id`. Iris ne réplique donc pas la dette « mot de passe SMTP en clair » que
Socle et Clara portent encore dans une colonne.

**Miroir strict.** Ce que le Socle déclare fait foi, y compris l'absence : un mot de passe
retiré côté Socle supprime le secret Vault ; un relais supprimé ou incomplet (hôte ou adresse
d'expédition manquants) **efface la ligne**, et l'envoi retombe sur le relais de plateforme. Un
miroir qui survit à sa source ment.

**Surface d'écriture et de lecture.** Aucune. La table n'a ni policy ni grant pour
`authenticated` : deux RPC de **service** l'écrivent
(`sync_smtp_settings_from_socle`, `clear_smtp_settings_from_socle`, révoquées de `anon` et
`authenticated`), et deux fonctions de **service** la lisent en déchiffrant :

- `smtp_config_for_org(p_org_id)` — la configuration d'un tenant ;
- `mail_context_for_user(p_user_id)` — le tenant d'un destinataire **et** sa configuration,
  en un aller. Un compte membre de plusieurs tenants retient celui qui a un serveur configuré.

**Prérequis de mise en service** : la clé Socle d'Iris (`SOCLE_API_KEY`) doit porter le scope
`smtp`. Sans lui, la synchronisation réussit mais journalise l'avertissement « la clé Socle ne
porte pas le scope « smtp » » dans `sync_runs.counters.warnings`, et le miroir reste vide —
donc les mails partent par le relais de plateforme, ou pas du tout.

### Repli — relais de plateforme

Si le Socle ne déclare aucun relais pour l'organisation principale du tenant (ou si le
destinataire n'appartient à aucun tenant), l'envoi retombe sur les secrets d'edge function :

| Secret | Obligatoire | Défaut |
|---|---|---|
| `IRIS_SMTP_HOST` | oui (sinon pas de repli) | — |
| `IRIS_SMTP_FROM_EMAIL` | oui (sinon pas de repli) | — |
| `IRIS_SMTP_PORT` | non | `587` |
| `IRIS_SMTP_USERNAME` | non | aucune authentification |
| `IRIS_SMTP_PASSWORD` | non | — |
| `IRIS_SMTP_FROM_NAME` | non | adresse seule |
| `IRIS_SMTP_USE_TLS` | non | `true` |

Sans relais déclaré dans le Socle **ni** relais de plateforme, **aucun mail ne part** — et ça
se voit : l'invitation répond `email_sent: false` avec le motif, le hook répond 503.

`secure` (TLS implicite) n'est activé que sur le **port 465**. Sur 587 la connexion démarre en
clair puis passe en TLS par STARTTLS ; y forcer `secure` casse la poignée de main.

## 3. Le hook « Send Email » de GoTrue

`auth-email-hook` habille **tous** les mails émis par GoTrue lui-même. Le seul parcours qui en
dépend aujourd'hui est le **mot de passe oublié self-service** — les gestes d'administrateur,
eux, produisent le lien avec `generateLink` et expédient directement, sans dépendre du hook.

⚠️ **Activation manuelle, une fois par projet** (Dashboard Supabase → *Authentication* →
*Hooks* → *Send Email hook*) :

1. Activer le hook, type **HTTPS**, URL de la fonction :
   `https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/auth-email-hook`
2. Copier le **secret généré** (`v1,whsec_…`) et le poser en secret d'edge function :
   `AUTH_HOOK_SECRET`. La fonction retire le préfixe `v1,whsec_` elle-même.

Tant que le hook n'est pas activé, GoTrue envoie **ses propres** messages, en anglais, par son
relais de démonstration (bridé à quelques envois par heure) : le parcours « mot de passe
oublié » semble marcher en développement et échoue en production.

L'authentification du hook est la **signature Standard Webhooks** vérifiée dans le code
(`verify_jwt = false` : GoTrue n'envoie pas de JWT). Sans `AUTH_HOOK_SECRET`, la fonction
répond 503 et ne devine rien.

### URL de redirection à autoriser

Dashboard → *Authentication* → *URL Configuration* → *Redirect URLs* :

```
http://localhost:5174/nouveau-mot-de-passe
http://localhost:5174/activer-compte
<URL de prod>/nouveau-mot-de-passe
<URL de prod>/activer-compte
```

GoTrue refuse un `redirect_to` hors liste et retombe sur le *Site URL* — le lien mènerait
alors à la page d'accueil, sans jeton.

## 4. Les parcours

### Mot de passe oublié (self-service)

`/mot-de-passe-oublie` → `supabase.auth.resetPasswordForEmail(email, { redirectTo: …/nouveau-mot-de-passe })`
→ GoTrue → hook → mail brandé → `/nouveau-mot-de-passe?token_hash=…&type=recovery`.

L'écran répond **toujours la même chose**, que le compte existe ou non : il est public, il ne
doit pas devenir un annuaire d'adresses valides.

### Invitation d'un nouveau compte

Deux portes, une seule implémentation (`admin-users`, action `invite_user`) :

- **Superadmin** → *Utilisateurs* → « Inviter un utilisateur » (tenant optionnel) ;
- **Administrateur de tenant** → *Paramètres › Utilisateurs* → « Inviter un
  utilisateur » (tenant courant imposé).

Déroulé côté serveur, d'un bloc : compte créé **sans mot de passe** et **non confirmé**
(`email_confirm: false` — un compte confirmé ne peut plus recevoir de lien d'invitation),
rattachement au tenant, `generateLink({ type: "invite" })`, envoi par le serveur du tenant.
Le lien mène à `/activer-compte?token_hash=…&type=invite`, où l'agent choisit son mot de
passe (8 caractères minimum, confirmation) ; il se connecte ensuite normalement.

Si l'adresse a déjà un compte Iris, il est simplement **rattaché** au tenant : aucun mail, il
a déjà son mot de passe. L'écran le dit.

**Aucun mot de passe n'est plus généré ni affiché à un administrateur** — c'était le
fonctionnement précédent de la zone superadmin.

### Renvoi d'un lien de mot de passe

Bouton clé, dans la liste des utilisateurs (superadmin) et dans la liste des membres
(Paramètres › Utilisateurs). L'autorité est tranchée en SQL par
`can_manage_account(acteur, cible)` : administrateur plateforme, ou administrateur d'un tenant
dont la cible est membre.

### Changement de relais dans le Socle

L'administrateur modifie le serveur d'envoi dans le Socle (organisation principale, onglet
« Emails (SMTP) »), et le teste **là-bas** — le Socle a son propre bouton d'envoi de test. Côté
Iris, rien à faire : le miroir suit à la prochaine synchronisation, ou tout de suite via
Paramètres › Référentiel → « Synchroniser maintenant ». Le résultat se lit dans `sync_runs`
(`counters.smtp_synchronises` / `smtp_retires`, et `counters.warnings` en cas de refus).

### Notification de demande (2026-08-24)

Chaque notification in-app est **doublée d'un e-mail** portant un **permalien** vers la fiche
(`IRIS_APP_URL/demandes/<id>`). Détail du modèle : [`../src/features/notifications/CLAUDE.md`](../src/features/notifications/CLAUDE.md).

Ce parcours diffère des précédents sur un point structurant : **l'envoi ne part pas du geste**.
Un appel SMTP dans la transaction métier la ferait traîner et la ferait échouer quand le relais
est indisponible — on n'annule pas une affectation parce qu'un serveur de mail tousse. La ligne
`notifications` sert donc de **boîte d'envoi**, drainée par l'edge function
`notifications-mailer` que `pg_cron` appelle chaque minute (`x-cron-secret`, secret lu au Vault
— même montage que `sync-socle-referentiel`). Conséquences pratiques :

- le délai maximal d'un e-mail est d'**une minute** (le volet in-app, lui, est immédiat) ;
- un relais en panne ne casse rien : retour en file avec temporisation croissante (2, 4, 8,
  16 min), puis abandon franc en `failed` au bout de 5 tentatives ;
- deux exécutions concurrentes ne peuvent pas expédier deux fois (réclamation atomique).

**Contenu.** Un e-mail quitte le périmètre applicatif : il n'emporte que la référence, l'objet
de la demande, la démarche, le destinataire, les statuts et l'auteur du geste. **Jamais** le
corps d'une note interne (invariant), l'identité de l'usager, la description ni les pièces —
le permalien porte le reste, sous le contrôle du RLS.

**Préférences.** `notification_preferences` décide des canaux servis (in-app, e-mail), *fail
open* : sans préférence, tout est envoyé. Modèle posé, écran de réglage à venir.

### Réponse à l'usager (2026-08-26)

Depuis l'onglet **Échanges** de la fiche demande, un agent écrit à l'usager — avec un modèle
d'e-mail ou à la main, pièces jointes comprises. C'est le **premier e-mail d'Iris qui ne va
pas à un agent**. Détail : [`../src/features/requests/CLAUDE.md`](../src/features/requests/CLAUDE.md).

**⚠️ Portée de la règle « ce qui sort d'Iris ».** Le paragraphe *Contenu* ci-dessus vise les
e-mails de **notification**, qui vont aux **agents** : il les empêche de transformer la
messagerie en second système d'information. Il **ne s'applique pas** ici — le destinataire
*est* la personne concernée, et le texte a été relu et validé par un agent avant de partir.
Ce qui reste vrai sans exception : **le corps d'une note interne ne sort jamais** (invariant),
et rien dans ce chemin ne lit `request_messages`.

**Envoi synchrone**, à rebours des notifications : la file d'attente existe parce qu'un envoi y
est l'effet de bord d'un geste métier ; ici l'envoi **est** le geste, et l'agent attend sa
réponse. L'edge function `send-request-email` (motif `admin-users` : JWT vérifié en code, CORS
par allowlist) résout tout côté serveur — **le droit d'instruction** (`request_right_for`), **le
destinataire** (jamais accepté du navigateur : il vient de `requester_snapshot`) et **les
chemins de pièces** (préfixés `{organization_id}/{request_id}/`, sans quoi un agent joindrait
n'importe quel objet du bucket). Le relais est celui du tenant (`smtp_config_for_org`), repli
plateforme comme ailleurs.

**L'échange est écrit AVANT l'envoi** (`start_request_email` → `settle_request_email`) : écrire
après laisserait un trou — l'e-mail parti et aucune trace si l'écriture échoue. Un échec laisse
donc une ligne `echec` lisible dans l'onglet, avec son motif.

**Marque.** Le bandeau et le pied portent **la collectivité seule**, jamais « Iris · … » : un
usager n'a pas à connaître le nom du logiciel de sa mairie (`usagerBrand`). Le pied du gabarit
porte déjà la mention exigée — « … — message automatique, merci de ne pas y répondre. » —, et
**rien d'autre n'est ajouté** au message (décision PO : « ne pas répondre, sans plus » — pas de
rappel de référence, pas de coordonnées, pas de bouton).

**Pièces jointes** : téléversées par le navigateur dans `request-attachments` (la policy storage
y exige déjà le droit d'instruction), déclarées en base avec `request_attachments.email_id`,
puis relues côté serveur et jointes au message. Plafond **10 Mo** au total — limite pratique des
relais, bien en deçà des 25 Mio que le bucket accepte par objet.

## 5. Diagnostic

| Symptôme | Cause la plus probable |
|---|---|
| Mail en anglais, sobre, pas au gabarit | Hook « Send Email » non activé — §3 |
| « Aucun serveur d'envoi configuré » | Ni miroir `smtp_settings` pour le tenant, ni `IRIS_SMTP_*` — vérifier d'abord le Socle, puis la synchronisation |
| Le miroir reste vide après une synchro | `sync_runs.counters.warnings` : clé Socle sans le scope `smtp`, ou racine hors périmètre de la clé |
| Le relais du Socle a changé, Iris envoie encore par l'ancien | Synchronisation pas encore passée — Paramètres › Référentiel → « Synchroniser maintenant » |
| `smtp_settings.socle_org_id` est nul | Ligne héritée de la saisie manuelle du 2026-08-23 (avant la bascule) : elle sert encore, et la première synchronisation la remplacera par la déclaration du Socle |
| Envoi en échec `self signed certificate` | Relais à certificat auto-signé — voir §1, Iris ne désactive pas la vérification |
| Envoi en échec `550 … not allowed` | `from_email` (côté Socle) non autorisée par le relais |
| Le lien mène à l'accueil, sans jeton | URL de redirection non autorisée — §3 |
| « Lien invalide ou expiré » | Jeton déjà utilisé, ou expiré : les liens sont à usage unique |
| Invitation : `email_sent: false` | Le compte existe, le message n'est pas parti — corriger le relais dans le Socle, synchroniser, puis « renvoyer un lien » |
| Notifications : les `notifications.email_status` restent à `pending` | Le job `notifications-mailer` n'aboutit pas : secret `cron_secret_iris` absent du Vault (la fonction répond 401 en silence), ou `CRON_SECRET` non posé côté fonction |
| Notifications : `email_status = 'skipped'` | Destinataire sans adresse, tenant sans relais, **ou canal e-mail coupé par la préférence de l'utilisateur** — `email_error` le dit |
| Notifications : `email_status = 'failed'` | 5 tentatives en échec ; `email_error` porte le dernier message du relais |

Journaux : `supabase functions logs auth-email-hook` / `admin-users` /
`sync-socle-referentiel` / `notifications-mailer`. Chaque envoi trace le type, le destinataire, le tenant et le relais
utilisé (`tenant` ou `plateforme`) ; la synchronisation trace ses compteurs — **jamais le mot
de passe**, nulle part.

## 6. Tests

- `supabase/functions/_shared/email/*.test.ts` — gabarit, catalogue, résolution du serveur
  d'envoi, **corps des e-mails de notification** (`notifications.test.ts`, 22 cas : permalien
  présent en HTML et en texte brut, URL non http neutralisée, objet de la demande échappé, et
  le corps de la note interne absent) — vitest, `npm test`.
- `supabase/tests/notifications-email.test.sql` — préférences par canal et boîte d'envoi
  (10 scénarios, transactionnel annulé).
- `supabase/functions/sync-socle-referentiel/_shared/smtp.test.ts` — recopie de la déclaration
  du Socle : normalisation, mot de passe jamais élagué, défauts prudents (port 587, TLS actif),
  et surtout **refus** — déclaration absente, incomplète ou incohérente ⇒ le miroir s'efface.
- `supabase/tests/messagerie.test.sql` — 12 scénarios : disparition des RPC de saisie,
  **aucune surface cliente** (lecture comprise), porte de service unique, secret Vault jamais
  exposé ni orphelin, miroir strict, étanchéité cross-tenant. Transactionnel annulé, à rejouer
  via `apply_migration` (jamais `execute_sql`, en lecture seule) — le verdict est l'exception
  finale.
- Côté Socle : `supabase/functions/public-api/_shared/serializers.test.ts` (whitelist du DTO
  SMTP) et `openapi.test.ts` (le contrat documente la route, son scope et le mot de passe en
  clair).
