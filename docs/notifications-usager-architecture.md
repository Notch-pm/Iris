# Notifications à l'usager — architecture B12 / lot L4c

*Note d'architecture du 2026-10-24. Elle part de [`notifications-usager.md`](notifications-usager.md)
(cadrage, décisions du PO du 2026-10-24). Public : implémentation. Rien n'est codé.*

Convention : **[Lu]** = constaté dans un fichier (chemin donné) · **[Supposé]** = déduction à
confirmer.

**À retenir avant de lire :**

- **Presque rien n'est demandé au Socle** : une seule évolution additive de contacts-api,
  pour que l'usager aligne l'adresse de sa fiche sur celle de son compte (ADR-14, décision PO du
  2026-10-24, lot L4c-4). Le reste dépend de Nora.
- **Un compte n'est prévenu que si l'adresse de sa fiche Socle est celle de son compte Nora.**
  Le canal compte de la vue usager (2.9.0) ne montre que les messages envoyés à l'adresse du
  compte, transmise dans le jeton (`e`).
- **`citizen_visible = false` ne coupe pas l'accès `/suivi` d'un invité** (vérifié dans
  `citizenAccessible`). Question PO n° 1.
- **Ordre de déploiement : le filtre des avis dans la vue usager (L4c-0) doit être en ligne
  avant que le premier avis parte.** Sinon chaque avis s'afficherait comme un message dans
  l'espace de l'usager.

## 0. Constats tirés du code (ils commandent les décisions)

1. **[Lu] `citizen_visible` ne borne pas l'accès invité.**
   - Dans `supabase/functions/requests-api/index.ts`, `citizenAccessible` vérifie le tenant, la
     source, l'accès, la version, la coupure et les 90 jours. Elle **ne lit pas**
     `citizen_visible`.
   - Seul le canal compte le filtre (`citizenReader` branche `contact`, et
     `handleCitizenContactRequests`).
   - Conséquence : une demande soustraite reste lisible en `/suivi` par son invité.
2. **[Lu] Ce que voit chaque canal** (`citizenReader`, `_shared/citizenView.ts`) :
   - **compte** : les `request_emails` `envoye` dont `to_email` est égal à l'adresse **du compte
     Nora**, portée par le jeton (`e`), et ses propres messages ;
   - **invité** : les `request_emails` dont `HMAC(to_email)` est égal à
     `request_access_codes.email_hash` (adresse déclarée), et les messages
     `author_kind = 'invite'`.
   - Or `send-request-email` écrit à la **fiche Socle du jour**. Un message n'est donc visible
     dans l'espace d'un compte **que si l'adresse de la fiche est celle du compte**.
3. **[Lu] La vue usager publie tout `request_emails` `envoye` à la bonne adresse**
   (`serializeCitizenRequest`), accusé compris. Si on enregistrait un avis « nouveau message »
   comme un échange ordinaire, il apparaîtrait comme un message dans l'espace.
4. **[Lu] Côté Nora :**
   - `citizen_spaces(account_id, tenant_id = racine Socle, socle_contact_id)` : une fiche par
     espace, un compte par fiche (`20261020160000_espace_usager_fiche.sql`) ;
   - `citizen_accounts.email_hash` est un SHA-256 **non poivré**, incompatible avec les
     empreintes HMAC d'Iris ;
   - Nora signe le jeton `contact:<fiche>` avec `e` = adresse du compte
     (`_shared/iris/citizenToken.ts`) ;
   - aucune préférence de notification n'existe encore.
5. **[Lu] Les chemins existants à réutiliser :**
   - `request_receipts` et `request_access_mails`, sur le motif claim / start / settle / skip ;
   - `notifications-mailer` est déjà découpé en `receipts.ts` et `accessMails.ts` ;
   - le drapeau transactionnel `iris.reprise_usager`, posé par `record_citizen_message` et lu par
     `requests_notify_update` (`20261024100000`) ;
   - `has_admin_scope(tenant, racine)`, garde de `save_procedure_link_settings`
     (`20261016120000`).
6. **[Lu] Les transitions passent par beaucoup de portes** : update client sous
   `requests_guard_write`, `record_citizen_message`, la qualification (bascule en attente),
   `transfer_request`, `resolve_linked_requests`. Seul un trigger sur `requests` les voit toutes.

---

## 1. Décisions d'architecture (ADR courts)

### ADR-1 — Le Socle n'est pas touché

- **Contexte** : une session travaille sur le dépôt Socle. Le cadrage a écarté le Socle comme
  propriétaire de la préférence.
- **Décision** : aucune évolution du Socle. On réutilise seulement l'existant :
  - lecture de la fiche par `socleContactIdentity` (`_shared/email/socleUsager.ts`) ;
  - charte par `charteFor` ;
  - relais SMTP par le miroir `smtp_settings`.
- **Conséquences** : la préférence vit chez Nora (propriétaire), avec une copie dans Iris. Une
  préférence commune à toute la gamme (Clara) reste possible plus tard, sans rien casser.
- **Écarté** : préférence dans `contact_consents` ou dans `consent_email`. C'est un
  consentement d'une autre nature, et ce serait un chantier Socle.

### ADR-2 — Une copie poussée par Nora, clé (tenant, fiche Socle), sans identité : compatible avec « aucun miroir local d'usagers »

