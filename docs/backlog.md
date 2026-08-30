# Backlog produit

> **Public** : PO et équipe Iris · **Question traitée** : qu'est-ce qui a été demandé, pas
> encore arbitré, et que faut-il savoir avant de s'y mettre ? · **Dernière mise à jour** :
> 2026-08-30

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

## B1 — Centrage de la carte et zoom

**Ce qui existe.** Depuis le 2026-08-30, la carte des interventions s'ancre sur l'adresse de
l'organisation principale (`socle-proxy /v1/organizations/root`, géocodée à la BAN), et
`fitAround` (`src/lib/carto.ts`, pur/testé) n'ajuste plus que le zoom, en symétrique autour de
ce centre. Sans adresse exploitable, repli sur `fitBounds`.

**Ce qui reste ouvert**, constaté en recette le jour même :

- `MIN_ZOOM` vaut **12**. Aucune vue ne peut donc montrer Arles et Nantes ensemble : une
  demande hors territoire est invisible et ne s'atteint qu'en faisant glisser la carte. Le
  bouton **« Recadrer » ne l'y ramène plus** — il recentre sur la collectivité.
- Pistes évoquées, non tranchées : faire de « Recadrer » une **bascule** (« sur la
  collectivité » / « sur toutes les épingles » — `fitBounds` est toujours là, c'est quelques
  lignes) ; ou **descendre `MIN_ZOOM`**, ce qui changerait le comportement de TOUTES les
  cartes d'Iris, y compris celle du lieu d'intervention d'une fiche.
- Question de fond jamais posée : que *doit-il* se passer quand une demande sort du
  territoire ? C'est peut-être une **anomalie à signaler** plutôt qu'un cadrage à élargir.

**Touche** : `src/lib/carto.ts`, `src/features/requests/carte/`.

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

**Touche** : selon la lecture, `src/features/requests/` seul, ou le modèle de données et
[`architecture-proposee.md`](architecture-proposee.md).

## B4 — Sélection de la collectivité à la création d'une demande

**Ce qui existe.** Le parcours de création impose déjà une **organisation destinataire**
(obligatoire, RM-29/RM-59), restreinte à l'intersection du périmètre de l'agent et des
organisations qui proposent la démarche. Depuis le 2026-08-30 ce champ s'appelle
**« Organisme »** sur la liste et le tableau ; le parcours de création, lui, dit encore
« Organisation destinataire » (cf. B8).

**À préciser** : s'agit-il de choisir le **tenant** — pour un agent membre de plusieurs
collectivités, ce que fait aujourd'hui le sélecteur du header, hors du parcours — ou
d'assouplir la restriction de périmètre du parcours actuel ? La seconde lecture touche
directement les droits : `requests_guard_write` revalide le couple côté serveur, et l'écran ne
fait que refléter.

**Touche** : `src/features/requests/creation/`, [`droits.md`](droits.md).

## B5 — Sous-tâches

**Rien n'existe.** À cadrer entièrement.

**Question à poser avant d'écrire une ligne** : une sous-tâche est-elle une **demande** (donc
une pièce administrative, avec référence, statut, RLS et journal) ou un **objet interne léger**
(une case à cocher pour le service) ? Le workflow à 7 statuts est **fixe** (décision PO) : si
une sous-tâche a un cycle de vie, ce n'est pas celui-là — ou ce n'est pas une demande. La
réponse décide de tout le reste : modèle, droits, notifications, statistiques.

## B6 — Liens entre les demandes

**Ce qui existe déjà, et qu'il faut regarder avant de concevoir** : la fiche porte des
**demandes liées** (`useLinkRequests`, `useRequestSummaries`), et le parcours de création
détecte les **demandes proches**. Il y a donc une liaison, mais sans qualification.

**Ce qui manque, probablement** : le **type** du lien (doublon, dépendance, suite de,
regroupement), son sens, et ce qu'il entraîne. Un lien « doublon » devrait-il proposer une
clôture ? Un lien « dépend de » devrait-il retenir une résolution ? Sujet voisin de B5 et de
B7 : les trois gagneraient à être cadrés ensemble.

**Touche** : `src/features/requests/` (fiche, création).

## B7 — Résolution groupée

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
