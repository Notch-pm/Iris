# Emails — Iris

> **Public** : développeuses et développeurs, et l'administrateur qui met un tenant en
> service · **Question traitée** : par où partent les mails d'Iris, avec quel gabarit, et que
> faut-il configurer pour qu'ils partent ? · **Dernière mise à jour** : 2026-08-30

Iris envoie aujourd'hui **deux familles de messages** — et la distinction commande tout le
reste de ce document, jusqu'à l'habillage :

**Aux AGENTS** — des messages du logiciel à ses utilisateurs, à la marque d'Iris :

| Message | Déclencheur | Chemin d'envoi |
|---|---|---|
| **Réinitialisation de mot de passe** | l'agent depuis `/mot-de-passe-oublie` (self-service) | GoTrue → hook `auth-email-hook` |
| **Réinitialisation de mot de passe** | un administrateur ayant autorité sur le compte, bouton « lien de réinitialisation » | edge function `admin-users` (`send_password_reset`) |
| **Activation de compte (invitation)** | un administrateur qui invite un agent | edge function `admin-users` (`invite_user`) |
| **Notification métier** (affectation, retrait, changement de statut, note interne, mention, nouvelle demande, **demande transférée**) | la BASE, par trigger — jamais le client | boîte d'envoi drainée sur cron par `notifications-mailer` |

**À l'USAGER** — des messages de la collectivité à ses habitants, à la marque et **aux
couleurs de la collectivité** (§ 4, « Charte graphique de la collectivité ») :

| Message | Déclencheur | Chemin d'envoi |
|---|---|---|
| **Réponse à l'usager** | un agent, depuis l'onglet Échanges de la fiche | edge function `send-request-email` (synchrone) |
| **Avis de clôture** | la résolution d'une demande, composée par le serveur | edge function `send-request-email` (`kind: "cloture"`) |

Tous partagent le gabarit et le serveur d'envoi décrits ci-dessous.

## 1. Le gabarit

`supabase/functions/_shared/email/` — **modules purs, testés par vitest** (le rendu ne
dépend d'aucun runtime), plus un module d'envoi qui, lui, dépend de Deno :

| Module | Rôle |
|---|---|
| `template.ts` | Rend le HTML et la version texte. Carte centrée 520 px bordée de la couleur de marque, bandeau blanc, bouton, lien de repli, pied — **reprise du gabarit Clara**, rhabillée aux tokens du DS Ariane. |
| `messages.ts` | Catalogue des textes, en français, un objet par type d'email. |
| `charte.ts` | Charte graphique de la collectivité (Socle) → couleur des bordures et du bouton, encre lisible sur le bouton, logo à afficher. |
| `config.ts` | Résolution du serveur d'envoi : tenant d'abord, relais de plateforme en repli. |
| `transport.ts` | `nodemailer` — la seule brique qui parle au réseau. |

Quatre règles portées par le gabarit :

- **Couleurs en hexadécimal, styles inline.** Un client de messagerie ne lit ni `hsl()`, ni
  les variables CSS, ni un `<style>` externe. Les valeurs de `EMAIL_COLORS` sont les tokens de
  `src/index.css` convertis une fois pour toutes — à retoucher **ensemble**.
- **Tout est échappé.** Le nom du tenant vient du Socle, le nom du destinataire de la base :
  ce sont des données, jamais du HTML. Une URL d'action non `http(s)` est neutralisée en `#`.
- **Toujours une version `text/plain`.** Un message sans partie texte part au spam.
- **La charte de la collectivité habille les messages à l'usager** — et elle seule : les
  messages aux **agents** gardent le vert d'Iris (voir « Charte graphique de la collectivité »
  au §4). Le gabarit n'a qu'**un** chemin de rendu : sans charte, il peint `EMAIL_COLORS`.

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
de la demande, la démarche, le destinataire, les statuts, l'auteur du geste et — pour l'avis de
transfert — la **date de dépôt**. **Jamais** le corps d'une note interne (invariant),
l'identité de l'usager, la description ni les pièces — le permalien porte le reste, sous le
contrôle du RLS.

⚠️ **L'avis de transfert ne nomme pas le demandeur**, bien que la question ait été posée
(2026-09-01) : un e-mail se transfère et s'archive hors du périmètre, et l'organisme qui hérite
reconnaît la demande à sa référence, son objet, sa démarche et sa date de dépôt. Il lit l'usager
sur la fiche, sous RLS. Un test le fige.

**Préférences.** `notification_preferences` décide des canaux servis (in-app, e-mail), *fail
open* : sans préférence, tout est envoyé. Réglées dans « Mon compte », un motif par ligne.

