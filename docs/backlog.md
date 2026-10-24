# Backlog produit

> **Public** : PO et équipe Iris · **Question traitée** : qu'est-ce qui a été demandé, pas
> encore arbitré, et que faut-il savoir avant de s'y mettre ? · **Dernière mise à jour** :
> 2026-10-21

Ce document porte les demandes **produit** en attente. Il ne double pas
[`dette-technique.md`](dette-technique.md), qui traite de ce qui est **assumé comme dette** :
ici rien n'est en dette, ce sont des fonctionnalités qui n'ont pas encore été demandées pour
de bon.

**Chaque entrée dit ce qu'on sait déjà**, pour que la reprise ne recommence pas l'enquête :
ce qui existe, ce que ça touche, et les questions ouvertes. **Aucune n'est arbitrée** — les
pistes citées sont des pistes, pas des décisions. Une entrée réalisée quitte ce document pour
le `CLAUDE.md` de sa feature.

Consigné le **2026-08-30** sur demande du PO, sans priorisation.

---

## B2 — Retrait de colonnes inutiles dans le kanban

**Ce qui existe.** Le tableau pose **une colonne par statut, les 7**, dans l'ordre du cycle de
vie. Les colonnes finales sont déjà bornées aux 30 derniers jours et portent un lien « voir
toutes les demandes ».

⚠️ **Une décision existante est en travers, à reprendre explicitement** : le `CLAUDE.md` de la
feature écarte une colonne « Clôturées » qui regrouperait les issues, au motif qu'**un dépôt
DEMANDE une transition précise** et qu'une colonne composite ne saurait pas laquelle. Retirer
ou fusionner des colonnes rouvre ce sujet — ce n'est pas un réglage d'affichage.

**Questions ouvertes** : « inutiles » veut-il dire *masquables par l'agent* (préférence
d'écran), *masquées par défaut* (et retrouvées par un bouton), ou *retirées du produit* ? Les
trois ont des conséquences différentes sur le glisser-déposer, seul chemin vers certaines
transitions.

**Touche** : `src/features/requests/tableau/`.

## B3 — Transfert d'une demande d'une collectivité à l'autre

**⚠️ La demande est ambiguë, et les deux lectures n'ont rien à voir.** À clarifier avant tout
chiffrage :

1. **Entre organisations d'un même tenant** (Arles → Saint-Martin-de-Crau) : réaffecter
   `socle_organization_id`. Le trigger `requests_set_scope_org` recalcule `socle_scope_org_id`
   — donc les DROITS — à chaque écriture ; l'agent qui transfère peut ainsi perdre l'accès à la
   demande qu'il vient de déplacer. Faisable, mais ce n'est pas rien.
2. **Entre tenants** (deux collectivités distinctes) : sujet d'**architecture**, pas d'écran.
   Une demande est une pièce administrative — aucune suppression, FK `ON DELETE RESTRICT`
   depuis le tenant — et le RLS est bâti sur le couple (organisation porteuse, démarche). Un
   « transfert » serait vraisemblablement une **clôture pour réorientation d'un côté et une
   création de l'autre**, reliées entre elles (cf. B6), plutôt qu'un déplacement de ligne.

**À trancher d'abord** : de quel transfert parle-t-on ? Et que deviennent le journal, les
pièces et les échanges avec l'usager ?

**Depuis B4 (2026-08-31), un repère** : le PO a tranché, pour la création, que
« collectivité » désignait l'**organisation Socle** du tenant et non le tenant — ce qui
rend la lecture 1 nettement plus probable ici aussi. À confirmer explicitement : ce n'est
pas parce que les deux entrées emploient le même mot qu'elles parlent du même objet.

**Touche** : selon la lecture, `src/features/requests/` seul, ou le modèle de données et
[`architecture-proposee.md`](architecture-proposee.md).

## B9 — Retrait d'un consentement RGPD par l'usager

