// Envoi d'un e-mail à l'usager depuis la fiche demande.
//
// Deux temps, dans cet ordre — le même que le parcours de création :
//   1. les pièces sont REÇUES par l'edge function `request-attachments` POUR
//      cette demande (droit d'instruction, type réel vérifié, zone d'attente) ;
//   2. l'edge function d'envoi reçoit les `upload_id`, relit tout en base,
//      ouvre l'échange, envoie, et clôt.
//
// Le corps envoyé est celui que l'agent a lu à l'écran : les variables sont
// déjà résolues (`requestTemplateValues` + `renderTemplate`), le serveur ne
// re-rend rien. Ce qu'il valide, lui, c'est le droit, le destinataire et les
// pièces — les seules choses qu'un navigateur ne peut pas se voir confier.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import { discardUploads, stageFiles } from "../uploads";

export interface SendRequestEmailInput {
  requestId: string;
  organizationId: string;
  subject: string;
  body: string;
  files: File[];
  /** Documents DÉJÀ au dossier, joints par identifiant — le serveur relit leur
   *  chemin et leur nature en base (un interne serait refusé). */
  documentIds?: string[];
  templateId?: string | null;
  templateName?: string | null;
}

export interface SendRequestEmailResult {
  email_id: string;
  to: string;
  email_sent: boolean;
}

export function useSendRequestEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendRequestEmailInput): Promise<SendRequestEmailResult> => {
      const receipts = await stageFiles(input.files, {
        organizationId: input.organizationId,
        requestId: input.requestId,
      });
      const attachments: Record<string, unknown>[] = receipts.map((r) => ({ upload_id: r.upload_id }));
      for (const id of input.documentIds ?? []) attachments.push({ attachment_id: id });

      try {
        return await invokeEdge<SendRequestEmailResult>("send-request-email", {
          request_id: input.requestId,
          subject: input.subject,
          body: input.body,
          template_id: input.templateId ?? null,
          template_name: input.templateName ?? null,
          attachments,
        });
      } catch (err) {
        // L'edge function retire déjà les pièces sur ses propres refus ; ceci
        // couvre le cas où elle n'a pas été jointe du tout.
        await discardUploads(receipts.map((r) => r.upload_id));
        throw err;
      }
    },
    onSuccess: (_data, vars) => {
      // L'échange ET la pièce qui vient d'être déclarée.
      void queryClient.invalidateQueries({ queryKey: ["request_emails", vars.requestId] });
      void queryClient.invalidateQueries({ queryKey: ["request_attachments", vars.requestId] });
    },
  });
}

/**
 * L'avis de clôture, envoyé à l'usager APRÈS une résolution.
 *
 * Le navigateur n'envoie QUE l'identifiant de la demande : objet, corps,
 * salutation et signature sont composés par l'edge function à partir de l'état
 * enregistré (statut, référence, objet, `closure_text`). C'est ce qui permet
 * d'exiger ici le droit de **clôture** — celui qui vient d'autoriser la
 * transition — sans faire d'Iris un relais ouvert : détenir la clôture ne donne
 * pas le pouvoir d'écrire n'importe quoi à un habitant.
 *
 * ⚠️ L'envoi suit la transition, il ne la conditionne pas. Un échec (pas
 * d'adresse, relais muet) laisse la demande résolue : on n'annule pas une
 * décision d'instruction parce qu'un serveur de mail tousse. L'appelant
 * l'annonce à l'agent, et l'onglet Échanges garde la trace « echec » quand
 * l'échange a pu être ouvert.
 */
export function useSendClosureEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string }): Promise<SendRequestEmailResult> =>
      await invokeEdge<SendRequestEmailResult>("send-request-email", {
        request_id: input.requestId,
        kind: "cloture",
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["request_emails", vars.requestId] });
    },
  });
}
