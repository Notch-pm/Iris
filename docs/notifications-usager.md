# Notifications à l'usager — note de cadrage B12 / lot L4c

*Projet Sceaux, espace usager. Note de cadrage rédigée le 2026-10-24 (analyse métier) pour
décision du PO — **rien n'est codé**. Public : le PO, puis l'architecture et l'implémentation
une fois les questions du § 5 tranchées. Entrée du backlog : [`backlog.md`](backlog.md) B12.*

Convention : **[Lu]** = constaté dans un fichier (chemin donné). **[Supposé]** = déduction ou
hypothèse à confirmer.

---

## 1. Contexte et sources

### 1.1 Ce que demande le PO

[Lu] [`backlog.md`](backlog.md), B12 :

- un courriel à l'usager à chaque changement de statut et à chaque nouveau message de l'agent ;
- désactivable, préférence **propagée par Nora**, activé par défaut ;
- **le contenu n'est jamais dans le courriel**, seulement un lien vers l'espace ou `/suivi` ;
- l'accusé de réception reste obligatoire ; les demandes `source = 'clara'` sont a priori
  exclues ;
- accord du 2026-10-24, avec une exigence pour plus tard : pouvoir choisir **quels changements
  de statut** déclenchent un courriel. La V1 peut tout envoyer, mais le modèle (file, contenu,
  préférence) ne doit pas fermer cette porte.

### 1.2 Le CCTP de Sceaux

[Lu] `Notch/Sceaux/cctp/26AS02-CCTP_GRU.txt` :

- **§ 5.4 « Notification »** : « L'usager reçoit une notification par courriel de l'état
  d'avancement de ses demandes en cours/déposée. Il doit avoir la possibilité de désactiver ses
  notifications/alertes et/ou de refuser d'être alerté par l'un des canaux mentionnés. »
  - L'obligation porte sur l'**état d'avancement**, par **courriel**.
  - Le refus doit pouvoir se faire **par canal**. Or aucun autre canal n'est « mentionné » au
    § 5.4 : la formule suppose plusieurs canaux sans les nommer.
- **§ 5.1** : dépôt possible sans compte. Les données obligatoires d'un compte incluent
  « courriel **ou** numéro de téléphone mobile ». Un usager peut donc avoir un compte **sans
  adresse de courriel**.
- « une demande de type démarche en ligne amène une réponse courriel » : c'est la
  justification de l'avis de clôture actuel.
