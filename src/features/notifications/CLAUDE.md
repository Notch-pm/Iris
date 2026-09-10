# Notifications in-app (`src/features/notifications`)

Cloche du header : ce qui a bougé sur les demandes qui me concernent, dans le **tenant
courant**. Livré le 2026-08-24 (décision PO). Doctrine base : [`docs/data-model.md`](../../../docs/data-model.md)
(section « Notifications »), migrations `20260824100000` et `20260824100100`.

## L'invariant de la feature

**La base est le seul producteur.** Les notifications naissent de triggers `SECURITY DEFINER`
sur `requests` et `request_messages` ; `notifications` n'a **aucune policy d'écriture
cliente**. Un navigateur ne peut ni en fabriquer une pour autrui, ni en retoucher une, ni en
supprimer — il peut seulement lire les siennes (RLS `user_id = auth.uid()`) et poser un accusé
de lecture par RPC. Corollaire : le front ne décide **jamais** qui doit être notifié, il n'a
même pas la question à se poser.

## Les motifs

| `kind` | Qui reçoit | Quand |
|---|---|---|
| `assigned` | le nouvel affectataire | une demande lui est affectée (création ou réaffectation) |
| `unassigned` | l'ancien affectataire | on lui retire la demande (`reassigned` dit si elle est passée à quelqu'un d'autre ou si c'est un retrait sec) |
| `status_changed` | l'affectataire | le statut change **sans** que l'affectation bouge |
| `note_added` | l'affectataire | une note interne est ajoutée à sa demande |
| `mentioned` | la personne citée | quelqu'un écrit `@elle` dans une note interne — **prime sur `note_added`** (l'affectataire cité ne reçoit qu'un message) ; seuls les agents pouvant CONSULTER la demande sont mentionnables, garde `t03_request_messages_guard_mentions` |
| `new_request_in_scope` | tout membre du tenant détenant **instruction** sur le couple (organisation Socle, démarche) de la demande | une demande entre — créée dans Iris comme ingérée depuis Clara ou un partenaire |
| `transferred_in` | tout membre détenant **instruction** sur le couple d'**ARRIVÉE** | un autre service transfère la demande à cet organisme (2026-09-01) |
| `intervention_requested` | l'**intervenant** sollicité | un agent le sollicite pendant l'instruction (2026-09-14) — produite par la RPC `request_intervention`, pas par un trigger |
| `intervention_completed` | l'agent qui a **sollicité**, et l'**affectataire** s'il est quelqu'un d'autre | l'intervenant déclare l'intervention réalisée (RPC `complete_request_intervention`) |

**Le commentaire d'intervention SORT dans l'e-mail** (décision du 2026-09-14) : la
sollicitation dit ce qui est attendu, la réalisation ce qui a été fait — c'est un texte écrit
POUR son destinataire, pas une note interne, et sans lui le message ne dirait pas quoi faire.
Le demandeur, lui, n'y figure toujours pas.

**Jamais pour son propre geste** : la règle est portée une seule fois, dans
`push_notification` (`p_user_id = p_actor_id` → no-op), pas répétée dans chaque trigger.
L'acteur est `auth.uid()` ; il vaut NULL en contexte de service (ingestion, automatismes) et
alors tout le monde est servi — ce qui est le cas le plus utile.

**Un geste, une notification par personne** : l'affectataire d'une demande nouvelle reçoit
`assigned` et **pas** `new_request_in_scope` ; une réaffectation qui change aussi le statut
produit `assigned`/`unassigned` et **pas** `status_changed` par-dessus (le payload d'`assigned`
porte le statut courant).

**« Notifier l'organisme cible » se lit « notifier ses agents »** (arbitrage PO 2026-09-01) :
Iris ne miroite **aucune adresse e-mail d'organisation** — le miroir Socle porte id, parent,
nom, statut, rien d'autre, et la whitelist de `socle-proxy` exclut explicitement courriel et
téléphone. Le droit par couple (organisation, démarche) désigne exactement les bonnes
personnes ; c'est donc le même fan-out que `new_request_in_scope`, sur le couple d'arrivée.
`transferred_in` part **indépendamment** de l'affectation : un transfert qui emporte
l'affectation produit `unassigned` pour l'ancien affectataire **et** `transferred_in` pour
l'organisme qui hérite — ce ne sont pas les mêmes personnes, ni la même information.

## Le payload est un instantané

Le trigger fige `reference`, `subject`, `actor_name` (+ statuts, démarche, destinataire selon
le motif). Le volet se rend donc **sans jointure**, et une notification reste lisible même si
le périmètre de droits de son destinataire change ensuite. Deux conséquences à connaître :