**Transfert d'organisme (2026-09-01).** Quand une demande change d'organisme responsable, les
agents qui détiennent l'**instruction** sur le couple d'**arrivée** reçoivent `transferred_in`
— volet et e-mail, au **gabarit agent** (charte Iris, pas celle de la collectivité : ce message
reste entre agents). « Notifier l'organisme cible » se lit ainsi faute d'alternative honnête :
Iris ne miroite aucune adresse e-mail d'organisation, et le droit par couple désigne exactement
les bonnes personnes.

**Interventions (2026-09-14).** Deux motifs de plus empruntent ce chemin, au gabarit
**agent** : `intervention_requested` — l'e-mail à l'intervenant sollicité, avec le jour
souhaité et **la consigne de l'agent** (le commentaire sort : il est écrit pour son
destinataire) — et `intervention_completed`, à l'agent qui a sollicité et à l'affectataire (avec le
**nombre** de justificatifs joints à la fiche — jamais les fichiers).
Ils sont produits par les RPC `request_intervention` / `complete_request_intervention`, et
drainés par `notifications-mailer` comme les autres — **à redéployer** pour que le catalogue
`_shared/email/notifications.ts` les connaisse, sans quoi ils partent avec le corps de repli
« Une demande a évolué ».

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

### Avis de clôture (2026-08-28)

Résoudre une demande prévient l'usager, sans que l'agent ait à rédiger quoi que ce soit.

| | |
|---|---|
| Déclencheur | Transition vers `resolue_positive` ou `resolue_negative`, depuis la fiche |
| Objets | « Votre demande a été résolue positivement » · « Nous ne pouvons répondre positivement à votre demande » (**figés**, décision PO) |
| Composé par | Le **serveur** (`_shared/email/cloture.ts`) — le navigateur n'envoie que l'identifiant de la demande |
| Droit exigé | **Clôture** (et non instruction) : celui qui vient d'autoriser la transition |
| Enregistré | `request_emails`, comme tout échange — visible dans l'onglet Échanges |
| Pièces jointes | Aucune : l'avis annonce une décision, il ne transmet pas de document |

