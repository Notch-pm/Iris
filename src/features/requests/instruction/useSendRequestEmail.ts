// Envoi d'un e-mail à l'usager depuis la fiche demande.
//
// Deux temps, dans cet ordre — le même que le parcours de création :
//   1. les pièces montent dans le bucket depuis le NAVIGATEUR (la policy
//      storage exige déjà `can_process_request`, donc le droit d'instruction) ;
//   2. l'edge function reçoit les CHEMINS, les revérifie, ouvre l'échange,
//      envoie, et clôt.
//
// Le corps envoyé est celui que l'agent a lu à l'écran : les variables sont
// déjà résolues (`requestTemplateValues` + `renderTemplate`), le serveur ne
// re-rend rien. Ce qu'il valide, lui, c'est le droit, le destinataire et les
// chemins — les seules choses qu'un navigateur ne peut pas se voir confier.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { slugifyFileName } from "@fn/requests-api/_shared/validation";
import { invokeEdge } from "@/lib/edge";
import { supabase } from "@/lib/supabase";

export interface SendRequestEmailInput {
  requestId: string;
  organizationId: string;
  subject: string;
  body: string;
  files: File[];
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
      const attachments: Record<string, unknown>[] = [];
      for (const file of input.files) {
        const path = `${input.organizationId}/${input.requestId}/` +
          `${crypto.randomUUID()}-${slugifyFileName(file.name)}`;
        const { error } = await supabase.storage
          .from("request-attachments")
          .upload(path, file, { contentType: file.type || undefined });
        if (error) {
          throw new Error(`Échec de l'envoi de « ${file.name} » : ${error.message}`);
        }
        attachments.push({
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          file_size: file.size,
        });
      }

      return await invokeEdge<SendRequestEmailResult>("send-request-email", {
        request_id: input.requestId,
        subject: input.subject,
        body: input.body,
        template_id: input.templateId ?? null,
        template_name: input.templateName ?? null,
        attachments,
      });
    },
    onSuccess: (_data, vars) => {
      // L'échange ET la pièce qui vient d'être déclarée.
      void queryClient.invalidateQueries({ queryKey: ["request_emails", vars.requestId] });
      void queryClient.invalidateQueries({ queryKey: ["request_attachments", vars.requestId] });
    },
  });
}
