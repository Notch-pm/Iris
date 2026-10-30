# Transfert d'organisme responsable

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Transfert d'organisme responsable** (2026-09-01, `instruction/transfert.ts` pur/testé —
  13 cas —, `TransfertDialog.tsx`, `useTransferRequest`, migrations `20260901100000` et
  `20260901110000`) : depuis
  le bloc **Prise en charge**, l'agent confie la demande à un autre organisme du territoire.
  Le libellé « Service instructeur — à venir » devient **« Organisme responsable »**, dans le
  même menu que l'agent instructeur — c'est là que la place lui était réservée, et le
  sous-titre du bouton affichait déjà l'organisme.
  - **Ce que la liste propose** : les organismes du sous-arbre Socle qui **assurent la
    démarche** (`socle_procedure_organizations`, opt-in strict — même règle qu'au guichet,
    même module de croisement `activationsByOrganisation`). Une demande **historique sans
    démarche** ouvre tout le sous-arbre. L'organisme **actuel** figure toujours dans la
    liste, même s'il a perdu l'activation ou quitté le miroir : sans lui, le menu ne dirait
    plus où la demande se trouve.
  - **Les DROITS de l'agent n'entrent pas dans ce filtre** — et c'est le geste, pas un oubli
    (RM-19) : se dessaisir, c'est confier à un service où l'on n'a rien à faire. La garde
    serveur exige l'instruction sur le couple **actuel**, jamais sur la cible.
  - **La modale dit tout avant de valider** (`transferConfirmation`, pure) : l'organisme
    quitté, l'organisme qui reçoit, et — quand c'est le cas — que **l'auteur perdra l'accès
    à la demande**. C'est le cœur du dialogue : le geste est irréversible pour lui, puisqu'il
    ne verra plus la fiche pour revenir en arrière. Le sort de l'affectation est énoncé
    comme une **règle**, pas comme un pronostic : le navigateur ne connaît pas les droits des
    autres agents, et aucune surface ne les lui expose.
  - **La fiche ne dit jamais « Demande introuvable » après un transfert réussi** : quand
    l'accès est perdu, la page bascule sur un état qui NOMME ce qui vient de se passer et
    renvoie à la liste. Le message générique passerait pour une panne.
  - **Quatre conséquences, toutes SERVEUR** (la migration les porte, l'écran ne fait que
    refléter) :
    1. `t08_requests_apply_transfer` relit le **libellé dans le miroir** — jamais celui
       soumis, sans quoi un transfert pourrait mentir sur sa destination et toute la lecture
       humaine (liste, tableau, kanban, e-mails) mentirait de concert. Depuis le
       2026-09-17, la même fonction joue **aussi au dépôt**
       (`t08_requests_fill_organization_label`, BEFORE INSERT) : l'ingestion partenaire
       n'envoie que l'identifiant, et une demande du portail rattachée à l'ACCM s'affichait
       « Aucun organisme désigné » (DEM-2026-000050). Le libellé n'est donc **jamais une
       entrée** : ni de l'agent, ni du partenaire — `supabase/tests/
       libelle-organisme-depot.test.sql` ;
    2. le même trigger **retire l'affectation** quand l'agent affecté n'a pas l'instruction
       sur le couple d'arrivée (RM-16). Deux lectures étaient possibles — refuser le
       transfert, ou retirer l'affectation ; la seconde a été retenue (PO) : le service qui
       se dessaisit n'a pas à connaître les droits de l'agent qu'il quitte, et une demande
       sans affectataire est un état normal du workflow, là où un transfert refusé est une
       impasse ;
    3. `t12_requests_transfer_procedure_active` **refuse** un organisme qui n'assure pas la
       démarche — jumeau UPDATE de `t18`, service_role compris : un transfert choisit un
       organisme aujourd'hui, exactement comme un dépôt ;
    4. le journal porte **`transferred`** (les deux libellés, le sort de l'affectation) et
       les agents du couple d'arrivée reçoivent **`transferred_in`**, volet **et** e-mail au
       gabarit agent (charte Iris, pas celle de la collectivité — ce message reste entre
       agents, et il ne nomme PAS le demandeur : arbitrage PO du 2026-09-01).
  - ⚠️ **La RPC `transfer_request` est l'UNIQUE porte — un `update` client NE MARCHE PAS.**
    Constaté en base le 2026-09-01 : dès que la cible sort du périmètre de l'auteur, le RLS
    refuse la ligne mise à jour (`42501`), alors que c'est **précisément le geste**. Trois
    sondes l'ont établi — un agent habilité des deux côtés passe, le même agent habilité sur
    la seule source est refusé, et le `WITH CHECK` que `pg_policy` affiche
    (`is_org_member`) vaut pourtant VRAI au moment du refus. Le défaut était **invisible
    pour un administrateur de plateforme**, que `is_platform_admin()` fait passer partout :
    il ne se serait révélé qu'au premier vrai agent. Détail et sondes dans l'en-tête de la
    migration `20260901110000`.
    - La RPC reécrit DANS la fonction les deux contrôles que `t11_requests_guard_write`
      portait pour ce geste — instruction sur le couple **actuel**, cible dans le sous-arbre
      du tenant — parce qu'en `SECURITY DEFINER` `is_service_context()` vaut toujours vrai
      et que `t11` ne garde donc plus rien (piège du 2026-08-22). `t08`, `t10`, `t12`, `t30`
      et `t40`, eux, s'appliquent normalement.
    - Elle **rend ce qu'elle a fait** (`{changed, organisme, unassigned}`) : l'écran annonce
      le libellé retenu par le serveur et le retrait d'affectation quand il a eu lieu, au
      lieu de réciter ce qu'il espérait. Un transfert **sur place** rend `changed: false` et
      ne journalise rien.
  - ⚠️ **`useTransferRequest` n'envoie QUE l'identifiant** : le libellé et le sort de
    l'affectation sont des décisions serveur.
  - ⚠️ Le menu du rail est passé en mode **`portal`** avec une hauteur bornée : agents du
    tenant PLUS organismes du sous-arbre, dans une colonne défilante, le débordement le
    rognait.
  - Tests : `instruction/transfert.test.ts` (13 cas) et
    [`supabase/tests/transfert-organisme.test.sql`](../../supabase/tests/transfert-organisme.test.sql)
    — 8 scénarios, **tous passés le 2026-09-01** : retour de la RPC et libellé du miroir,
    affectation retirée / conservée, refus d'un organisme non activé (activation absente
    **et** périmée), demande historique sans démarche, journal, fan-out `transferred_in`
    (cible servie, départ non servi, acteur jamais, préférences respectées, aucune identité
    d'usager au payload), droit de transférer et perte de visibilité, organisation inconnue
    et transfert sur place.
    - ⚠️ **L'acteur compte, et il change** : le droit s'évalue sur le couple où la demande
      se trouve À CET INSTANT, donc un agent qui vient de céder une demande ne peut plus la
      reprendre. Le premier jet du test l'ignorait et faisait des allers-retours sous une
      seule identité — c'est la RPC qui le lui a rappelé.
    - ⚠️ Les droits sur une demande **sans démarche** viennent des `default_*` du profil
      (RM-33/RM-36), pas d'une ligne de matrice : un décor de test qui les oublie échoue,
      *fail closed*.
  - **Vérifié en navigateur réel le 2026-09-01** sur DEM-2026-000033 : transfert Saint Rémy →
    Saint Martin de Crau, libellé mis à jour dans le Résumé et le rail, journal
    « Demande transférée — Mairie de Saint Rémy de Provence → Mairie de Saint Martin de
    Crau », et notification `transferred_in` **réellement expédiée** (`email_status = sent`)
    à l'agent instructeur de l'organisme d'arrivée.
