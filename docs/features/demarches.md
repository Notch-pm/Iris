# Démarches proposables (aucune demande libre)

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Iris ne gère aucune demande libre** (règle impérative PO, 2026-08-20) : toute nouvelle
  demande est **fondée sur une démarche Socle active du tenant** (`socle_procedure_id` +
  `procedure_snapshot`), gardé par le trigger `t16_requests_require_procedure` — service_role
  compris. Le **snapshot de démarche est construit côté serveur** depuis Socle (edge
  functions) : jamais accepté comme vérité d'un navigateur ou d'un partenaire. Les demandes
  historiques sans démarche restent lisibles et transitionnables. Ce qui ne relève d'aucune
  démarche n'entre pas dans Iris : c'est une **« demande complexe »** (2026-10-10), action
  secondaire de « Nouvelle demande », que l'agent **relaie à Clara** (edge function
  `relay-courrier-clara` → porte `iris-courrier` de Clara, canal « Relayé agent ») — Iris
  n'en garde **ni ligne ni octet**. **Une démarche en
  `brouillon` n'est proposée nulle part dans Iris** (2026-08-30) : le paramétrage n'est pas
  fini, le Socle dit de ne la servir à personne — garde serveur sur la démarche rechargée dans
  `create-request-from-procedure`, pas seulement un filtre d'écran. Les démarches **internes**,
  elles, sont masquées TEMPORAIREMENT (décision PO : elles seront affichées ultérieurement).
  Une démarche **hors de sa période de publication** disparaît elle aussi du sélecteur (bornes
  incluses) — mais elle MASQUE seulement : aucune garde serveur, pour qu'un formulaire papier
  reçu pendant la période reste consignable après sa fin.
  Depuis le 2026-08-31, une quatrième règle s'ajoute, et elle **masque ET refuse** :
  **une démarche doit être ACTIVÉE pour l'organisme** qui portera la demande
  (`Socle.organization_procedures`, miroitée dans `socle_procedure_organizations`, gardée par
  `t18_requests_require_procedure_active` — service_role et ingestion partenaire compris).
  **Opt-in strict** : absente du miroir = non activée. Le Socle ne rend cette information que
  par le filtre `GET /v1/procedures?enabled_for=<org>`, non récursif, d'où un appel par
  organisation du sous-arbre à la synchro. ⚠️ `procedures.is_active_global` du Socle est mort :
  ne jamais s'y fier. Le sélecteur signale en revanche ce
  qui, dans la **publication** d'une démarche, mérite de l'être : la pastille « Non visible
  portail » **uniquement** sur celles qui n'y sont pas (y être est le défaut du contrat), et la
  période quand il y en a une. Détail :
  [`docs/data-model.md`](../data-model.md) § « Publication des démarches ».