**Ce qui existe.** Depuis le 2026-09-20, deux consentements sont recueillis **à chaque dépôt**
(traitement, obligatoire ; partage avec les services, facultatif) et consignés à deux endroits :
`requests.consents` (la trace du dépôt, **immuable**) et le référentiel Socle
(`contact_consents` + état dérivé sur la fiche). La fiche usager `/usagers/:contactId` les
**affiche** — état, date, phrase exacte soumise, historique des recueils — mais en **lecture
seule**.

**Ce qui manque.** L'usager qui demande le retrait de son consentement au partage n'a aucun
geste correspondant dans Iris. C'est un droit RGPD (art. 7.3 : le retrait doit être aussi
simple que l'octroi), pas un confort.

**La moitié du chemin est déjà faite, et c'est important pour le chiffrage** : le référentiel
accepte DÉJÀ un retrait. `POST /v1/contacts/{id}/consents` prend `granted: false`, le
consigne comme un recueil de plus, et le trigger `sync_contact_consent_state` met l'état de la
fiche à jour — *à condition* que sa date soit au moins aussi récente que le recueil en place.
Rien à changer côté Socle. Ce qui manque est **côté Iris** : l'écran, et la garde.

**Ce que ça touche.**
- `socle-proxy` : `filterContactUpdate` refuse aujourd'hui toute clé `consent_*`, et le proxy
  n'a **aucune route d'écriture** de consentement. Il en faudrait une, bornée — sûrement pas
  un assouplissement du PATCH d'identité.
- `src/features/contacts/UsagerPage.tsx` (carte « Consentements RGPD ») et
  `src/features/contacts/usager.ts`.

**Questions ouvertes, à trancher avant de coder.**
1. **Qui peut retirer ?** Le droit de création (garde actuelle de toutes les routes
   `/v1/contacts/*`) ? Un droit d'administration ? La question n'est pas neutre : consigner un
   retrait au nom d'un usager engage la collectivité.
2. **Le consentement OBLIGATOIRE se retire-t-il ?** Le retirer ne peut pas effacer les demandes
   déjà déposées — leur trace est immuable, et c'est voulu. Que signifie alors « retirer » :
   une opposition pour l'avenir ? Un signalement à l'agent ? Le laisser retirable sans
   conséquence visible serait pire que de ne pas le proposer.
3. **Quelle preuve du retrait ?** Le `statement` consigné doit dire ce qui a été retiré et à la
   demande de qui — le catalogue actuel ne porte que les phrases d'octroi.
4. **Et Clara ?** Sa fiche contact montre les mêmes consentements du même référentiel. Un
   retrait fait dans Iris y sera visible ; l'inverse aussi le jour où elle le proposera.

**Touche** : `src/features/contacts/`, `supabase/functions/socle-proxy/`. Le catalogue partagé
`supabase/functions/_shared/consents/catalog.ts` porterait les libellés de retrait.

## B5 — Sous-tâches

**Rien n'existe.** À cadrer entièrement.

**Question à poser avant d'écrire une ligne** : une sous-tâche est-elle une **demande** (donc
une pièce administrative, avec référence, statut, RLS et journal) ou un **objet interne léger**
(une case à cocher pour le service) ? Le workflow à 7 statuts est **fixe** (décision PO) : si
une sous-tâche a un cycle de vie, ce n'est pas celui-là — ou ce n'est pas une demande. La
réponse décide de tout le reste : modèle, droits, notifications, statistiques.

## B6 — Liens entre les demandes

> **2026-10-16 — à l'étude, avec B7** : [`demandes-liees.md`](demandes-liees.md) (groupe
> « même incident » sans demande principale, détection serveur, résolution commune). Le
> texte ci-dessous reste le constat de départ.

**Ce qui existe déjà, et qu'il faut regarder avant de concevoir** : la fiche porte des
**demandes liées** (`useLinkRequests`, `useRequestSummaries`), et le parcours de création
détecte les **demandes proches**. Il y a donc une liaison, mais sans qualification.

**Ce qui manque, probablement** : le **type** du lien (doublon, dépendance, suite de,
regroupement), son sens, et ce qu'il entraîne. Un lien « doublon » devrait-il proposer une
clôture ? Un lien « dépend de » devrait-il retenir une résolution ? Sujet voisin de B5 et de
B7 : les trois gagneraient à être cadrés ensemble.