- **SMS** : cité seulement pour les rendez-vous (confirmation « par email et/ou par SMS », SMS
  aux usagers en liste d'attente) et comme démarche « S'inscrire aux alertes SMS ». Ce sont des
  alertes de la ville, pas des notifications de demande.
- **§ 4.9** : indicateurs « répondues dans les 5 / 15 jours ». Une notification automatique ne
  doit pas être comptée comme une réponse.

[Lu] `Notch/Sceaux/02-espace-usager.md` :

- E13 « Notification par courriel de l'avancement, désactivable » (CCTP 5.4, lot L4).
- § 3.1 : préférences du compte dans **la base Nora**, consentements de la personne au
  **Socle**.
- § 3.5, deux points :
  - ce que l'usager lit de chaque statut : `a_traiter` « Envoyée », `en_instruction` « En cours
    de traitement », `en_attente` « En attente de votre réponse », `resolue_*` « Traitée »,
    `annulee` « Annulée », `archivee` « Archivée » ;
  - « Les courriels sortants de l'agent ne contiennent pas le contenu sensible, seulement un
    lien vers l'espace ou /suivi : "Vous avez un nouveau message" ».

[Lu] `Notch/Sceaux/03-avancement.md` : L4c pas commencé. « Notifications activées par défaut »
est un choix L4 que le PO n'a pas contesté.

[Lu] `Notch/Sceaux/01-bilan-cctp.md` : Ariane sait envoyer des SMS, réutilisables (Ariane est
en sommeil).

### 1.3 Ce qui existe dans Iris

- [Lu] `src/features/requests/statuts.ts` : 7 statuts et leur matrice de transitions.
  - Depuis `a_traiter` : instruction, clôture négative, annulation.
  - Depuis `en_instruction` : attente, deux résolutions, annulation, retour à `a_traiter`.
  - Depuis `en_attente` : instruction, annulation.
  - Depuis un statut terminal : réouverture, archivage.
  - Depuis `archivee` : trois désarchivages.
- [Lu] [`emails.md`](emails.md), trois envois existants :
  - **Accusé de réception** : file `request_receipts` vidée chaque minute par
    `notifications-mailer`. Jamais pour Clara. Le contenu du formulaire n'y figure pas.
    Destinataire = fiche Socle relue, à défaut le snapshot.
  - **Avis de clôture** : **synchrone, lancé par le navigateur** après la transition
    (`send-request-email`, `kind: "cloture"`). Il reprend le **commentaire de clôture**, donc du
    contenu. Jamais pour Clara. Résidu connu, déjà noté : si le navigateur meurt, l'avis ne part
    pas.
  - **Nouveau code d'accès** : file `request_access_mails`. Destinataire = **adresse déclarée**
    seulement.
- [Lu] [`emails.md`](emails.md) et `src/features/requests/CLAUDE.md` « Échanges » : **le
  message de l'agent part aujourd'hui par courriel avec tout son contenu et ses pièces
  jointes**, en synchrone, à l'adresse de la fiche Socle du jour.
- [Lu] [`data-model.md`](data-model.md) :
  - `request_citizen_messages` : une réponse de l'usager remet `en_attente` en `en_instruction`,
    et ce retour ne produit pas de `status_changed` (B11) ;
  - `request_access_codes` : `tracking_url` pour chaque demande, coupure, expiration 90 jours
    après la clôture ;
  - `request_access_mails`.
- [Lu] [`api-changelog.md`](api-changelog.md) :
  - 2.6.0 : `guest_access.tracking_url` existe **seulement** pour un dépôt API avec suivi
    accepté ;
  - 2.7.0 : `requests.citizen_visible` (Clara masquée par défaut, n'importe quelle demande peut
    être soustraite) et « Mes demandes » par `socle_contact_id` ;
  - 2.9.0 : messages des deux sens, et « un lecteur ne voit que les messages écrits par SON
    canal ».
- [Lu] `src/features/notifications/CLAUDE.md` : doctrine agents.
  - La base est le seul producteur.
  - Une ligne sert de boîte d'envoi, vidée par cron ; on n'envoie jamais depuis le déclencheur.
  - *Fail open* : sans préférence, tout part.
  - Jamais de notification pour son propre geste.
  - 5 tentatives, temporisation 2/4/8/16 min.
- [Lu] [`demandes-liees.md`](demandes-liees.md) : à la résolution commune, **l'agent choisit
  sur le moment** de prévenir ou non les usagers des demandes liées.
- [Lu] Socle `supabase/migrations/20260913100000_contacts_consentements_rgpd.sql` :
  - `contact_consents.kind ∈ ('traitement','partage')` ;
  - `consent_email`/`consent_sms` gardés mais obsolètes (« conservés pour Clara seule »).

### 1.4 Nora

[Lu] Le dépôt existe : `Notch/Nora`.

- Tables du compte (`20261019120000_espace_usager_sessions.sql`,
  `20261020090000_espace_usager_comptes.sql`) : `citizen_accounts`,
  `citizen_spaces(account_id, tenant_id, socle_contact_id)` (un espace par collectivité),
  `citizen_sessions`, `citizen_totp`, `citizen_cgu_acceptances`, etc.
- **Aucune préférence de notification n'existe encore.** `README.md` : « L4c — notifications à
  l'usager (désactivables) : à faire ».
- `accountService.ts` n'envoie que des avis de sécurité du compte (mot de passe, TOTP).

[Supposé] Le bon endroit d'une préférence côté Nora est l'**espace** (compte × collectivité),
pas le compte global : une préférence donnée à Sceaux n'a pas à valoir à Antony.

### 1.5 Ce qu'Iris ne sait pas aujourd'hui (constat qui structure toute la note)

1. **Iris ne sait pas si l'usager d'une demande a un compte Nora.** Il connaît
   `socle_contact_id` et, pour un invité, la ligne `request_access_codes`. [Supposé] Le
   rattachement compte ↔ fiche vit au Socle (`contact_external_references`, `portail_citoyen`)
   et dans `citizen_spaces` chez Nora. Iris ne le lit pas.
2. **Iris ne connaît aucune URL de « Mes demandes »** pour un compte. Il ne connaît que
   `tracking_url`, propre à chaque demande invitée.
3. **Un dépôt au guichet n'a aucun accès en ligne**, sauf compte rattaché. [Lu]
   `guest_access` n'existe qu'à l'ingestion API. Pour cet usager, un courriel « consultez votre
   espace » renverrait vers une porte qu'il ne peut pas ouvrir.

---

## 2. Les questions instruites

### Q1. Usagers sans compte (guichet, accès invité)

| Cas | Accès en ligne aujourd'hui |
|---|---|
| A. Dépôt portail **avec** suivi accepté (code) | `/suivi` (courriel + référence + code), tant que l'accès n'est ni coupé ni expiré |
| B. Dépôt portail **sans** suivi, ou dépôt au guichet, usager **sans** compte | aucun |
| C. Usager avec compte, demande rattachée à sa fiche et visible (`citizen_visible`) | « Mes demandes » |

**Options**

1. Envoyer à tous ceux qui ont une adresse.
2. N'envoyer qu'à ceux qui **ont un accès en ligne** (A et C).
3. Ouvrir un accès invité au guichet pour couvrir B.

**Recommandation : 2 en V1, 3 en question séparée.**

- Un courriel qui ne dit rien (le contenu est exclu) et dont le lien n'ouvre rien est du bruit.
  Il pousserait aussi l'usager à appeler la mairie.
- Le cas A a **déjà accepté** le suivi (case opt-in). L'envoi y est cohérent.
- Le cas B reçoit déjà l'accusé et l'avis de clôture : début et fin, qui sont l'essentiel de la
  réponse courriel du CCTP.

**Comment refusent les invités (A)** : un **lien de désinscription en un clic** dans chaque
notification, sans connexion, valable **pour cette demande**. Le CCTP 5.4 ne distingue pas
compte et invité : l'invité doit aussi pouvoir refuser. Seul un lien le permet, puisque
l'invité n'a pas de préférence où écrire.

**Ce que dit le CCTP** : § 5.4 vise « l'usager », sans distinction. § 5.1 rend le dépôt sans
compte obligatoire. Avec la recommandation, un usager B n'est « notifié » que par l'accusé et
l'avis de clôture. C'est un écart à argumenter, ou à combler par l'option 3 (question PO n° 3).

### Q2. La préférence

**Préférence ≠ consentement.**

- Les consentements `traitement` / `partage` sont des **bases RGPD** : preuve immuable, phrase
  consignée, propriété du Socle par personne, recueillis au dépôt.
- La préférence est un **réglage de confort**, modifiable à tout moment, sans valeur de preuve.
- Elle ne doit **ni** entrer dans `contact_consents`, **ni** reprendre
  `consent_email`/`consent_sms`. Ces colonnes sont obsolètes et ont un autre sens chez Clara.
- Elle ne conditionne pas l'envoi des messages *obligatoires* : accusé, avis de clôture,
  message de l'agent (voir Q4).

**Granularité.**

- Le CCTP 5.4 exige deux choses : « désactiver ses notifications » et « refuser l'un des
  canaux ». Il n'exige pas de choix par événement.
- **Recommandation V1** : un interrupteur par canal, avec **un seul canal en V1**, le courriel.
  Libellé indicatif : « Me prévenir par courriel de l'avancement de mes demandes ». Le modèle
  porte toutefois le **canal** dès maintenant, pour que le SMS n'oblige à rien refaire.
- Pas de choix par type d'événement côté usager. C'est la collectivité qui choisira les statuts
  (Q3). Deux niveaux de tri superposés seraient illisibles.

**Propriétaire.**

- **Nora est propriétaire** de la préférence d'un titulaire de compte : il tient le compte et
  l'écran, et le PO l'a posé.
- Iris en reçoit une **copie poussée** et ne l'écrit jamais lui-même.
- Le Socle n'est pas retenu en V1. Il est propriétaire des consentements, mais une préférence
  n'en est pas un. Le passer par le Socle mobiliserait trois projets là où deux suffisent.
- Le Socle redeviendrait pertinent si d'autres applications de la gamme (Clara) devaient un
  jour notifier l'usager avec la même préférence (question PO n° 5).

**Comment elle parvient à Iris (contrat additif).**

- [Supposé] Une **nouvelle route** du scope `requests:citizen` par laquelle Nora déclare, pour
  une fiche du Socle d'une collectivité :
  - la préférence par canal ;
  - et, au passage, **l'existence de l'espace et son adresse**.
- Cela règle les constats 1 et 2 du § 1.5 : Iris sait qu'un compte existe et quel lien citer.
- Nora pousse à chaque changement et au rattachement. À la suppression du compte (L7), il pousse
  un retrait. Iris retombe alors sur la règle « accès en ligne ? », et sans compte la réponse
  est non.
- Aucun appel d'Iris vers Nora. On garde le sens actuel des flux, sans nouvelle dépendance au
  moment de l'envoi.
- [Supposé] La copie dans Iris est une ligne clé (collectivité, `socle_contact_id`), UUID nu,
  sans identité. Elle ne contredit pas « aucun miroir d'usagers », au même titre que
  `citizen_visible`. **À valider par l'Architecte.**

**Sans fiche Socle** (identité non rapprochée, dépôt invité) : il n'y a pas de préférence de
compte. Seule vaut la **désinscription de la demande** (Q1). Un dépôt anonyme ne reçoit rien.

**Défaut** : *fail open* pour le compte (aucune préférence reçue = envoi), conforme au cadre du
PO et à la doctrine des agents. La préférence est évaluée **au moment de l'envoi**, pas de la
mise en file : le dernier souhait de l'usager l'emporte.

### Q3. Configuration par statut (second temps)

**Niveau.**

- **Collectivité** pour le réglage par défaut, **démarche** pour l'exception. Le besoin réel de
  Sceaux est de régler par pôle et par démarche : un signalement voirie n'appelle pas les mêmes
  avis qu'un permis de végétaliser.
- **Pas l'organisme** : l'usager ne sait pas quel service traite sa demande, et le transfert
  changerait la règle en cours de route.

**Qui règle.** Un **administrateur Iris**, dans les Paramètres, comme les réglages « Demandes
liées » par démarche (`procedure_link_settings`). Les statuts sont un concept d'Iris. Le Socle
ignore ce qu'est une transition, et lui faire porter ce réglage brouillerait la frontière.

**Ce que la V1 doit prévoir pour ne rien fermer.**

1. Raisonner en **« événements usager »** nommés (prise en charge, attente d'information,
   reprise, annulation, réouverture…), pas en couples bruts (de, vers). Le futur réglage coche
   des événements que l'usager comprend.
2. Une **seule règle de décision** « cet événement ouvre-t-il un envoi ? ». En V1 elle répond
   selon un défaut fixe ; plus tard elle lira le réglage.
3. **Tracer chaque événement éligible, même non envoyé**, avec sa raison : réglage, préférence,
   pas d'accès, pas d'adresse, Clara, masquée. Sans cela, on ne saura jamais répondre à
   « pourquoi n'ai-je rien reçu ? ».
4. Un **interrupteur par collectivité** dès la V1 (question PO n° 2). C'est la première brique
   du réglage, et il évite d'écrire du jour au lendemain aux usagers de tenants hors Sceaux.

### Q4. Quels événements exactement

**Statuts** : défaut V1 recommandé (« envoyer à chaque changement » ne convient pas tel quel,
voir la colonne Raison).

| Transition | Ce que lit l'usager | V1 | Raison |
|---|---|---|---|
| `a_traiter` → `en_instruction` | Envoyée → En cours de traitement | **Envoyer** | Première preuve qu'un agent s'en occupe. Le PO la cite comme « peut-être pas » : candidate n° 1 au futur réglage |
| `en_instruction` → `en_attente` (geste de l'agent **ou** pièce déclarée non conforme) | En attente de votre réponse | **Envoyer** | L'événement le plus utile : l'usager doit agir |
| `en_attente` → `en_instruction` par un agent | En cours de traitement | **Envoyer** | Le libellé change |
| `en_attente` → `en_instruction` par **la réponse de l'usager** | idem | **Ne pas envoyer** | C'est son geste (miroir de « jamais pour son propre geste » et de B11) |
| `en_instruction` → `a_traiter` (renvoi à qualifier) | En cours → Envoyée | **Ne pas envoyer** | Un aller-retour interne. Pour l'usager, c'est un recul incompréhensible |
| → `resolue_positive` / `resolue_negative` | Traitée | **Pas de notification** : l'**avis de clôture** en tient lieu | Ne jamais envoyer deux courriels pour une résolution |
| → `annulee` | Annulée | **Envoyer** (sans le motif) | Aujourd'hui une annulation ne prévient personne. L'usager doit savoir que sa demande est close |
| terminal → `en_instruction` (réouverture) | Traitée/Annulée → En cours | **Envoyer** | L'usager croyait l'affaire close |
| terminal → `archivee`, désarchivage | Archivée / … | **Ne pas envoyer** | Geste administratif |
| Transfert d'organisme (pas un statut) | inchangé | **Ne pas envoyer** | Le libellé usager ne change pas |

**Recouvrement avec l'avis de clôture.**

- L'avis est la **réponse** (CCTP), pas une notification. Recommandation : il reste tel quel,
  **non soumis à la préférence**, et la résolution ne produit aucune notification de statut.
- Si l'agent choisit de **ne pas prévenir** à la résolution commune, rien ne part non plus : son
  choix est respecté.
- À noter : l'avis porte le commentaire de clôture, donc **du contenu**. C'est une exception
  héritée (décision du 2026-08-28) que la règle « jamais de contenu » de B12 ne remet pas en
  cause sans décision expresse (question PO n° 8).
- Son résidu « navigateur mort » gagnerait à passer par la même file (second temps, hors
  périmètre).

**Recouvrement avec le message de l'agent (le vrai point dur).**

- Aujourd'hui le message de l'agent **est** un courriel avec tout son contenu et ses pièces. Une
  notification « vous avez un nouveau message » par-dessus ferait **deux courriels pour un
  message**.
- Or le plan Sceaux (02 § 3.5) et le cadre B12 (« jamais de contenu ») visent au contraire :
  **contenu dans l'espace, courriel = lien seul**.

Options :

- **M1 – Statu quo.** Courriel complet, aucune notification en plus. La moitié « message » de
  B12 est vide, et la règle « pas de contenu » n'est pas tenue.
- **M2 – Lien seul pour qui a un accès en ligne.**
  - Le message vit dans l'espace ou `/suivi`, et le courriel dit seulement « nouveau message »
    avec un lien.
  - Un usager **sans** accès en ligne (cas B, demande masquée, Clara exclue de toute façon)
    garde le courriel complet, faute de quoi il ne recevrait jamais le message.
- **M3 – Courriel complet ET notification.** Rejetée : doublon.

**Recommandation : M2**, avec quatre conditions :

- (a) l'avis « nouveau message » **n'est pas désactivable**. C'est la remise d'un échange, pas
  une notification d'avancement : le CCTP 5.4 vise l'avancement, et une demande de pièce perdue
  bloque le dossier ;
- (b) le composeur **annonce à l'agent** la forme qui partira (« l'usager recevra un avis avec
  lien vers son espace » ou « l'usager recevra le message complet ») ;
- (c) l'avis part à une adresse dont le canal **voit** le message (2.9.0 : chaque canal ne voit
  que ses messages). Sinon on retombe sur le courriel complet (voir Q5, adresse changée) ;
- (d) même règle pour toutes les entrées : bureau, mobile, signalement de non-conformité,
  nouveau code exclu.

C'est un **changement de comportement du parcours agent** livré et vérifié le 2026-08-26. D'où
la question PO n° 1.

### Q5. Cas limites

- **Rafales** (attente puis reprise en deux minutes, prise en charge juste après le dépôt) :
  - différer chaque envoi de quelques minutes (ordre de 10 min, à fixer) ;
  - n'envoyer que l'**état final** s'il diffère du dernier état notifié, et rien si l'on est
    revenu au dernier état notifié ;
  - un changement de statut et un message dans la même fenêtre pour la même demande donnent
    **un seul** courriel qui annonce les deux ;
  - aucune notification ne part **avant** l'accusé de réception de la demande.
- **Résolution commune** : un avis par demande et par usager (choix de l'agent, Q4). Un usager
  qui a plusieurs demandes dans le même groupe reçoit un avis par demande. C'est acceptable en
  V1, à regrouper plus tard si besoin.
- **Transfert** : aucun envoi (Q4). La charte du courriel suit l'organisme porteur **au moment
  de l'envoi**, déjà résolue côté Socle.
- **Demande soustraite** (`citizen_visible = false`, hors Clara) : **aucune notification de
  statut**. Le lien n'ouvrirait rien, et la soustraction a souvent une raison de
  confidentialité. Le message de l'agent part en courriel complet (M2, faute d'accès).
  [Supposé] Non vérifié : `citizen_visible` borne-t-il aussi la vue invitée (`/suivi`) ? **À
  confirmer**, car cela change le cas A.
- **Demande issue de Clara** : exclue, même rendue visible. Clara tient la relation, comme pour
  l'accusé et l'avis (question PO n° 6).
- **Dépôt anonyme ou sans adresse** : rien ne part, et c'est tracé comme tel.
- **Adresse changée dans le Socle depuis le dépôt** :
  - compte : on suit la **fiche du jour** (règle `destinataire.ts`) ; si la fiche n'a plus
    d'adresse, rien ne part, sans « ressusciter » l'ancienne ;
  - invité : seulement **l'adresse déclarée**, la seule qui ouvre `/suivi`, comme le nouveau
    code ;
  - un usager à la fois compte et invité sur la même demande : le compte prime. [Supposé] À
    confirmer.
- **Accès invité coupé ou expiré** (90 jours après la clôture) : plus aucune notification par ce
  canal. La réouverture d'une demande close depuis plus de 90 jours n'a donc pas de lien invité.
  [Supposé] Recommandation : rien par ce canal, l'agent peut envoyer un nouveau code.
- **Échec d'envoi** :
  - même discipline que les files existantes : 5 tentatives, abandon franc ;
  - trace dans l'onglet Échanges (« Iris · envoi automatique ») ;
  - jamais d'effet sur la transition ;
  - l'abandon reste lisible par l'agent.
- **Usager à plusieurs fiches** (doublons connus) : la préférence ne vaut que pour la fiche
  rattachée à l'espace.
- **Suppression du compte (L7)** : retrait de la préférence. La demande n'a plus d'accès en
  ligne, sauf code invité, donc plus d'avis.
- **Jeux de démonstration et scripts** : une transition jouée sur un jeu de démo écrirait à de
  vraies adresses (piège déjà vécu avec le jeu SNA27). **Exigence** : un moyen sûr qu'aucun jeu
  de démonstration n'écrive à personne.
- **Indicateurs CCTP § 4.9** : une notification automatique n'est **jamais** comptée comme une
  « réponse ».
- **Quotas SMTP des villes** : 02-espace-usager dit « il faut connaître les quotas ». Le volume
  de B12 est de plusieurs courriels par demande : à mesurer avant d'ouvrir le service à 100 000
  comptes.

### Q6. SMS

- **Le CCTP n'exige pas le SMS pour les notifications de demande.** Il exige le courriel et le
  refus par canal (5.4). Il cite le SMS pour les rendez-vous (PSE) et une démarche d'alertes.
- **À signaler** : le CCTP 5.1 autorise un compte **sans courriel** (mobile seul). Avec des
  notifications par courriel uniquement, cet usager ne serait jamais prévenu. Un écart à
  argumenter dans la réponse, ou une raison de prévoir le SMS.
- **Recommandation** :
  - écarter le SMS de la V1, mais porter le canal dans le modèle (préférence par canal, trace
    par canal) ;
  - le composeur affiche déjà « SMS » grisé (`SOON`) ;
  - au second temps, instruire fournisseur, coût et qui paie, texte encore plus court que le
    push (écran verrouillé), et le réemploi éventuel d'Ariane.

---

## 3. Périmètre proposé

### V1 (L4c)

- Notifications de statut **selon le tableau de Q4** : défaut fixe, interrupteur par
  collectivité.
- Destinataires : usagers **avec accès en ligne** seulement (compte rattaché et demande
  visible, ou accès invité ouvert).
- Préférence de compte poussée par Nora (canal courriel), *fail open*, évaluée à l'envoi.
- Désinscription par demande en un clic, dans chaque notification.
- Message de l'agent : **M2** si le PO l'accepte (lien seul, non désactivable, avec une adresse
  qui voit le message), sinon **M1**.
- Contenu du courriel :
  - figuré : référence, nom de la démarche, libellé du statut **pour l'usager**, lien vers
    l'espace ou `/suivi`, lien de désinscription, charte de la collectivité ;
  - exclu : objet saisi, commentaire, motif, nom de l'agent, contenu d'un message.
- File asynchrone avec regroupement des rafales, et trace de chaque décision (envoyé, non envoyé
  avec sa raison).
- Exclusions : Clara, soustraites, anonymes, sans adresse, accès coupé ou expiré.

### Second temps

- Réglage par collectivité puis par démarche des événements envoyés (Paramètres Iris) —
  **exigence du PO du 2026-10-24**.
- Canal SMS.
- Avis de clôture passé par la même file (fin du résidu « navigateur mort »).
- Accès invité ouvert au guichet (si n° 3 = oui).
- Préférence au Socle commune à la gamme (si n° 5 = oui).
- Regroupement de plusieurs demandes d'un même usager dans un seul courriel.

---

## 4. Critères d'acceptation de la V1 (testables)

1. Une transition `en_instruction` → `en_attente` sur une demande d'un usager avec compte
   rattaché, demande visible, sans préférence reçue : **un** courriel part dans le délai fixé.
   Il porte la référence, « En attente de votre réponse » et un lien vers l'espace. Il ne porte
   ni commentaire, ni motif, ni nom d'agent, ni contenu de message.
2. Même transition après que Nora a poussé « courriel désactivé » : **aucun** courriel. Une
   trace « non envoyé : préférence » est lisible.
3. Même transition sur une demande invitée (code ouvert) : le courriel part à l'**adresse
   déclarée** et le lien ouvre `/suivi`. Après un clic sur « ne plus être prévenu », la
   transition suivante n'envoie rien. Les autres demandes du même usager ne sont pas touchées.
4. Une demande déposée au guichet par un usager sans compte : aucune notification de statut.
   L'accusé et l'avis de clôture partent comme aujourd'hui.
5. Une résolution, positive ou négative, ne produit **que** l'avis de clôture, jamais une
   notification de statut en plus. La préférence désactivée ne coupe pas l'avis.
6. Une résolution commune avec « Prévenir les usagers » décoché : aucun courriel aux usagers des
   demandes liées.
7. La reprise d'instruction **par la réponse de l'usager** ne lui envoie rien.
8. `en_instruction` → `a_traiter`, archivage, désarchivage et transfert : aucun courriel, trace
   « non envoyé : événement non retenu ».
9. Attente puis reprise en moins de la fenêtre de regroupement : aucun courriel, ou un seul pour
   l'état final s'il diffère du dernier état notifié. Un statut et un message dans la même
   fenêtre donnent un seul courriel.
10. Une demande `source = 'clara'`, même rendue visible, ou une demande soustraite : aucune
    notification de statut, quelle que soit la préférence.
11. Un dépôt anonyme, ou une fiche sans adresse : rien ne part, trace « pas d'adresse ».
12. Un relais SMTP en panne : la transition réussit. Il y a 5 tentatives puis l'échec est
    lisible dans Échanges. Aucun doublon si deux passages du facteur se recouvrent.
13. (Si M2) Un message de l'agent à un usager avec accès en ligne donne **un** courriel
    « nouveau message » avec lien, sans le corps ni les pièces, et le message est lisible dans
    l'espace. Le même geste vers un usager sans accès donne le courriel complet. Le composeur
    annonce la forme avant l'envoi. La préférence désactivée ne coupe pas l'avis de message.
14. Le contrat `requests-api` n'évolue qu'en additif : version mineure et entrée dans
    [`api-changelog.md`](api-changelog.md). Un portail qui ne pousse rien voit l'envoi par
    défaut.
15. Collectivité avec l'interrupteur éteint : aucune notification de statut, rien d'autre ne
    change.
16. Un jeu de démonstration rejoué : aucun courriel réel.
17. Les indicateurs « répondues sous N jours » sont inchangés par les notifications
    automatiques.

---

## Décisions du PO (2026-10-24)

Toutes les recommandations du § 5 sont **retenues**, avec ces précisions :

| N° | Décision |
|---|---|
| 1 | **Oui (M2)**, mais l'avis « nouveau message » porte **les premiers caractères** du message de l'agent — un extrait, jamais le message entier, ni ses pièces. Longueur à fixer à l'implémentation (proposition : ~140 caractères, coupés sur un mot, suivis de « … »). Avis non désactivable. |
| 2 | Interrupteur par collectivité, allumé seulement là où l'espace Nora est ouvert. ⚠️ **Une session travaille en ce moment côté Socle** : ne rien y toucher sans coordination. |
| 3 | Pas d'avis de statut au guichet sans compte en V1 ; l'accès invité au guichet est **conservé au backlog** (B13). |
| 4 à 11 | Recommandations retenues telles quelles. |
| 12 | SMS **hors V1**, noté au backlog (B14) ; le canal reste porté par le modèle. |

⚠️ La décision n° 1 assouplit « le contenu n'est jamais dans le courriel » du cadre B12 : un
extrait du message de l'agent sort. Le reste de la règle tient (ni objet saisi, ni motif, ni
commentaire de statut, ni pièce).

