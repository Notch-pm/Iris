# Dette technique — backlog

> **Public** : équipe Iris · **Question traitée** : qu'est-ce qui est assumé comme dette, et
> que faut-il faire pour la solder ? · **Dernière mise à jour** : 2026-08-29

Ce document ne recopie rien : il ne porte que la dette **sans autre domicile** (outillage,
conventions, transverse). La dette de modèle de données et d'API vit là où elle se constate :

| Où | Quoi |
|---|---|
| [`data-model.md`](data-model.md) § Écarts et suites | Outbox non branchée (phase 4), purge RGPD (phase 5), FK non indexées de l'audit, `version` incrémentée par le recalcul de périmètre, archivage d'usager non repris |
| [`api-ingestion.md`](api-ingestion.md) § 3 | Worker de copie des pièces ingérées non actif (phase 2) — les pièces restent `copy_status: pending` |
| [`droits.md`](droits.md) | `organization_members.role` subsiste en colonne dérivée transitoire, à retirer |

## O1 — Le garde-fou du design system ne s'exécute plus

**Constat (2026-08-23)** : `npx oxlint -c _adherence.oxlintrc.json src` échoue au chargement
de la configuration :

```
x Rule 'no-restricted-syntax' not found in plugin 'eslint'
```

oxlint (1.79.0 ici, tiré par `npx` — le paquet n'est **pas** une dépendance du projet)
n'implémente pas `no-restricted-syntax`, qui suppose un moteur de sélecteurs ESTree. Les trois
règles d'adhérence (hex bruts, px bruts, polices hors DS) ne sont donc **jamais évaluées** :
le fichier `_adherence.oxlintrc.json` documente une intention, il ne garde rien.

**Pourquoi ça compte** : le respect du design system Notch/Ariane repose aujourd'hui
entièrement sur la relecture humaine. Rien n'échouerait si une couleur en dur entrait dans le
code.

**État réel du code, mesuré le 2026-08-23** (avant tout correctif) :

- **0 couleur hexadécimale brute** dans `src/**` — la règle qui compte n'a rien à rattraper ;
- **231 occurrences de `px`**, presque toutes des **valeurs arbitraires Tailwind légitimes**
  (`w-[52px]` du rail, `text-[13px]`, `min-w-[240px]`) qui reproduisent *littéralement* la
  spécification du shell. La règle « px brut », telle qu'écrite, produirait donc surtout du
  bruit.

**Piste recommandée** (petit item, à faire d'un bloc) :

1. Re-scoper les règles : garder **hex bruts** et **polices hors DS** (celles qui protègent
   vraiment le DS), abandonner la règle « px brut » ou la restreindre aux styles inline
   (`style={{ … }}`), où la valeur échappe réellement aux tokens.
2. Remplacer le porteur : plutôt qu'un oxlint tiré par `npx` avec une règle qu'il n'a pas, un
   **test vitest** qui balaie `src/**` (module pur + test, convention du dépôt) — il tourne
   avec `npm test`, échoue en CI, et ne dépend d'aucun outil externe. Sinon, un vrai ESLint
   plat en `devDependency`, ce que le projet a explicitement évité jusqu'ici (`npm run lint`
   = `tsc -b` seul).
3. Supprimer `_adherence.oxlintrc.json` une fois le porteur remplacé, pour ne pas laisser un
   fichier qui promet une garde inexistante.

Repéré en livrant la page `/api-doc` (la vérification d'adhérence des nouveaux fichiers a dû
se faire à la main : aucun hex ni px brut).

## O2 — Deux chemins livrés sans épreuve de bout en bout

**Constat (2026-08-26)** : la règle « sans correspondance, on crée l'usager dans le Socle »
(décision PO) est couverte par des tests unitaires — `isSocleOutage`, `hasStrongMatch`,
`contactCreatePayload`, `matchIdentityFromDeclared` — et le retrait de « Poursuivre sans
rapprochement » a été vérifié en navigateur. Mais **deux chemins n'ont jamais tourné en
réel** :

- **la sortie de secours** (panne avérée du Socle) : il faudrait provoquer une indisponibilité
  de `contacts-api`, ou injecter une erreur dans `socle-proxy` ;
- **l'ingestion `requests-api`** (rapprochement puis création) : il faudrait poster une demande
  réelle, qui **ne se supprime jamais**, et qui créerait au passage une fiche de test dans le
  référentiel Socle.

**Pourquoi ça compte** : ce sont précisément les chemins qui écrivent dans le référentiel
d'une autre application de la gamme. Un défaut y produit des fiches parasites que personne ne
verra passer.

**Piste** : campagne E2E avec seed à UUID fixes et migration de cleanup, sur le motif du
2026-08-22 (voir la convention dans les tests SQL) — en y ajoutant la purge des fiches Socle
créées, que le cleanup Iris ne couvre pas.

## O3 — Doublons d'usagers attendus à l'ingestion

**Constat (2026-08-26)** : à l'ingestion, une fiche existante n'est réutilisée que sur un
**identifiant fort** (courriel, téléphone, SIRET). Un partenaire qui envoie deux fois le même
habitant **sans** identifiant fort créera **deux fiches** dans le Socle.

**C'est un choix, pas un oubli.** L'alternative — rapprocher sur le nom — a été écartée :
aucun agent n'arbitre les homonymes à l'ingestion, et rattacher la demande d'un habitant à son
homonyme lui donnerait accès aux échanges d'un autre. Un doublon se fusionne ; une fuite, non.

**Ce qui a été fait pour le borner** : le contrat OpenAPI 1.2.0 et
[`api-changelog.md`](api-changelog.md) disent explicitement aux émetteurs d'envoyer un
identifiant fort chaque fois qu'ils en ont un.

**Piste, si le volume devient gênant** : le levier n'est pas dans Iris mais dans la **fusion
de fiches** côté Socle. À défaut, un rapport « fiches créées par l'ingestion, sans identifiant
fort » permettrait au moins de les repérer.

## O4 — Deux leviers de volumétrie repérés et volontairement non pris

**Constat (2026-08-26)**, mesuré sur la base réelle en répondant à une question du PO sur le
coût des snapshots :

- `procedure_snapshot.requester_config` pèse **668 octets par demande** et n'est **jamais relu
  après la création** — ses deux seuls consommateurs (`creation/NewRequestPage.tsx`,
  `create-request-from-procedure/index.ts`) lisent la démarche **rechargée depuis Socle**, pas
  le snapshot de la demande. C'est un tiers du plus gros JSONB de la table. Le retirer de la
  whitelist coûterait la trace de ce que la démarche exigeait comme identité au dépôt.
- `useNearbyRequests` (`creation/useCreationData.ts`) filtre par `ilike` sur
  `requester_snapshot->declared->>{field}` : **aucun index** ne couvre ce chemin, c'est un
  balayage séquentiel des demandes du tenant. C'est aussi la raison pour laquelle
  `toast_tuple_target` a été réglé à 1024 et pas plus bas — sortir `requester_snapshot` de la
  ligne rendrait ce balayage nettement plus coûteux.

**Pourquoi ne rien faire maintenant** : le volume visé est de quelques dizaines de milliers de
demandes par collectivité (PO, 2026-08-26). À cette échelle, rien de tout cela ne se voit.
Détail et chiffres : [`data-model.md`](data-model.md) § « Pourquoi figer l'identité au dépôt ».

## O5 — Une migration appliquée sans miroir dans le dépôt

**Constat (2026-08-26)** : `echanges_usager_commentaire_purge` (appliquée le 2026-08-26 à
16:05 UTC) n'a **pas** de fichier miroir dans `supabase/migrations/`. La convention du dépôt
veut que toute migration appliquée y laisse son jumeau, faute de quoi un rejeu du schéma
depuis zéro ne reproduit pas la base.

**Piste** : relire la définition appliquée (`supabase_migrations.schema_migrations`) et écrire
le miroir manquant. Antérieure aux travaux du 26 août au soir ; repérée en ajoutant les deux
migrations de cette vague.

## O6 — L'assistant IA peut être facturé deux fois, et rien ne borne son débit

**Constat (2026-08-29)**, deux coûts assumés à la centralisation de l'IA dans le Socle.

**a) Double facturation possible.** Iris confie l'appel au guichet du Socle, qui réserve,
appelle le fournisseur et solde. Si Iris **expire pendant que le Socle réussit**, l'agent voit
un échec, réessaie, et la collectivité paie deux fois. La parade habituelle — une clé
d'idempotence — **exige de stocker la réponse**, ce que la décision PO n°1 (passe-plat, rien
n'est persisté) interdit. Il n'y a donc pas de correctif, seulement une atténuation : la
**chaîne de délais Mistral 55 s < Socle 60 s < Iris 75 s**, qui rend le cas rare en rendant
l'abandon d'Iris plus tardif que la fin du Socle.

⚠️ **Ce qui doit être surveillé** : toute modification d'un de ces trois délais. Les inverser
transforme un cas rare en cas courant, sans qu'aucun test ne le voie.

**b) Aucun garde-fou de DÉBIT, nulle part.** Un plafond mensuel n'est pas un rate-limit : une
boucle accidentelle (un `useEffect` mal gardé, un agent qui laisse un onglet ouvert sur une
relance) brûle le mois en quelques minutes, et le refus n'arrive qu'une fois l'argent dépensé.

**Piste** : une seconde ligne de compteur à période **horaire** dans `ai_usage_counters`, côté
**Socle** — le mécanisme de réservation existe déjà, il ne manque qu'une seconde borne à
vérifier dans `reserve_ai_usage`. À arbitrer avec le PO : un plafond horaire trop bas gêne une
journée d'instruction chargée.
