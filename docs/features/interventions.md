# Interventions

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Interventions — solliciter un intervenant** (2026-09-14, `interventions/` :
  `interventions.ts` pur/testé — 20 cas —, `useInterventions.ts`, `InterventionsPane.tsx`,
  `SolliciterDialog.tsx`, `ConfirmerInterventionDialog.tsx`, page `MesInterventionsPage`
  sur `/interventions` ; migration `20260914100000`) : pendant l'instruction, l'agent
  **sollicite un intervenant** (date d'intervention souhaitée, commentaire « ce qui est
  attendu » facultatif depuis le 2026-09-24 — NULL en base, jamais une chaîne blanche),
  l'intervenant est **prévenu par e-mail** (gabarit agent, motif `intervention_requested`),
  ne voit **que** les demandes où on l'a sollicité, et **déclare l'intervention réalisée**
  (date de finalisation proposée au jour courant, commentaire facultatif — motif
  `intervention_completed` vers qui a sollicité et l'affectataire).
  - **Qui est intervenant** : un profil de droits portant l'attribut `is_intervenant`
    (Paramètres › Profils, modèle « Intervenant »), sur son périmètre. L'attribut n'ouvre
    rien par lui-même ; c'est la SOLLICITATION qui ouvre la demande (RLS `requests_select`).
    Détail : [`docs/droits.md`](../droits.md), [`docs/data-model.md`](../data-model.md)
    § « Interventions ».
  - **Onglet « Interventions »** de la fiche (compteur = à réaliser) : le bouton
    « Solliciter un intervenant » s'ouvre exactement quand la RPC l'accepterait
    (`solicitGate` : statut `en_instruction` + droit d'instruction), fermé **avec sa raison**
    sinon. L'intervenant sollicité y trouve « Déclarer réalisée » (`canComplete`).
  - **Un intervenant PUR** (sans consultation sur le couple, `intervenantOnly`) lit la fiche
    par la seule sollicitation : Résumé, Documents, Interventions, Activité — les onglets
    **Notes internes** et **Échanges** sont RETIRÉS, le serveur les lui ferme
    (`can_consult_request`). Aucune action de workflow ne lui est proposée (droits vides).
  - **Entrée de rail « Mes interventions »** (icône casque) pour tout titulaire d'un profil
    intervenant actif (`my_rights.is_intervenant`), filtres À réaliser / Réalisées / Toutes,
    « En retard » quand le jour souhaité est passé (`interventionTone`).
  - ⚠️ **Deux RPC, seules portes** : `request_intervention` et
    `complete_request_intervention` — `request_interventions` n'a AUCUNE policy cliente
    d'écriture. Les dates sont comparées en **texte** `AAAA-MM-JJ` (jour local de l'agent,
    `isoDay`, jamais `toISOString`) ; le serveur juge au jour de **Paris** (`paris_today()`).
  - Le journal porte `intervention_requested` / `intervention_completed` (`activityItems`).
  - Tests : `interventions.test.ts`, `notifications.test.ts` (volet), e-mail
    `_shared/email/notifications.test.ts`, et
    [`supabase/tests/interventions.test.sql`](../../supabase/tests/interventions.test.sql)
    (T1–T8).
  - **Justificatifs de l'intervenant** (second lot du 2026-09-14, migration
    `20260914110000`) : en déclarant, l'intervenant joint jusqu'à **4 fichiers**
    (`MAX_INTERVENTION_FILES`, jumeau de `intervention_max_attachments()`) — « Joindre un
    document » (sélecteur multiple, formats de la liste fermée) et **« Prendre une
    photo »** (`CameraCapture.tsx`) : sur écran tactile, l'appareil photo **natif** via
    `<input capture="environment">` ; sur poste fixe, un aperçu vidéo `getUserMedia` dans
    un dialogue, capture en JPEG sur canvas, flux coupé à la fermeture. Sans caméra, le
    bouton n'existe pas — le fichier reste possible.
    - **Deux temps, comme l'ajout d'une pièce** (`useCompleteIntervention`) : chaque fichier
      est REÇU par `request-attachments` avec la portée `intervention_id` (l'intervenant
      sollicité, sans droit d'instruction), puis la RPC consomme les `upload_id` en une
      transaction ; un refus retire les pièces reçues (`discardUploads`). `progress` dit à
      l'écran quel fichier part.
    - **`kind = intervention`, hors du dossier de l'usager** : `usagerPieces` les retire
      du groupement par exigence et de la validation du formulaire ; `interventionDocuments`
      les rend sous chaque intervention (onglet Interventions) et dans un bloc
      « Justificatifs d'intervention » de l'onglet Documents — jamais « Joindre à un
      échange » (question ouverte).