- **Contexte** : Iris doit savoir, pour une fiche, (a) qu'un espace existe, (b) si le canal
  courriel est voulu, (c) quelle adresse ouvre cet espace (constat 2).
- **Décision** : une table **`citizen_space_links`**, une ligne par (tenant,
  `socle_contact_id`), écrite seulement par `requests-api` sur une poussée de Nora. Colonnes :
  - un indicateur d'espace actif ;
  - les préférences par canal (`channel_prefs`, par exemple `{"email": true}`) ;
  - `account_email_hash` : HMAC de l'adresse du compte avec `IRIS_ACCESS_CODE_PEPPER`, calculé
    par Iris depuis le `e` du jeton ; l'adresse claire n'est jamais stockée.
- **Pourquoi ce n'est pas un miroir d'usagers** :
  - Elle ne porte **aucun attribut du Socle**, ni nom, ni adresse en clair, ni quartier. On ne
    peut ni lister, ni chercher, ni afficher un usager à partir d'elle.
  - Elle est **partielle** : seules y figurent les fiches qui ont un espace.
  - Elle porte un **fait d'Iris**, « faut-il prévenir et par où ? », déclaré par son
    propriétaire, Nora. Elle est écrasée à chaque poussée et effacée au retrait.
  - Précédents dans le dépôt :
    - `citizen_visible` : attribut de la relation, propre à Iris ;
    - `request_access_codes.email_hash` : empreinte HMAC d'une adresse, accessible au service
      seul ;
    - `socle_contact_id` : UUID nu ;
    - `smtp_settings` : copie poussée d'une source qui reste propriétaire.
- **Garde** : RLS activé, **aucune policy cliente** ; policy `TO service_role` explicite ; RPC
  de service révoquées dans la migration même.
- **Écarté** :
  - Iris appelle Nora à l'envoi : nouvelle dépendance au moment de l'envoi, sens de flux
    inversé.
  - Stocker l'adresse du compte en clair : ce serait bien une copie d'identité.
  - Réutiliser le SHA-256 de Nora : non poivré, et non comparable au HMAC d'Iris.

### ADR-3 — L'adresse de l'espace est une donnée de la collectivité, pas de la personne

- **Décision** : l'URL de « Mes demandes » est la même pour tous les comptes d'une collectivité.
  Elle vit sur la **source d'intégration du portail** du tenant :
  - `integration_sources.citizen_space_url`, en https, 500 caractères au plus ;
  - un gabarit facultatif `citizen_request_url_template` contenant `{request_id}`, de même
    origine.
- Elle est poussée par Nora (§3) : pas une URL par ligne de `citizen_space_links`.
- **Écarté** : une URL par fiche, inutile et redondante.

### ADR-4 — Le canal se décide par une règle unique, compte avant invité

Module pur `_shared/citizenNotices/channel.ts`, partagé par le facteur et par
`send-request-email`. Entrées lues côté serveur.

- **Canal compte valide** si toutes ces conditions tiennent :
  - un lien d'espace est actif pour la fiche ;
  - la demande est `citizen_visible` et n'est pas de source `clara` ;
  - `HMAC(adresse de la fiche Socle du jour) = account_email_hash`.
  - L'avis part alors à cette adresse et le lien mène à l'espace.
- **Canal invité valide** si toutes ces conditions tiennent :
  - un `request_access_codes` existe, non coupé, et la demande n'est pas close depuis plus de
    90 jours ;
  - `tracking_url` est connu ;
  - la demande est `citizen_visible` (voir la question PO n° 1) et n'est pas de source `clara` ;
  - l'adresse déclarée du `requester_snapshot`, vérifiée contre `email_hash` (motif
    `request-guest-access`), donne le destinataire.
  - Le lien est `tracking_url`.
- **Priorité** : compte, puis invité (cadrage : « le compte prime »). Sinon, aucun canal.
- **Conséquences** :
  - un compte dont la fiche porte une autre adresse, ou aucune (compte « mobile seul »), n'est
    pas notifié, et c'est tracé ;
  - l'avis va toujours à une adresse dont le canal **voit** la demande et ses messages, ce qui
    satisfait la condition (c) de M2 par construction.
- **Écarté** : élargir le filtre du canal compte à la fiche du jour. Cela défait la protection
  de la 2.9.0 contre les rattachements à tort.

### ADR-5 — Une file dédiée `citizen_notices`, alimentée par un trigger sur `requests`

- **Contexte** : l'accusé est enfilé par les edge functions, pour ne pas écrire aux jeux de
  démonstration. Mais les changements de statut ont au moins cinq portes (constat 6).
- **Décision** : un trigger `AFTER UPDATE OF status` sur `requests`
  (`t41_requests_citizen_notice`, `SECURITY DEFINER`, révoqué) qui **n'enfile que le fait**,
  sans décider. Il ne fait rien dans quatre cas :
  - l'interrupteur du tenant est éteint (ADR-7) ;
  - la source est `clara` ;
  - le drapeau `iris.silence_usager` est posé (ADR-9) ;
  - le drapeau `iris.reprise_usager` est posé (B11). Dans ce dernier cas, il met seulement à
    jour le statut connu de l'usager (ADR-6).