**Touche** : `src/features/requests/` (fiche, création).

## B7 — Résolution groupée

> **2026-10-16 — à l'étude, avec B6** : [`demandes-liees.md`](demandes-liees.md) §1 et §4
> (une transition par demande, résultat partiel, avis au choix de l'agent).

**Ce qui existe.** Les transitions passent toutes par le **dialogue commun** de la fiche, que
le tableau réutilise déjà pour un dépôt. La garde `requests_guard_write` juge **demande par
demande**.

**Le point dur** : une résolution groupée doit rester **une transition par demande côté
serveur** — la garde ne se contourne pas, et « Résolue positivement » exige un passage par
l'instruction ET des pièces obligatoires conformes (`t17`). Certaines demandes du lot seront
donc refusées : l'écran doit annoncer un **résultat partiel** honnête (« 7 sur 12 ») avec le
motif de chaque refus, pas un succès global. Reste aussi à décider le sort de l'**avis de
clôture à l'usager** : douze envois d'un coup, ou aucun ?

**Touche** : `src/features/requests/` (liste, tableau), `send-request-email`.

## B8 — Ergonomie du menu haut (nom de la collectivité)

**Ce qui existe.** Le header reprend le shell de production Clara : wordmark, séparateur, puis
le **tenant** à gauche ; à droite, chip administrateur, superadmin, accès aux Paramètres, menu
compte. Pour un agent membre de plusieurs collectivités, ce nom est aussi le **sélecteur de
tenant**.

**À préciser** : lisibilité du nom, place du sélecteur, ou distinction entre « la collectivité
où je travaille » et « l'organisme qui traite la demande que je regarde » ? La dernière lecture
rejoint le vocabulaire arrêté le 2026-08-30 (« Organisme », cf.
[`../src/features/requests/CLAUDE.md`](../src/features/requests/CLAUDE.md)).

⚠️ Toute reprise du header touche le **DS Notch/Ariane** et la parité avec Clara, qui est
délibérée : lire `CLAUDE.md` § Conventions avant d'y toucher.

## B10 — Pièces envoyées par l'usager en réponse : hors dossier, hors conformité

**Ce qui existe** (lot L4b, 2026-10-21). L'usager qui répond en ligne peut joindre jusqu'à 5
pièces. Elles restent **dans l'échange** (`request_attachments.citizen_message_id`) : visibles
dans l'onglet Échanges, mais ni dans « Pièces de la demande » ni dans la qualification de
conformité — comme les pièces d'un e-mail.

**À trancher par le PO.** Un agent doit-il pouvoir **« verser au dossier »** une pièce reçue en
réponse (elle deviendrait une pièce de la demande, qualifiable, éventuellement en remplacement
d'une pièce non conforme) ? Sans ce geste, le cas le plus courant — « voici la pièce qui
manquait » — oblige à la redéposer à la main. Piste : un geste explicite de l'agent
(instruction), jamais automatique, via `attach_request_piece`.

**Touche** : `EchangesPane`, `record_citizen_message`, `attach_request_piece`.

## B11 — Double notification de l'agent assigné

**Ce qui existe.** Quand l'usager répond sur une demande `en_attente`, `record_citizen_message`
la remet `en_instruction` : l'affectataire reçoit **deux** notifications pour un seul geste —
`status_changed` (le retour en instruction) et `citizen_replied` (la réponse).

**À trancher par le PO.** Garder les deux (chacune dit vrai), ou supprimer `status_changed` pour
ce retour-là (la réponse l'explique déjà) ?

**Touche** : triggers `t40_*` des notifications, `record_citizen_message`.

## B12 — L4c : courriels à l'usager à chaque changement de statut et nouveau message

**Prochain chantier de l'espace usager** (projet Sceaux). Un courriel à l'usager à chaque
changement de statut de sa demande et à chaque nouveau message de l'agent.

Cadre posé par le PO (à confirmer avant de démarrer) :

- **Désactivables** : une préférence de l'usager, **propagée par Nora** (qui tient le compte) ;
  activés par défaut ;
- **Le contenu n'est jamais dans le courriel** : seulement un lien vers l'espace usager ou
  `/suivi` ;
- **L'accusé de réception reste obligatoire** : la préférence ne le coupe pas ;
- à instruire : file dédiée sur le motif de `request_access_mails`, usagers sans compte (pas de
  préférence à lire : toujours envoyés ?), demandes `source = 'clara'` (exclues, comme l'accusé),
  et lien de suivi à citer (`request_access_codes.tracking_url`).

**Touche** : migration (file), `notifications-mailer`, `_shared/email/`, contrat `requests-api`
(préférence), Nora. Ne pas démarrer sans l'accord du PO.

---

## Entrées sorties de ce document

Les numéros ne sont pas réattribués : une entrée traitée laisse son numéro derrière elle, pour
que qui l'a en tête retrouve où elle a atterri.

- **Espace usager — code perdu, coupure d'accès, réponse de l'usager** · livrés le
  **2026-10-21** : lot L4a (contrat 2.8.0 — renvoi du code perdu, coupure et nouveau code par un
  agent ; [`data-model.md`](data-model.md) `request_access_codes` / `request_access_mails`,
  [`emails.md`](emails.md) « Nouveau code d'accès ») et lot L4b (contrat 2.9.0 — l'usager répond
  en ligne ; `request_citizen_messages`). Restent B10 à B12 ci-dessus.

- **B9 — Tableau de bord (page d'accueil)** · arbitrée par le PO le **2026-09-19**, livrée le
  jour même sur le motif de l'accueil de Clara : six cartes (reçues, mises en instruction,
  instruites, et leur M−1 — des FLUX datés par leur jalon, lus par `stats_monthly_flows`
  dans les faits insensibles à la purge), puis deux colonnes — demandes en attente
  d'instruction, demandes affectées à l'utilisateur. Périmètre = ce que le RLS laisse lire,
  aucun filtre d'écran. Détail :
  [`../src/features/dashboard/CLAUDE.md`](../src/features/dashboard/CLAUDE.md).

- **B4 — Sélection de la collectivité à la création** · arbitrée par le PO le
  **2026-08-31**, livrée le jour même. La lecture retenue est celle de l'**organisation
  Socle** (Arles, Saint-Martin-de-Crau, un service…), pas du tenant : les droits sont des
  couples, et « dans ses droits » désignait bien le périmètre des profils. Le parcours de
  création s'ouvre désormais, **pour qui peut créer pour plusieurs organismes**, sur la
  question « pour quel organisme ? » ; l'organisme retenu borne ensuite les démarches
  proposées. Rien n'est pré-sélectionné, et le pré-remplissage silencieux par
  l'organisation de la démarche est supprimé — c'est lui qui faisait atterrir sur la racine
  ACCM des demandes communales, les 15 démarches du tenant y étant rattachées. Un agent
  d'une commune unique ne voit pas la question. Détail :
  [`../src/features/requests/CLAUDE.md`](../src/features/requests/CLAUDE.md) § « Organisme
  d'abord ».

- **B1 — Centrage de la carte et zoom** · arbitrée par le PO le **2026-08-31**, livrée le
  jour même. La carte des interventions se cadre désormais sur l'**étendue des quartiers**
  du territoire (le siège ne sert plus que de repli), et `MIN_ZOOM` est descendu de 12 à
  **4** : une demande hors territoire s'atteint enfin en reculant. Deux planchers distincts
  désormais — ce que l'agent peut demander (`MIN_ZOOM`) et ce que la carte s'accorde seule
  (`TERRITORY_ZOOM`, 12). La piste « Recadrer en bascule » n'a pas été retenue ; la question
  de fond — une demande hors territoire est-elle une **anomalie à signaler** ? — reste
  ouverte, consignée dans
  [`../src/features/requests/CLAUDE.md`](../src/features/requests/CLAUDE.md).