## 5. Questions à trancher par le PO

1. **Message de l'agent** : passer au **lien seul** pour les usagers qui ont un accès en ligne
   (M2), en gardant le courriel complet pour les autres ? Cela change le parcours livré le
   2026-08-26. *Recommandation : oui (M2), avis non désactivable.*
2. **Mise en service par collectivité** : interrupteur par collectivité, éteint ou allumé pour
   les tenants existants (ACCM, Rosny, SNA27) ? *Recommandation : interrupteur, allumé
   seulement là où l'espace usager Nora est ouvert.*
3. **Dépôt au guichet sans compte** : pas d'avis de statut en V1 ? Faut-il ouvrir un accès
   invité au guichet (lot à part) ? *Recommandation : pas d'avis en V1, accès invité au guichet
   à instruire séparément.*
4. **Événements retenus en V1** : valider le tableau de Q4 (prise en charge, attente, reprise
   par un agent, annulation, réouverture : oui ; renvoi à qualifier, archivage, transfert,
   reprise par l'usager : non). *Recommandation : ce tableau.*
5. **Propriétaire de la préférence** : Nora, avec copie poussée à Iris, ou Socle pour toute la
   gamme ? *Recommandation : Nora → Iris en V1.*
6. **Clara rendue visible** : reste exclue des notifications ? *Recommandation : oui, toujours
   exclue.*
7. **Annulation** : prévenir l'usager, sans motif ? Aujourd'hui une annulation ne prévient
   personne. *Recommandation : oui.*
8. **Avis de clôture** : il garde le commentaire (exception à « jamais de contenu ») et reste
   hors préférence ? *Recommandation : oui aux deux.*
9. **Contenu du courriel** : référence + nom de la démarche + libellé du statut, **sans
   l'objet** saisi par l'usager ? *Recommandation : oui. L'objet peut porter des données
   personnelles, et pour le portail il répète la démarche.*
10. **Granularité de la préférence** : un interrupteur par canal (courriel seul en V1), sans
    choix par événement côté usager ? *Recommandation : oui.*
11. **Fenêtre de regroupement des rafales** : quelle durée ? *Recommandation : 10 minutes.*
12. **SMS** : hors V1, canal prévu dans le modèle. Faut-il le signaler dans la réponse au CCTP
    (comptes « mobile seul » du § 5.1) ? *Recommandation : hors V1, à signaler.*

---

## Points à vérifier avant l'architecture (suppositions de cette note)

- `citizen_visible` borne-t-il aussi la vue invitée `/suivi`, ou seulement « Mes demandes » ?
  (§ Q5)
- Comment Iris connaîtra-t-il l'URL de l'espace d'un compte ? Proposition : poussée par Nora
  avec la préférence. (§ 1.5, Q2)
- Une préférence clé (collectivité, `socle_contact_id`) dans Iris est-elle compatible avec
  l'invariant « aucun miroir local d'usagers » ? Lecture proposée : oui, c'est un attribut sans
  identité. **À faire valider par l'Architecte.**
- Quand un usager est à la fois compte et invité sur une demande, lequel prime pour l'adresse et
  le lien ?
- Quotas d'envoi des relais SMTP des villes, avant ouverture à grande échelle.