- **Enfilement** : un upsert sur l'unique ligne `pending` de la demande (index unique partiel
  sur `request_id` where `status = 'pending'`). L'événement brut (de, vers, à) est ajouté au
  tableau `events`, et `due_at` vaut **premier événement + 10 min** (fenêtre fixe, pas
  glissante, pour qu'une rafale continue ne retarde pas sans fin).
- **Écarté** :
  - un trigger sur `request_events` : couplage au journal, qui n'est pas un contrat ;
  - l'extension de `request_receipts` : une ligne par demande à vie, pas une file d'événements ;
  - l'extension de `notifications` : boîte des agents, liée à `user_id`.

### ADR-6 — Le facteur décide au moment de l'envoi, par une règle pure et unique

`notifications-mailer/citizenNotices.ts` (nouveau tiroir du facteur existant). Il réclame les
lignes dues par `claim_citizen_notices` (`for update skip locked`, reprise des lignes `sending`
de plus de 15 min).

1. **L'accusé passe d'abord.** Si `request_receipts` est encore `pending` ou `sending`, la
   ligne est reportée d'une minute, sans consommer de tentative.
2. **L'état final** = statut **courant** de la demande, comparé au **statut connu de
   l'usager** :
   - table `request_citizen_status(request_id, known_status, known_at)` ;
   - initialisée au premier enfilement avec `OLD.status` ;
   - avancée quand un avis de statut part, quand l'usager répond (B11), et quand l'avis de
     clôture part (RPC appelée par `send-request-email` en mode `cloture`).
3. **`citizenEventFor(connu, final)`**, module pur `_shared/citizenNotices/events.ts`, rend un
   **événement usager nommé** :
   - `prise_en_charge` (a_traiter → en_instruction) ;
   - `attente_information` (→ en_attente) ;
   - `reprise_instruction` (en_attente → en_instruction) ;
   - `annulation` ;
   - `reouverture` (terminal → en_instruction) ;
   - `renvoi_qualification`, `archivage` : non retenus ;
   - `resolution` : couvert par l'avis de clôture ;
   - `aucun_changement` : retour à l'état connu.
4. **`shouldSend(event, réglages)`** : la seule règle de décision,
   `_shared/citizenNotices/decision.ts`. En V1, elle répond par un **défaut fixe**, le tableau
   Q4 du cadrage. Au second temps, elle lira les réglages (ADR-8). La signature reçoit déjà
   `socle_procedure_id`.
5. **Ensuite, dans l'ordre** :
   - canal (ADR-4) ;
   - préférence du canal, *fail open* : pour le compte, `channel_prefs.email` ; pour l'invité,
     `request_access_codes.notify_email` ;
   - adresse présente ;
   - relais SMTP présent.
6. **Trace** : chaque ligne finit dans un de ces états :
   - `sent` ;
   - `skipped`, avec un `reason` d'un catalogue fermé : `interrupteur`,
     `evenement_non_retenu`, `couvert_par_avis_cloture`, `aucun_changement`, `preference`,
     `aucun_acces_en_ligne`, `adresse_compte_differente`, `masquee`, `clara`, `pas_d_adresse`,
     `pas_de_relais` ;
   - `failed` après 5 tentatives (temporisation 2, 4, 8, 16 min, motif
     `settle_request_receipt`).
   - La décision est écrite **sur la ligne**, avec l'événement retenu et le canal. C'est ce qui
     répond à « pourquoi n'ai-je rien reçu ? ».

### ADR-7 — Un interrupteur par collectivité, éteint par défaut, qui gouverne aussi M2

- **Décision** : une table
  `citizen_notification_settings(organization_id PK, enabled default false, updated_by, updated_at)`.
  - Écriture par une RPC `save_citizen_notification_settings`, qui exige
    `has_admin_scope(tenant, racine)`, même garde que `save_procedure_link_settings`.
  - Lecture par tout membre (policy select `is_org_member`).
  - Un bloc dans Paramètres.
- **Défaut** : éteint pour ACCM, Rosny, SNA27 et tout nouveau tenant. Allumé à la main pour
  Sceaux, à l'ouverture de l'espace Nora.
- **M2** (ADR-10) n'est actif que si l'interrupteur est allumé. Éteint, `send-request-email`
  fait exactement ce qu'il fait aujourd'hui (M1).
- **Pas d'effet rétroactif** : rallumer n'enfile rien pour le passé.
- **Écarté** : un drapeau dans `organizations`, qui est un miroir du Socle.

### ADR-8 — Second temps : le réglage par événement ne demande aucune refonte

- **Prévu** : une table
  `citizen_notification_event_settings(organization_id, socle_procedure_id nullable, event, enabled)`.
  NULL = collectivité, une valeur = exception de la démarche.
  - Clé unique sur (organization_id, coalesce(procedure), event).
  - RPC d'administration sous `has_admin_scope`, sur le motif `procedure_link_settings`.
- **Ce que la V1 pose déjà** :
  - le catalogue d'événements nommés (`events.ts`, fermé, avec un jumeau de vérification SQL) ;
  - le `socle_procedure_id` dans l'entrée de `shouldSend` ;
  - la raison `evenement_non_retenu`.
- **Hors de ce réglage** : `nouveau_message`, non désactivable (décision PO n° 1).
- **Écarté** : un réglage par organisme, parce que le transfert changerait la règle en cours de
  route (cadrage Q3).

### ADR-9 — Aucun jeu de démonstration n'écrit à personne : trois verrous

1. **L'interrupteur éteint par défaut** (ADR-7) couvre tous les tenants de démonstration
   existants.
2. **Le drapeau transactionnel `iris.silence_usager`**, posé par `set_config(..., true)` en
   tête de tout script de seed, de démonstration ou de nettoyage. Il est lu par le trigger t41
   **et** par les RPC qui enfilent (M2), sur le motif `iris.reprise_usager`. Il s'ajoute à la
   recette de seed et à `docs/demarrage.md`.
3. **La décision est relue à l'envoi** : éteindre l'interrupteur pendant une démonstration fait
   taire ce qui est déjà en file (raison `interrupteur`).

- **Limite connue, hors périmètre B12 mais à signaler** : un seed passé **par l'API
  d'ingestion** produit déjà de vrais accusés de réception (constat SNA27). Les seeds par API se
  font donc sur un tenant à interrupteur éteint, et l'accusé reste à traiter à part.

### ADR-10 — M2 : le serveur choisit entre message complet et avis avec extrait, l'écran l'annonce

Dans `send-request-email`, mode `libre`, après la résolution du destinataire. Le serveur
calcule la `delivery` par `channel.ts` (ADR-4) :

- **`espace`**, si l'interrupteur est allumé et qu'un canal valide existe pour cette adresse :
  - le message est enregistré **en entier** dans `request_emails`, avec ses pièces
    (`email_id`), `delivery = 'espace'` et `to_email` = l'adresse du canal ;
  - il est réglé `envoye` dès sa publication, donc lisible tout de suite dans l'espace ou
    `/suivi` ;
  - **dans la même transaction**, une RPC enfile l'avis : l'id du message s'ajoute à
    `message_email_ids` de la ligne `pending` de `citizen_notices` ;
  - **aucun SMTP synchrone**.
- **`courriel`** dans tous les autres cas (guichet sans compte, demande masquée, Clara,
  interrupteur éteint, canal invalide) : comportement actuel inchangé.

**Ce que fait l'avis :**

- Il part au `to_email` **figé du message**, et non à une adresse recalculée. Celle-ci a été
  choisie parce que le canal la voit.
- Il ignore la préférence et l'interrupteur au moment de l'envoi : un message déjà publié doit
  être annoncé.
- L'extrait (`_shared/email/avisUsager.ts`, pur) : environ 140 caractères, coupés sur un mot,
  suivis de « … », espaces normalisés. Jamais le corps entier, jamais les pièces, jamais leur
  nom.
- Une fusion avec un événement de statut dans la même fenêtre donne **un seul** courriel qui
  annonce les deux. Si la partie statut est écartée (préférence par exemple), l'avis de message
  part seul.

**Annonce avant l'envoi :**

- Un mode **`kind: "apercu"`** de `send-request-email` (même droit d'instruction, rien n'est
  écrit) rend `{ delivery, recipient_hint }`.
- Le composeur bureau (`EchangesPane`) et `MobileEcrireSheet` affichent « l'usager recevra un
  avis avec un lien vers son espace » ou « l'usager recevra le message complet ».
- La réponse de l'envoi rend la `delivery` réelle : si elle diffère de l'aperçu (cas rare),
  l'écran dit ce qui s'est passé.
- La règle s'applique à **toutes** les entrées du composeur, y compris le brouillon de
  non-conformité. Le nouveau code d'accès reste à part.

**Ce que M2 ne gère pas :** l'accès invité est coupé, ou le compte retiré, dans les dix minutes
entre la publication et l'avis. L'avis part quand même à l'adresse figée, et le lien n'ouvre
plus rien (tracé). Risque accepté, voir § 6.

- **Écarté** : un repli du facteur vers le message complet avec ses pièces. Il dupliquerait la
  logique pièces et SMTP de `send-request-email` dans le facteur, pour un cas rarissime.

### ADR-11 — `request_emails` distingue la nature et le mode de remise ; la vue usager exclut les avis

- **Colonnes ajoutées** :
  - `nature` : `message` par défaut, ou `avis` ;
  - `delivery` : `courriel` par défaut, ou `espace`.
- **Les avis**, de statut comme de message, s'écrivent dans `request_emails` (`sent_by` NULL),
  sur le motif `start_request_receipt_email`. L'onglet Échanges les montre déjà comme
  « Iris · envoi automatique ».
- **`citizenView` exclut `nature = 'avis'`** : un avis n'est pas un message de l'espace. Ce
  n'est pas un changement de contrat (les lignes concernées sont nouvelles), mais c'est un
  **prérequis de déploiement** (§5, lot L4c-0).
- **Indicateurs CCTP § 4.9** : toute mesure « répondue sous N jours » ne compte que
  `nature = 'message'` avec `sent_by` renseigné. Un avis n'est jamais une réponse.

### ADR-12 — Désinscription : jeton signé sans stockage ; page et lien chez Nora, effet chez le propriétaire

- **Le jeton** (`_shared/citizenNotices/unsubscribe.ts`, pur) : HMAC, clé dérivée de
  `IRIS_CITIZEN_TOKEN_SECRET` avec un préfixe de finalité distinct, sur
  `v1|request_id|canal|cible`. La cible est `invite` ou `compte:<fiche>`.
  - Il n'est pas stocké et n'expire pas. Il ne permet qu'une chose : désinscrire cette demande
    ou cette fiche.
- **Lien visible** dans chaque avis de statut : vers une page **du portail** (Nora), à la charte
  de la collectivité. Iris ne sert aucune page à un usager, et l'adresse `iris.edilumen.fr`
  trahirait le logiciel (doctrine `usagerBrand`).
- **En-tête `List-Unsubscribe` / `List-Unsubscribe-Post`** (RFC 8058), vers le même point de
  Nora.
- **Effet** :
  - **invité** : Nora relaie à Iris (route §3), qui écrit
    `request_access_codes.notify_email = false`. Iris est le seul endroit où cette préférence
    existe, et elle vaut pour cette demande seulement ;
  - **compte** : Iris rend le contact visé ; Nora coupe **sa** préférence d'espace, puis la
    pousse. Iris n'écrit jamais la préférence d'un compte (décision PO n° 5).
- **Écarté** :
  - une page publique dans l'application Iris : marque, et ce n'est pas son public ;
  - un rendu HTML depuis l'edge function : la passerelle force `text/plain` (piège `/api-doc`).

### ADR-13 — Le canal est porté par le modèle (SMS, B14)

- `channel` (`email` en V1, contrainte fermée et extensible) figure sur `citizen_notices`.
- Les préférences sont un objet par canal, côté Iris comme côté Nora.
- `shouldSend` et `channel.ts` raisonnent par canal.
- Le SMS ajoutera une valeur, un transport et une préférence. Aucune table nouvelle.

---

### ADR-14 — L'usager confirme ou modifie son adresse de courriel, et le Socle est mis à jour (décision PO 2026-10-24)

- **Contexte** : ADR-4 ne prévient un compte que si l'adresse de sa fiche Socle est celle de
  son compte Nora. Le PO veut que l'usager puisse **résorber lui-même l'écart** : confirmer ou
  modifier son adresse, la fiche du Socle suivant.
- **[Lu] Le Socle le refuse aujourd'hui** :
  `Socle/supabase/functions/contacts-api/_shared/citizen.ts` — `EDITABLE_KEYS` ne contient pas
  `email`, et l'en-tête le dit : « son adresse de courriel suit celle de son compte. Une
  correction passe par la collectivité. » Nora (`_shared/socle/citizenContacts.ts`,
  `PATCH /v1/citizen/contacts/{compte}`, scope `citizen`) ne peut donc pas l'écrire.
- **Décision** :
  - **Une seule adresse fait foi pour l'usager : celle de son COMPTE**, vérifiée par Nora. Il ne
    tape jamais une adresse libre destinée à la seule fiche — sans quoi une adresse non vérifiée
    entrerait au référentiel, et le canal compte (qui compare à l'adresse du jeton) resterait
    faux.
  - **Confirmer** : quand Nora constate l'écart (fiche relue ≠ compte), l'espace propose
    « Utiliser <adresse du compte> pour vos échanges avec <collectivité> ». Nora appelle une
    route du Socle qui **aligne** la fiche sur l'adresse du compte.
  - **Modifier** : l'usager change l'adresse de son compte dans Nora (avec vérification de la
    nouvelle adresse, flux de compte existant ou à créer chez Nora), puis la même route aligne
    la fiche. Nora repousse ensuite la préférence (route 2.10.0), donc la nouvelle empreinte.
  - **Socle** : contacts-api accepte `email` sur la route citoyenne **uniquement égal à
    l'adresse du compte**, que le Socle connaît déjà par le rattachement (contacts-api 1.4.0,
    rattachement « sur l'adresse du COMPTE »). Forme exacte (route dédiée « aligner sur le
    compte » ou clé `email` contrôlée) laissée à la session Socle. Journal / historique de la
    fiche côté Socle.
- **Conséquences** :
  - ADR-1 ne tient plus en entier : **une évolution du Socle est nécessaire**, petite et
    additive (contrat contacts-api), à **coordonner avec la session Socle en cours**. Iris n'en
    dépend pas pour L4c-0 à L4c-3 ; elle entre dans L4c-4 (Nora).
  - Côté agent rien ne change : la fiche reste modifiable par l'agent (`socle-proxy
    /v1/contacts/update`). Un agent qui change l'adresse de la fiche recrée l'écart ; Nora le
    signalera à la session suivante de l'usager.
  - Raison de non-envoi `adresse_compte_differente` inchangée, mais elle devient résorbable par
    l'usager — Nora l'invite à confirmer.
- **Écarté** : laisser l'usager saisir une adresse libre pour la fiche (non vérifiée, et
  divergente du compte) ; faire écrire la fiche par Iris (Iris n'est pas le guichet de l'usager
  vers le Socle, et sa clé n'a pas le scope `citizen`).

## 2. Schéma de données (en prose)

| Table | Clé | Colonnes clés | Écriture | Lecture cliente |
|---|---|---|---|---|
| `citizen_notification_settings` | `organization_id` | `enabled` (faux par défaut), `updated_by`, `updated_at` | RPC `save_citizen_notification_settings` (`has_admin_scope` racine) | select `is_org_member` |
| `citizen_space_links` | (`organization_id`, `socle_contact_id`) | `integration_source_id`, `space_active`, `channel_prefs` jsonb (`{"email":bool}`), `account_email_hash` (HMAC, contrainte 64 hex), `pushed_at` | RPC de service, appelée par `requests-api` | **aucune** |
| `integration_sources` (+) | — | `citizen_space_url`, `citizen_request_url_template` (https, ≤ 500, même origine) | RPC de service, appelée par `requests-api` | inchangé |
| `request_access_codes` (+) | — | `notify_email` (vrai par défaut), `notify_changed_at` | RPC de service | aucune (déjà) |
| `request_citizen_status` | `request_id` (FK cascade) | `known_status`, `known_at` | trigger t41, facteur, RPC de clôture | aucune |
| `citizen_notices` | `id` ; index unique partiel (`request_id`) where `status='pending'` | `organization_id`, `request_id`, `channel`, `events` jsonb (de, vers, à), `message_email_ids uuid[]`, `due_at`, `status` (`pending`/`sending`/`sent`/`skipped`/`failed`), `reason`, `event_sent`, `target` (`compte`/`invite`), `attempts`, `next_attempt_at`, `email_id` (l'avis dans `request_emails`), `settled_at` | trigger t41, RPC M2, facteur | select `can_consult_request(request_id)` : **aucune adresse n'y est stockée**, le destinataire se calcule à l'envoi |
| `request_emails` (+) | — | `nature` (`message`/`avis`), `delivery` (`courriel`/`espace`) | inchangé (service seul) | inchangé |

**Gardes et pièges** (CLAUDE.md, § Pièges) :

- toutes les fonctions trigger et RPC de service : `REVOKE EXECUTE … FROM anon, authenticated,
  PUBLIC` dans la même migration, re-révoquées à chaque `CREATE OR REPLACE` ;
- policies service écrites `TO service_role` ;
- jamais `is_service_context()` dans un `DEFINER` : le contournement se décide par
  `iris.silence_usager` et `iris.reprise_usager` ;
- `t41` est `AFTER UPDATE OF status` et n'écrit que dans les deux tables satellites ;
- la purge RGPD emporte `citizen_notices` et `request_citizen_status` par cascade ; aucune
  donnée d'usager n'y figure. Les faits statistiques ne sont pas concernés.

---

## 3. Contrat API additif — `requests-api` 2.10.0

Toutes les routes sont sous le scope `requests:citizen` (clé plateforme du portail +
`X-Socle-Root-Organization-Id`). Le jeton court est exigé là où il est indiqué.

| Route | Jeton | Corps | Effet |
|---|---|---|---|
| `PUT /v1/citizen/space` | non (clé seule) | `{ space_url, request_url_template? }` | URL de l'espace pour ce tenant et cette source (ADR-3) |
| `PUT /v1/citizen/contacts/{contact_id}/notification-preferences` | `contact:<id>` (avec `e`) | `{ channels: { email: boolean } }` | upsert de `citizen_space_links`, `space_active = true` ; `account_email_hash` calculé depuis `e`, **jamais depuis le corps** ; idempotent |
| `DELETE /v1/citizen/contacts/{contact_id}/notification-preferences` | `contact:<id>` | — | `space_active = false` : espace fermé ou compte supprimé (L7) |
| `PUT /v1/citizen/requests/{id}/notification-preferences` | `request:<id>` (+ `g`) | `{ channels: { email: boolean } }` | préférence de l'invité pour cette demande |
| `POST /v1/citizen/notifications/unsubscribe` | non (le jeton de désinscription est la preuve) | `{ token }` | invité : coupe et rend `{ kind: "invite" }` ; compte : rend `{ kind: "compte", contact_id }` sans rien écrire. Réponse uniforme si le jeton est invalide (`404` unique) |
| `GET /v1/citizen/requests/{id}` (+) | inchangé | — | champ additif `notifications: { email: boolean }`, pour l'invité seulement |

- **Règles** : champ inconnu ⇒ 400 (motif `handleCitizenMessage`) ; un portail qui ne pousse
  rien reste en *fail open*.
- **Livrables** : `openapi.ts` passe en 2.10.0, entrée append-only dans
  [`api-changelog.md`](api-changelog.md), section dans [`api-ingestion.md`](api-ingestion.md).
- **Nora pousse la préférence** : au rattachement de la fiche, à chaque changement de
  préférence, au changement d'adresse du compte, et **à chaque ouverture de session**
  (idempotent). Ce dernier point répare la copie si le poivre a tourné ou si une poussée a été
  perdue. [Supposé] À valider côté Nora.

---

## 4. Flux de bout en bout

### Cas A — compte (Sceaux, interrupteur allumé)

1. Nora rattache la fiche, puis pousse `PUT …/contacts/{c}/notification-preferences
   {email:true}` avec un jeton dont `e` est l'adresse du compte. Iris enregistre
   `citizen_space_links` avec `HMAC(e)`.
2. Un agent met la demande en attente. Le trigger t41 enfile `pending`
   (`events:[en_instruction→en_attente]`, `due_at = +10 min`) et initialise `known_status`.
3. Au plus tard une minute après `due_at`, le facteur réclame la ligne :
   - accusé réglé ;
   - `attente_information` retenu ;
   - fiche Socle relue, `HMAC(adresse)` égal ⇒ canal compte ;
   - préférence vraie ;
   - courriel « En attente de votre réponse », lien vers l'espace (gabarit si présent), lien de
     désinscription Nora, charte de l'organisme porteur ;
   - `request_emails` (`nature avis`), `known_status = en_attente`, `sent`.
4. L'agent écrit à l'usager. L'aperçu annonce « avis avec lien ». À l'envoi : message
   `delivery espace` visible tout de suite dans l'espace, avis enfilé, puis avec extrait
   d'environ 140 caractères dix minutes plus tard.
5. L'usager répond en ligne. `record_citizen_message` pose `iris.reprise_usager` : t41 n'enfile
   rien, `known_status = en_instruction`.

### Cas B — invité (dépôt portail avec suivi accepté)

1. Au dépôt : `register_request_access` (existant), avec `tracking_url` et `notify_email` vrai
   par défaut.
2. Transition : même file. Le facteur ne trouve pas de canal compte, prend le canal invité
   (accès ouvert, adresse déclarée vérifiée contre l'empreinte) et envoie le lien
   `tracking_url`.
3. Lien de désinscription : page Nora, puis `POST /v1/citizen/notifications/unsubscribe`, puis
   `notify_email = false`. La transition suivante donne `skipped: preference`. Les autres
   demandes ne sont pas touchées.
4. Message de l'agent : `to_email` = adresse déclarée (le canal invité la voit),
   `delivery espace`, avis vers `/suivi`.

### Cas C — guichet, usager sans compte

1. Création par `create-request-from-procedure`, accusé comme aujourd'hui. Aucun
   `request_access_codes` (B13), aucun lien d'espace.
2. Transition : enfilée, puis `skipped: aucun_acces_en_ligne`, lisible par l'agent.
3. Message de l'agent : l'aperçu annonce « message complet ». Envoi synchrone actuel
   (`delivery courriel`).
4. Résolution : avis de clôture inchangé.
5. *Variante* : si cet usager crée plus tard un compte rattaché à sa fiche, la demande du
   guichet (`citizen_visible` vrai) passe au cas A.

---

## 5. Plan de livraison

Ordre impératif : **migration avant fonction**, et l'**exclusion des avis dans la vue usager
avant le premier avis**.

| Lot | Contenu | Dépend de |
|---|---|---|
| **L4c-0** — préalable, Iris seul | Migration `request_emails.nature` et `delivery` ; `citizenView` exclut `avis` ; redéploiement de `requests-api` ; test contrat et `citizenView.test.ts`. Sans effet visible | — |
| **L4c-1** — file des statuts | Migration : `citizen_notification_settings` (éteint partout), `request_citizen_status`, `citizen_notices`, trigger t41 avec les drapeaux, RPC enqueue / claim / start / settle / skip, RPC de statut connu ; `record_citizen_message` pose le statut connu. Modules purs `events.ts`, `decision.ts`, `channel.ts`, `unsubscribe.ts`, `_shared/email/avisUsager.ts`. `notifications-mailer/citizenNotices.ts`. Mode `cloture` de `send-request-email` qui avance le statut connu. Bloc Paramètres pour l'interrupteur. Recette de seed (`iris.silence_usager`) | L4c-0 |
| **L4c-2** — contrat 2.10.0 | Routes §3, colonnes `integration_sources` et `request_access_codes`, `citizen_space_links` ; OpenAPI, changelog, `api-ingestion.md` | L4c-1 (migration) |
| **L4c-3** — M2 | `send-request-email` : `delivery`, mode `apercu`, enfilement de l'avis de message ; composeur bureau et mobile avec annonce ; onglet Échanges : avis automatiques et raisons des non-envois (lecture de `citizen_notices`) | L4c-0, L4c-1 |
| **L4c-4** — Nora (+ Socle, ADR-14) | Confirmer / modifier l'adresse de courriel avec alignement de la fiche Socle (évolution contacts-api à coordonner avec la session Socle) ; préférence par espace (colonnes sur `citizen_spaces`, une par canal), écran, poussées (rattachement, changement, adresse, session, suppression), `PUT /v1/citizen/space`, page de désinscription + point `List-Unsubscribe-Post`, interrupteur invité dans `/suivi` (facultatif en V1) | L4c-2 |
| **L4c-5** — mise en service | Allumer l'interrupteur de Sceaux après vérification réelle des critères d'acceptation 1 à 17 du cadrage | L4c-3, L4c-4 |
| Second temps | `citizen_notification_event_settings` et écran par collectivité, puis par démarche ; SMS ; avis de clôture par la file | — |

- **Socle** : rien de L4c-0 à L4c-3 ; une évolution additive de contacts-api pour L4c-4 (ADR-14), à coordonner avec la session Socle en cours.
- **Ordre du facteur** : déployer `notifications-mailer` (L4c-1) avant d'allumer quoi que ce
  soit. Le facteur doit embarquer les nouveaux fichiers `_shared` (piège connu : la CLI
  d'abord).
- **Tests** :
  - SQL sur PGlite (`requests-api/espace-usager/harness/irisDb.ts`, nouveau
    `notifications-usager.sql.test.ts`) : t41 se tait (interrupteur, Clara, silence, reprise) ;
    fusion sur la ligne `pending` unique ; claim concurrent ; temporisation et abandon ; accusé
    d'abord ; statut connu ; révocations ; aucune surface cliente ;
  - modules purs (vitest) : matrice `citizenEventFor` sur toutes les paires de statuts,
    `shouldSend`, `channel` (priorité, adresse différente, masquée, expirée), extrait (coupure
    sur un mot, 140 caractères, jamais au-delà), aller-retour du jeton de désinscription et
    refus d'un jeton falsifié, composition (ni objet saisi, ni motif, ni nom d'agent, ni
    pièce) ;
  - contrat (`citizen.contract.test.ts`) : routes 2.10.0, `e` pris du jeton et jamais du corps,
    avis absent de la vue usager.

---

## 6. Risques

- **Comptes mal notifiés** : une fiche Socle avec une autre adresse que le compte, ou sans
  adresse, ne reçoit rien (tracé `adresse_compte_differente`). Ce peut être fréquent si Nora ne
  fait pas converger les deux adresses. Signal dans Nora recommandé.
- **Changement de comportement livré** (M2) : le courriel complet de l'agent disparaît pour qui
  a un accès. Atténué par l'annonce dans le composeur et par l'interrupteur.
- **Fenêtre de dix minutes de M2** : accès coupé ou compte retiré entre la publication et
  l'avis, donc lien mort. Rare et tracé.
- **Extrait** : environ 140 caractères peuvent porter une donnée personnelle. Décision PO
  assumée.
- **Rotation de `IRIS_ACCESS_CODE_PEPPER`** : elle invalide les empreintes d'accès **et** de
  comptes. La poussée à chaque session répare les comptes, pas les invités (dette existante).
- **Quotas SMTP des villes** : plusieurs courriels par demande. À mesurer avant 100 000 comptes.
  La délivrabilité dépend de `List-Unsubscribe`.
- **Démonstrations** : un tenant allumé avec un script qui oublie `iris.silence_usager`
  écrirait vraiment. Les seeds par API envoient déjà des accusés (hors B12).
- **Dépendance Nora** : sans page de désinscription, l'invité ne peut pas refuser (CCTP 5.4).
  D'où la mise en service en L4c-5 seulement.
- **Lecture du Socle à l'envoi** (fiche du jour) : si le Socle est muet, on se replie sur le
  snapshot. [Supposé] À trancher dans `channel.ts` : sans fiche relue, pas de canal compte (on
  ne compare pas une adresse périmée), le canal invité reste possible.

## 7. Questions posées au PO — toutes acceptées le 2026-10-24 (recommandations retenues)

1. **Une demande soustraite (`citizen_visible = false`) reste lisible en `/suivi` par son
   invité** (constat 0.1). Faut-il fermer aussi `/suivi` ? *Recommandation : oui, dans un
   correctif séparé de `citizenAccessible`. En attendant, aucun avis de statut sur une demande
   soustraite, quel que soit le canal.*
2. **Compte dont l'adresse diffère de la fiche Socle** : aucun avis, avec une trace. Accepté ?
   *Recommandation : oui, et Nora signale l'écart à l'usager.*
3. **M2 soumis au même interrupteur que les statuts** (éteint = comportement actuel) ?
   *Recommandation : oui.*
4. **Désinscription d'un compte** : le lien coupe la préférence de l'espace (toutes les demandes
   de cette collectivité), et non la seule demande. *Recommandation : oui. Seul l'invité
   désinscrit par demande.*
5. **Délai de l'avis « nouveau message »** : même fenêtre de 10 min que les statuts, pour
   permettre la fusion ? *Recommandation : oui. Le message est lisible dans l'espace dès sa
   publication.*
6. **Extrait** : sauter une première ligne de salutation (« Bonjour Madame X, ») pour que les
   140 caractères portent le fond ? *Recommandation : oui, si la première ligne finit par une
   virgule.*

## 8. Fichiers lus

- `docs/notifications-usager.md`, `docs/emails.md`, `src/features/notifications/CLAUDE.md`,
  `src/features/requests/statuts.ts`
- `supabase/migrations/20261009100000_accuse_reception_usager.sql`,
  `20261019150000_acces_usager_invite.sql`, `20261020150000_espace_usager_mes_demandes.sql`,
  `20261021090000_acces_invite_renvoi_coupure.sql`, `20261021120000_reponse_usager.sql`,
  `20261024100000_reponse_usager_suites_po.sql`, `20261016120000_demandes_liees_fondations.sql`,
  `20260826120000_echanges_usager.sql` (`request_emails`)
- `supabase/functions/requests-api/index.ts` (§ 843–1236), `_shared/citizenView.ts`,
  `_shared/citizenToken.ts`, `supabase/functions/send-request-email/index.ts`,
  `_shared/email/destinataire.ts`
- Nora : `supabase/migrations/20261019120000_*`, `20261020090000_*`, `20261020160000_*`,
  `supabase/functions/_shared/iris/citizenToken.ts`, `mesDemandesService.ts`

**Non lus, supposés** : la structure interne de `notifications-mailer/receipts.ts` (sa forme est
déduite des RPC), l'écran Paramètres, `docs/data-model.md` dans le détail, et le Socle. La
conception n'a pas besoin du Socle.
