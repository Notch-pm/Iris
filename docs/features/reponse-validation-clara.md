# Courrier de réponse validé dans Clara

> Fiche de feature — l'index est dans [CLAUDE.md](../../CLAUDE.md). Invariants, pièges (⚠️)
> et pointeurs de code : **à lire avant de toucher la feature, à mettre à jour dans la même PR.**

Livré le 2026-11-12. Certaines démarches exigent que la réponse à l'usager passe par le
circuit du **courrier sortant de Clara** (visa, signature, envoi) au lieu d'être envoyée par
Iris.

## Le parcours

1. **Socle** — sur la démarche, étape « Publication », bloc « Documents et courriers » :
   « Courriers de réponse usager à traiter comme un courrier sortant Clara »
   (`communication_config.replyLetters.claraOutbound`, contrat Socle 1.46.0). Grisé si la
   collectivité n'est pas abonnée à Clara.
2. **Iris** — sur une demande **en instruction** de cette démarche, « Résoudre » disparaît au
   profit de **« Préparer le courrier de réponse »** (`instruction/ClaraReplyDialog.tsx`) :
   issue (positive / négative, motif facultatif), objet, texte du courrier, canal proposé
   (courriel si une adresse est connue, sinon papier), commentaire de clôture facultatif.
3. L'edge **`submit-reply-to-clara`** dépose le courrier dans Clara (porte
   `iris-reply-courier`) : courrier sortant lié à la demande. La demande reste
   **`en_instruction`**, sous-état **« Réponse en validation »** ; bandeau sur la fiche avec
   le lien vers le courrier Clara.
4. **Clara** — le courrier suit son circuit (visa, signature, envoi). Quand il part (courriel
   envoyé, courrier déclaré posté, envoi postal, état final), Clara appelle
   **`POST /v1/requests/{id}/reply-letter/events`** `{ event: "sent" }` (scope
   `requests:reply_letter`).
5. **Iris** applique l'issue choisie à l'étape 2 : `resolue_positive` ou `resolue_negative`,
   `closed_at` = date d'envoi, texte et motif de clôture réservés. Si Clara **abandonne** le
   courrier (`event: "cancelled"`), la demande revient à l'instruction simple.

## Invariants

- ⚠️ **Pas de 8ᵉ statut** (invariant PO du workflow à 7 statuts) : `reply_validation_state`
  (`depot_en_cours` / `en_validation`) est un **sous-état de `en_instruction`** — CHECK
  `requests_reply_validation_in_instruction`. Il s'affiche comme un statut
  (`displayStatusLabel`, `StatusBadge replyState`), sans en être un pour le contrat : le
  `status` exposé reste `en_instruction`, plus `Request.reply_validation` (2.12.0).
- ⚠️ **Iris reste seule source de vérité du statut** : l'issue est décidée par l'agent Iris
  (`reply_pending_outcome`), jamais envoyée à Clara ; Clara ne transmet qu'un **fait**.
- **Le circuit s'applique** = réglage de la démarche (`socle_procedure_cache.reply_via_clara`,
  synchronisé) **ET** source `clara` active du tenant — `request_reply_via_clara(request_id)`.
  Le réglage gouverne l'usage : sans abonnement Clara, la valeur est conservée et sans effet.
- **Garde** `t11_requests_guard_clara_reply` (SECURITY INVOKER) :
  - un client ne résout pas directement `en_instruction → resolue_*` d'une démarche
    concernée (P0431) — y compris par la résolution groupée, qui l'écarte en le disant ;
  - pendant la validation : aucun changement de statut, de texte ni de motif de clôture
    (P0430) ; ni transfert ni requalification, **même en service** ;
  - les colonnes `reply_*` / `clara_*` ne s'écrivent que par les RPC de service.
  « À traiter → Clore (irrecevable / réorientation) » et « Annuler » restent ouverts : ce ne
  sont pas des réponses.
- **Portes** (SECURITY DEFINER, `service_role` seul) : `reserve_clara_reply` (droit de
  clôture, contact Socle, pièces conformes pour une issue positive), `release_clara_reply`,
  `confirm_clara_reply` (lien `request_links` externe `clara_courier`, événement
  `clara_reply_submitted`), `finalize_clara_reply` (événement `clara_reply_sent`),
  `cancel_clara_reply` (événement `clara_reply_cancelled`). Toutes idempotentes.
- ⚠️ **Le texte du courrier n'est pas conservé dans Iris** : il vit dans Clara, où il est visé
  et signé. Iris garde l'issue, le motif et le commentaire de clôture réservés.
- ⚠️ **Pas d'avis de clôture par Iris** pour ces demandes : le courrier Clara EST la réponse.
  La notification `t41` de l'espace usager reste.
- **Statistiques** : `resolved_by` = l'agent qui a rédigé (`reply_submitted_by`) —
  `auth.uid()` est NULL quand Clara signale l'envoi ; `resolved_at` = date d'envoi.
- **t17** (pièces obligatoires conformes) est vérifiée **au dépôt** et non rejugée à la
  finalisation (`iris.clara_reply_finalize`) : le courrier est déjà parti.

## Pièges

- ⚠️ Sans fiche Socle du demandeur (dépôt anonyme ou non rapproché), Clara ne peut pas
  adresser le courrier : `reserve` refuse (P0433), l'agent rapproche l'usager d'abord.
- ⚠️ Ordre du dépôt : `reserve` → Clara → `confirm` ; un échec Clara **libère** la
  réservation. L'identifiant de soumission est tiré à l'ouverture de la modale et conservé
  entre deux essais : un nouvel essai retrouve le même courrier (`duplicate`). Si Clara a créé
  le courrier mais que la réponse s'est perdue et que l'agent abandonne, le courrier reste
  orphelin dans Clara ; son avis d'envoi recevra 409 (Clara cesse de relancer).
- ⚠️ Clara sans circuit de réponse pour l'organisme → 422 `clara_no_reply_workflow`, rien n'a
  changé.
- Le tableau (kanban), le mobile et la liste ne connaissent pas encore le sous-état
  (affichés « En cours d'instruction ») ; la garde serveur refuse leurs résolutions directes
  avec un message explicite. À reprendre après régénération de `database.types.ts`.

## Déploiement

Migration `20261112150000_reponse_validation_clara.sql` (test
`supabase/tests/reponse-validation-clara.test.sql`) → `database.types.ts` régénéré →
`sync-socle-referentiel`, `requests-api`, `submit-reply-to-clara` déployées → secrets
`CLARA_IRIS_REPLY_URL` (+ `CLARA_IRIS_REPLY_KEY`, repli `CLARA_IRIS_INTAKE_KEY`). Côté Clara :
porte `iris-reply-courier` et file d'avis `notify-iris-reply`. Le bouton n'apparaît que si la
démarche est réglée au Socle : rien ne change pour les autres démarches.

## Code

`supabase/migrations/20261112150000_reponse_validation_clara.sql`,
`supabase/functions/_shared/clara/reply.ts` (+ test), `supabase/functions/submit-reply-to-clara/`,
`supabase/functions/requests-api/index.ts` (`handleReplyLetterEvent`),
`supabase/functions/_shared/procedures/publication.ts` (`parseReplyViaClara`),
`src/features/requests/statuts.ts` (`withClaraReplyCircuit`, `canPrepareClaraReply`,
`displayStatusLabel`), `src/features/requests/instruction/{ClaraReplyDialog.tsx,useClaraReply.ts}`.
