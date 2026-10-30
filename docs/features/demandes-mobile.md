# Pages mobiles du parcours agent

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Pages mobiles** (2026-09-14, maquette Claude Design « Iris mobile — v2 », huit écrans ;
  détection et shell dans [`src/components/layout/CLAUDE.md`](../../src/components/layout/CLAUDE.md)) :
  chaque écran vit dans le dossier `mobile/` de sa feature et **réutilise les hooks, les
  modules purs et les dialogues d'écriture du bureau** — jamais un second chemin vers le
  serveur. Les pages de bureau ne sont pas modifiées.
  - `mobile/` (liste et fiche) : `mobileRequests.ts` pur/testé (filtres `?filtre=`,
    `relativeTime`, échéances du jour, `stageDots`, `transitionHint`, objet par défaut d'un
    e-mail), `useMobileRequests.ts` (liste des 60 dernières demandes du filtre, compteurs,
    interventions en attente par demande — clés préfixées `requests` pour hériter des
    invalidations), `MobileRequestsListPage`, `MobileRequestPage` (en-tête, avancement
    horizontal, trois actions rapides Écrire / Statut / Photo, interventions, usager avec
    « Appeler », lieu avec « Guider », résumé, pièces, notes internes — jamais pour un
    intervenant pur —, activité, pied « Instruire »), `MobileInstruireDrawer` (tiroir bas),
    **`MobileStatusSheet`** (⚠️ liste TOUTES les transitions que `allowedTransitionsFor`
    autorise — la maquette n'en dessinait que trois, le workflow en a sept ; la note
    interne saisie part APRÈS la transition, par `useAddMessage` ; l'avis de clôture suit
    une résolution comme au bureau), `MobileEcrireSheet` (fil des `request_emails` en
    bulles, le dépôt de l'usager en première bulle, modèles en puces, objet par défaut
    « Votre demande DEM-… », envoi par `useSendRequestEmail`).
  - `interventions/mobile/` : `mobileInterventions.ts` pur/testé (groupes En retard /
    Aujourd'hui / Cette semaine / Plus tard / Réalisées par comparaison de jours
    `AAAA-MM-JJ`), `useMyInterventionsWithPlace` (joint `form_data` + `procedure_snapshot`
    pour l'adresse et l'itinéraire), `MobileInterventionsPage`, **`DeclarerInterventionSheet`**
    (mêmes props que `ConfirmerInterventionDialog` : photos en premier, caméra native,
    quatre justificatifs au plus, date + commentaire). ⚠️ Pas de résultat « Impossible » ni
    « Reportée » : le modèle n'a qu'un état `realisee` — les ajouter serait une décision
    de modèle (RPC, garde, notifications), à porter au PO, pas à improviser à l'écran.
  - `creation/mobile/` : `mobileCreation.ts` pur/testé, `MobileNewRequestPage` — une seule
    page défilante (organisme en en-tête avec « changer », photo de la situation vers le
    PREMIER champ pièce de la démarche — donc après son choix —, démarche en puces, usager
    par `RequesterIdentification`, précisions par `ProcedureFormFields`, interrupteur
    « M'affecter cette demande » appliqué APRÈS la création par `useAssignRequest`, échec
    non bloquant). **Même brouillon local que le bureau** (`useCreationDraft`, `step` écrit
    à 3) : commencé sur l'un, repris sur l'autre. Aucune géolocalisation stockée.
  - Vérifié en navigateur le 2026-09-10 (fenêtre 430 px, commutateur « Version mobile ») :
    liste, fiche, tiroir, feuille Statut, feuille Écrire, création jusqu'à l'usager, page
    des interventions à vide. ⚠️ Un clic « outillé » (extension Chrome) sur un bouton qui
    ouvre un dialogue Radix gèle l'onglet ; un `.click()` synthétique fonctionne — piège
    d'outillage, pas de code. Restent à vérifier sur un téléphone d'intervenant : la carte
    d'intervention à faire et la feuille de déclaration avec photos.
