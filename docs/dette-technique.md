# Dette technique — backlog

> **Public** : équipe Iris · **Question traitée** : qu'est-ce qui est assumé comme dette, et
> que faut-il faire pour la solder ? · **Dernière mise à jour** : 2026-08-23

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