Le corps reprend la salutation, la référence et l'objet de la demande, la phrase d'annonce, puis
**le commentaire de l'agent s'il en a écrit un** — celui-ci est FACULTATIF depuis cette vague
(la garde SQL ne l'exige plus). Sans commentaire, le message se tient seul.

**Ce qui ne sort pas** : le motif de clôture (`irrecevable`, `réorientation`, `doublon`…). Il
classe le dossier pour le service et n'explique rien à un habitant. La règle absolue reste
inchangée par ailleurs : le corps d'une note interne ne sort jamais.

**Pourquoi la clôture et pas l'instruction.** Ouvrir `send-request-email` au droit de clôture
serait dangereux si le navigateur composait le message : un agent qui peut clore pourrait écrire
n'importe quoi à un habitant. C'est parce que le serveur compose TOUT — objet, phrases,
signature — que l'ouverture est sans risque. Les deux décisions vont ensemble ; on ne peut pas
en garder une seule.

**Si l'envoi échoue**, la demande reste résolue : on n'annule pas une décision d'instruction
parce qu'un serveur de mail tousse. L'écran le dit (« La demande est bien résolue…, mais l'avis
n'a pas pu partir »), et l'absence d'adresse est annoncée comme un fait, pas comme une erreur.

### Charte graphique de la collectivité (2026-08-30)

Les messages qui vont **à l'usager** — la réponse libre et l'avis de clôture — portent
désormais la **couleur principale** et le **logo** de la collectivité qui a reçu et traité la
demande. Les messages qui vont **aux agents** (invitation, mot de passe, notifications) gardent
le vert d'Iris : ce sont des messages du logiciel à ses utilisateurs, pas de la collectivité à
ses habitants.

**La source est le Socle, et lui seul** : `GET /v1/organizations/{id}/branding` (public-api
1.5.0, scope `read` — la charte n'est pas un secret, contrairement au relais d'envoi).

**Quelle organisation ?** Celle qui **porte** la demande — `requests.socle_scope_org_id`, le
service destinataire —, jamais la racine du tenant. Iris n'a **aucun arbre à remonter** : la
route sert la charte *applicable*, c'est-à-dire celle de l'organisation ou, à défaut, celle de
l'ancêtre le plus proche dont elle hérite. « Le logo de l'organisme concerné, ou à défaut celui
de son organisation parente » est une règle du référentiel, résolue là où elle est définie.

> ⚠️ **Ne jamais reconstituer la charte depuis `GET /v1/organizations/{id}`.** Les colonnes
> brutes d'une organisation qui hérite sont **nulles**, et les couleurs n'y sont de toute façon
> pas servies : on peindrait du vide en croyant peindre les couleurs de la collectivité.

**Ce que `charte.ts` décide**, et que le gabarit n'a donc pas à savoir :

| Décision | Règle |
|---|---|
| Couleur des bordures, du filet sous le bandeau et du bouton | `primary_color`, le vert du DS à défaut |
| Couleur du **texte** sur le bouton | **calculée** par contraste WCAG — jamais devinée |
| Quel logo | le logo **couleur** (`logo_url`), toujours — `logo_white_url` est ignoré |

**Pourquoi un bandeau blanc** (depuis le 2026-09-23). Le bandeau était un aplat de la couleur
principale ; il entrait en collision avec le logo — un logo de collectivité est dessiné pour du
papier, souvent dans sa propre couleur, et posé sur elle il perdait tout contraste. La couleur
ne sert donc plus qu'en **trait** : bordure de la carte, filet sous le bandeau, et en fond du
bouton d'action. Le nom écrit dans le bandeau prend l'encre du corps, lisible sur blanc quelle
que soit la charte. La pastille claire qu'on glissait sous le logo couleur n'a plus d'objet.

**Pourquoi calculer l'encre du bouton.** Une charte peut être un jaune vif sur lequel du blanc
est illisible. Le critère retenu est « le blanc **suffit-il** » (≥ 3:1, seuil AA grand texte — le
libellé est en 15 px gras), et non « le blanc est-il le **plus** contrasté » : sur le vert du DS
(`#089b59`) l'encre sombre contraste davantage que le blanc (≈ 4,5 contre ≈ 3,6), et un critère
de maximum repeindrait donc en sombre le bouton de **tous** les e-mails d'Iris, contre la
prescription du DS Ariane.

**Pourquoi jamais le logo blanc** : sur le bandeau blanc il disparaîtrait. Une collectivité qui
ne fournit *que* la version blanche n'a donc pas de logo dans l'e-mail — mieux vaut pas de logo
qu'un rectangle vide ; son nom, écrit dans le bandeau, suffit.

**`alt=""` sur le logo, délibérément.** Le nom de la collectivité est écrit juste à côté, dans
le même bandeau. Beaucoup de clients bloquent les images distantes par défaut ; un `alt`
porteur afficherait alors ce nom **deux fois**. Le logo est ici la redite visuelle d'un texte
présent, pas une information de plus.

**Seul du `http(s)` entre dans un `src`.** Une charte vient du référentiel, mais une URL
`javascript:` ou `data:` reste un vecteur ; une URL invalide vaut mieux tue qu'affichée cassée.
Le HTML, lui, est échappé comme partout ailleurs dans le gabarit.

**Décoratif, donc jamais bloquant.** Délai court (5 s) et échec silencieux : un Socle lent, muet
ou hors périmètre fait partir le message en habillage Iris, il ne l'empêche pas de partir —
l'inverse exact du relais d'envoi, dont l'absence est, elle, un refus. Un échec est journalisé
et **n'est pas mis en cache** : une panne d'une seconde ne doit pas dépeindre les messages des
cinq minutes suivantes.

**Ni table, ni miroir, ni migration.** Cache court en mémoire du worker (5 min, motif
`getKeyRoots` de `socle-proxy`). Une charte change deux fois par décennie, et le Socle demande
de ne pas recopier durablement son référentiel — c'est ce qui distingue la charte du relais
d'envoi, dont Iris tient un miroir parce qu'il faut pouvoir expédier même quand le Socle dort.

**Si rien n'est rempli côté Socle** (`configured: false`, ou charte vide) : habillage Iris. Ce
n'est pas une erreur, seulement une collectivité qui n'a pas encore rempli sa charte.

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
  d'envoi, **corps des e-mails de notification** (`notifications.test.ts`, 28 cas : permalien
  présent en HTML et en texte brut, URL non http neutralisée, objet de la demande échappé, et
  le corps de la note interne absent) — vitest, `npm test`.
- `supabase/functions/_shared/email/charte.test.ts` — 16 cas sur la charte de la collectivité :
  normalisation des couleurs, refus de toute URL de logo qui n'est pas du http(s), **le vert du
  DS garde son encre blanche** (garde anti-régression du critère de contraste), bascule en encre
  sombre sur une charte claire, choix logo blanc / logo couleur, et **le logo blanc jamais
  servi sur un fond clair**. Le rendu correspondant est couvert dans `template.test.ts` et
  `usager.test.ts` (sans charte, le message rendu est identique à celui d'avant, au caractère
  près).
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