- **Le corps d'une note interne n'y est jamais recopié** (invariant « les notes internes ne
  quittent jamais Iris ») : on annonce l'existence de la note, on renvoie à la fiche.
- Cliquer une notification peut mener à une fiche que le RLS refuse désormais — c'est assumé,
  la fiche gère le cas, on ne réécrit pas l'histoire.

## Doublage par e-mail (2026-08-24)

Chaque notification est **doublée d'un e-mail**, dont le corps se construit dans
`supabase/functions/_shared/email/notifications.ts` (pur, testé — 22 cas) et se rend avec le
gabarit commun (`template.ts`). Le message porte un **permalien** vers la fiche
(`IRIS_APP_URL/demandes/<id>`) : c'est le seul chemin vers le détail, et il reste gardé par
l'authentification puis par le RLS.

**Ce qui sort d'Iris.** Un e-mail quitte le périmètre : il part chez un fournisseur de
messagerie, atterrit sur un téléphone, se transfère. On n'y met donc que ce qui permet de
reconnaître la demande et de décider si elle appelle une action — référence, objet, démarche,
destinataire, statuts, auteur du geste, **date de dépôt** (`transferred_in`). **Jamais** le
corps d'une note interne (invariant), l'identité de l'usager, la description, les pièces. Le
permalien porte le reste.

**L'avis de transfert dit la chose attendue, en premier** : la phrase d'ouverture est
« La demande <référence — objet> a été transférée de <organisme quitté> vers <organisme
d'arrivée>. », et l'objet du message nomme l'organisme quitté (« trier sans ouvrir »).
L'auteur du geste suit sur sa propre ligne : ce que le lecteur veut savoir, c'est d'où le
dossier arrive, pas qui a cliqué. Chaque bout manquant se **retire** de la phrase au lieu d'y
laisser un trou.

⚠️ **Le DEMANDEUR ne sort pas non plus, y compris dans l'avis de transfert** — la question a
été posée et tranchée le 2026-09-01 : l'organisme qui hérite reconnaît la demande à sa
référence, son objet, sa démarche et sa date de dépôt, et lit l'usager sur la fiche, sous RLS.
Un test le fige (`notifications.test.ts`).

**L'envoi ne part jamais du déclencheur.** Un appel SMTP dans la transaction métier la ferait
traîner et la ferait échouer quand le relais est indisponible — on n'annule pas une affectation
parce qu'un serveur de mail tousse. La ligne `notifications` est une **boîte d'envoi** que
draine l'edge function `notifications-mailer`, appelée par `pg_cron` chaque minute :

1. `claim_notification_emails` réclame un lot **et le marque `sending` atomiquement**
   (`for update skip locked`) — deux exécutions concurrentes ne peuvent pas expédier deux fois ;
2. relais résolu **une fois par tenant** (`smtp_config_for_org`, repli plateforme `IRIS_SMTP_*`) ;
3. `settle_notification_email` : succès → `sent` ; échec → retour en file avec temporisation
   croissante (2, 4, 8, 16 min), puis `failed` au bout de 5 tentatives ;
4. pas d'adresse ou pas de relais → `skip_notification_email` : réessayer ne réussira jamais.

Une ligne restée `sending` plus de 15 min est reprise au tour suivant : une fonction morte en
vol ne bloque rien.

⚠️ **Redéploiement** : la fonction dépend de `_shared/email/{config,template,messages,
notifications,transport}.ts` — les CINQ doivent figurer dans le tableau `files` du déploiement,
sinon l'import échoue à froid (piège connu du projet).

## Doublage par push sur appareil (Web Push / VAPID, 2026-09-10)

Chaque notification **in-app** est aussi poussée sur les appareils inscrits de son destinataire,
application fermée comprise. Décisions PO (2026-09-10) et choix d'architecture :

- **Le push SUIT le canal in-app.** Aucun réglage par événement : ce qui apparaît dans la cloche
  est poussé. Le seul réglage est **par appareil** — l'interrupteur « Notifications sur cet
  appareil » (`PushDeviceToggle`, sur « Mon compte » et dans la feuille « Moi » du mobile).
- **`push_subscriptions`** : UN abonnement PAR APPAREIL (endpoint du service de push, clés
  p256dh/auth — publiques par construction, elles servent à chiffrer VERS l'appareil).
  L'enregistrement passe par la RPC **`register_push_subscription`** (DEFINER), seule porte
  d'écriture : sur un poste partagé, le navigateur rend le **même endpoint** au titulaire
  suivant, et la RPC **reprend** la ligne (`on conflict (endpoint) do update set user_id`),
  ce qu'un `insert` borné à `user_id = auth.uid()` ne pourrait pas. Lecture, `last_seen_at` et
  suppression restent en écriture directe sous RLS (soi seul).
- **`push_status`** (+ `push_attempts`, `push_attempted_at`, `push_sent_at`,
  `push_next_attempt_at`, `push_error`) sur `notifications`, miroir des colonnes `email_*`. La
  valeur initiale est décidée par le trigger **`t10_notifications_push_queue`** (BEFORE INSERT) :
  `pending` ssi `in_app` ET au moins un appareil actif du destinataire, `skipped` sinon — une
  règle, appliquée aux huit sites d'insertion sans toucher aucun producteur. Un producteur qui
  poserait `push_status` serait écrasé : voulu.
- **Le facteur** : edge function `notifications-push` sur cron (`* * * * *`, même porte que le
  mailer — `x-cron-secret`, aucun CORS). `claim_notification_pushes` renonce d'abord aux lignes
  **déjà lues** (« lue avant envoi ») et à celles **sans appareil actif**, puis réclame
  atomiquement avec les appareils du destinataire en JSON. Un envoi par appareil ; la ligne est
  `sent` dès qu'UN appareil a reçu ; 404/410 ⇒ `disable_push_subscription` ; le reste ⇒
  temporisation croissante puis `failed` (`_shared/push/outcome.ts`, pur, testé). Sans clés
  VAPID, la fonction répond 503 **sans réclamer** : réclamer consommerait les tentatives.
- **Ce qui sort, version la plus stricte** (`_shared/push/message.ts`, pur, testé) : un push
  s'affiche sur un écran VERROUILLÉ. Titre = motif · référence ; corps = acteur + action +
  objet, tronqué. Jamais le corps d'une note, jamais l'usager, **jamais le `comment` d'une
  intervention** (il sort dans l'e-mail, pas ici). Le texte est chiffré de bout en bout (RFC
  8291) : le service de push ne le lit pas. `tag = iris:<request_id>` : une carte par demande
  sur le téléphone, la plus récente remplace. Clic ⇒ `/demandes/<id>` pour tous les motifs
  (parité cloche et e-mail).
- **Service worker `public/sw.js` — push SEUL** : aucun `fetch`, aucun cache, Iris reste en ligne
  uniquement. Enregistré **à l'activation de l'interrupteur**, jamais au démarrage (sans
  abonnement il ne recevrait rien). `PushBootstrap` (monté une fois dans `App.tsx`, commun aux
  deux shells) touche `last_seen_at` et écoute le worker : `iris:navigate` (clic quand l'app est
  ouverte) et `iris:push-resubscribed` (rotation d'abonnement par le navigateur).
- **Déconnexion** : `signOut` retire l'abonnement de l'appareil (best effort) — poste partagé.
  Un abonnement du navigateur **sans ligne à moi** est retiré à la lecture (`readState`).
- **Clé publique VAPID** en `VITE_VAPID_PUBLIC_KEY` : elle est dans chaque abonnement, ce n'est
  pas un secret — hors du champ « aucun secret en `VITE_*` ». Clé privée et sujet
  (`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) dans les secrets d'edge functions. Absente ⇒ état
  `not_configured`, rien ne casse.
- **iOS** : Safari n'expose le push qu'en application AJOUTÉE À L'ÉCRAN D'ACCUEIL (≥ 16.4) ;
  l'état `needs_install` l'explique. C'est une détection de **capacité** (plateforme Apple et
  non `standalone`), pas de layout — la règle « jamais le User-Agent » vise le choix
  bureau/mobile.

⚠️ **Redéploiement de `notifications-push`** : par la CLI de préférence
(`npx supabase functions deploy notifications-push --project-ref tqcoqlneybtbrrcvpkpk
--no-verify-jwt`), qui embarque `_shared` d'elle-même. Par le MCP, les SIX fichiers
`_shared/push/{config,message,outcome,transport}.ts` + `_shared/email/{notifications,template}.ts`
doivent figurer dans le tableau `files`.

**Vérifié de bout en bout le 2026-09-10** (Android · Firefox, application fermée) : geste dans
Iris → ligne `pending` → cron → `sent` en 10 s → carte sur le téléphone.

### Vérifier ou diagnostiquer (« je n'ai pas reçu la notification »)

Le piège du premier essai : **on n'est jamais notifié de son propre geste**. Un essai demande
DEUX comptes — le téléphone est inscrit avec le compte A, et c'est le compte B, sur un autre
appareil, qui fait un geste visant A (affectation, mention `@A`, sollicitation d'intervention).
Un geste fait depuis A notifie quelqu'un d'autre, dont l'appareil n'est probablement pas
inscrit : la ligne sera `skipped`, sans erreur — c'est le comportement attendu.

Trois lectures, dans l'ordre, disent où ça bloque (`execute_sql`, lecture seule) :

```sql
-- 1. L'appareil est-il inscrit, et pour QUEL compte ?
select u.email, s.user_agent, s.disabled_at, s.disabled_reason, s.created_at
  from public.push_subscriptions s join public.users u on u.id = s.user_id;

-- 2. La notification a-t-elle été produite, pour QUI, et qu'a décidé la file ?
--    skipped + push_error null  → décidé à l'insertion : in-app coupé, ou aucun appareil du DESTINATAIRE
--    skipped + « lue avant envoi » / « aucun appareil actif » → renoncement au claim
--    pending + push_error        → envoi en échec, temporisation en cours
select n.kind, u.email as destinataire, n.push_status, n.push_attempts, n.push_error, n.created_at, n.push_sent_at
  from public.notifications n join public.users u on u.id = n.user_id
 where n.created_at > now() - interval '1 hour' order by n.created_at desc;

-- 3. Le cron atteint-il la fonction ? (200 {claimed…retried…} attendu ; 401 = secret cron, 503 = VAPID, 404 = non déployée)
select status_code, left(content::text, 100), created from net._http_response
 where created > now() - interval '10 minutes' order by created desc;
```

Côté navigateur : le texte sous l'interrupteur nomme l'état (« non configuré » = clé publique
absente du build ; « bloquées dans les réglages » = permission refusée). `Notification.permission`
et `navigator.serviceWorker.getRegistration('/')` dans la console confirment.

## Préférences par canal

`notification_preferences (user_id, kind, in_app, email)` — **globales à tous les tenants du
compte** (décision PO 2026-08-24) : un agent rattaché à deux collectivités règle ses
notifications une seule fois. Elles se saisissent dans « Mon compte »
([`../account/CLAUDE.md`](../account/CLAUDE.md)). `'*'` porte le défaut du compte, une ligne de
motif le surcharge ; `notification_channels_for(user, kind)` est l'unique porteuse de cette
sémantique et les déclencheurs la consultent **à la source** :

| Préférence | Effet |
|---|---|
| tout activé (ou aucune ligne) | ligne visible au volet + e-mail |
| e-mail coupé | ligne visible, `email_status = 'skipped'` |
| in-app coupé | ligne **muette** (`in_app = false`), l'e-mail part quand même |
| les deux coupés | **aucune ligne n'est créée** |

**Fail OPEN** : l'absence de préférence notifie sur tous les canaux — l'inverse du modèle de
droits (*fail closed*), et c'est délibéré : un droit manquant doit fermer, une préférence
manquante ne doit pas faire taire une information.

Contrairement à `notifications`, une préférence **est** le geste de son titulaire : elle a des
policies d'écriture clientes, bornées à `user_id = auth.uid()`. Aucune vérification
d'appartenance à un tenant : une préférence est un attribut du COMPTE, pas d'un rattachement.

## Fichiers

- **`notifications.ts`** (pur, testé — 21 cas) : tout le français vit ici. `notificationTitle`
  / `notificationMessage` (la base ne fabrique aucune phrase), `notificationSubtitle`,
  `relativeAge` (`now` injecté → pur), `groupNotifications` (Aujourd'hui / Hier / Cette
  semaine / Plus ancien, groupes vides omis), `unreadCount`, `badgeLabel` (plafond « 9+ »).
  Tout est **tolérant à l'inconnu** : un `kind` d'une version ultérieure s'affiche
  « Notification / Cette demande a évolué. » au lieu de casser le volet.
- **`useNotifications.ts`** : `useNotifications` (30 dernières du tenant, `order created_at
  desc`), `useNotificationsRealtime`, `useMarkNotificationsRead`, `useMarkAllNotificationsRead`,
  `useUnreadNotificationCount` (dérivé de la même liste — **aucune requête de compteur**).
- **`supabase/functions/_shared/email/notifications.ts`** (pur, testé) : un message par motif,
  objet préfixé de la référence (tri en boîte de réception), permalien en bouton d'action.
- **`supabase/functions/notifications-mailer/index.ts`** : le facteur de la boîte d'envoi.
- **`supabase/functions/_shared/push/`** : `message.ts` (texte du push, pur, testé), `outcome.ts`
  (règlement après N appareils, pur, testé), `config.ts` (`readVapid`, pur, testé),
  `transport.ts` (`web-push`, seule brique Deno — se substitue seule si la bibliothèque fait
  défaut) ; **`notifications-push/index.ts`** : le facteur push.
- **`src/lib/push.ts`** (pur, testé) : états (`resolvePushState`), textes (`PUSH_COPY`), mapping
  abonnement → ligne, libellé d'appareil ; **`usePushSubscription.ts`** : lecture du navigateur,
  `enable`/`disable`, `forgetDevicePush` (déconnexion), `PushBootstrap` ; **`PushDeviceToggle.tsx`**
  : l'interrupteur, un composant pour les deux hôtes ; **`public/sw.js`** : le service worker.
- **`NotificationBell.tsx`** : tuile `h-9 w-9` du header à gauche des Paramètres, pastille de
  non-lues, volet flottant (clic extérieur + Échap), « Tout marquer comme lu ». Cliquer une
  ligne **vaut accusé de lecture** puis ouvre la fiche.

## Temps réel

La table est dans la publication `supabase_realtime` ; l'abonnement écoute les INSERT filtrés
`user_id=eq.<moi>`. **Realtime ré-applique le RLS par abonné** : le filtre n'est pas une
sécurité, seulement une économie de trafic — c'est le serveur qui décide, comme partout.

- ⚠️ Le canal est keyé sur **l'id utilisateur et l'id de tenant**, jamais sur l'objet session :
  supabase-js ré-émet une nouvelle session à chaque retour d'onglet, ce qui détruirait et
  recréerait le canal en boucle (même piège que l'AuthProvider).
- Un **repli par sondage** (60 s) double le push : proxy hostile, onglet dormant, websocket
  coupé — la cloche finit toujours par être juste.

## Points de vigilance

- **`clock_timestamp()` et non `now()`** pour `created_at` (migration `20260824100100`) : `now()`
  est l'heure de début de transaction, donc les deux notifications d'une réaffectation
  portaient la même date et le volet les affichait dans un ordre indéterminé. Constat du test
  T6c — c'est exactement ce que les tests transactionnels servent à attraper.
- **Le fan-out interroge `can_process_request_for`**, enveloppe de `permission_pairs_of` (même
  moteur, ADR-04) **sans** la garde anti-sondage de `user_has_request_right` : cette garde
  protège un appel RPC client, elle n'a aucun sens dans un trigger et ferait taire les
  notifications quand l'auteur du geste n'est pas membre du tenant (administrateur de
  plateforme). La fonction n'a aucune `EXECUTE` cliente : pas de surface de sondage.
- Le volet est **borné au tenant courant** (comme tout le reste de l'application) : changer de
  tenant change la cloche.
- **Aucune purge n'est branchée** : les notifications suivent la demande (`on delete cascade`),
  donc la purge RGPD les emporte, mais rien ne rogne les anciennes lues ni les lignes `sent`.
  À prévoir si la volumétrie le demande.
- **Le cron tourne toutes les minutes** : c'est le délai maximal d'un e-mail. Le volet, lui,
  est immédiat (temps réel). Si le secret `cron_secret_iris` du Vault n'est pas posé, l'appel
  part sans secret, la fonction répond 401 et **rien n'est envoyé** — le job est inoffensif à
  vide, mais silencieux : surveiller `email_status = 'pending'` qui s'accumule.

## Tests

- `notifications.test.ts` — module pur du volet, 24 cas.
- `supabase/functions/_shared/email/notifications.test.ts` — corps des e-mails, 28 cas (dont :
  le corps de la note n'y figure pas, le permalien survit au rendu HTML **et** texte, une URL
  non http retombe sur « # », l'objet de la demande est échappé).
- [`supabase/tests/notifications-email.test.sql`](../../../supabase/tests/notifications-email.test.sql)
  — **10 scénarios, tous passés le 2026-08-24** : les quatre combinaisons de préférences, la
  surcharge par motif, le fan-out qui les respecte, la double réclamation impossible, le
  règlement (succès / échec temporisé / abandon), l'inaccessibilité cliente de la boîte
  d'envoi, et la préférence réservée à son titulaire.
- [`supabase/tests/notifications.test.sql`](../../../supabase/tests/notifications.test.sql) —
  **11 scénarios, tous passés le 2026-08-24**, transactionnel annulé : les cinq motifs · jamais
  pour son propre geste (statut, note, auto-désaffectation) · le fan-out sert l'instruction et
  **pas** la consultation seule ni un autre couple · ingestion sans acteur → tout le périmètre ·
  le corps de la note ne fuite pas · étanchéité RLS · INSERT/UPDATE/DELETE clients refusés ·
  fonctions internes hors de portée d'`authenticated` · les RPC de lecture ne touchent que ses
  propres lignes · table bien publiée en temps réel.
