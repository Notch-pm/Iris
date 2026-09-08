// Soumission finale du parcours guidé : les pièces sont d'abord REÇUES par
// l'edge function `request-attachments` (zone d'attente, portée organisation —
// la demande n'existe pas encore), puis `create-request-from-procedure`
// revalide TOUT côté serveur, déplace les objets sous la demande et écrit
// atomiquement. Le navigateur n'envoie jamais un snapshot ni un chemin —
// uniquement des identifiants, des valeurs et des `upload_id`.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import {
  dataKey,
  flatFields,
  type FormSchema,
  type FormValues,
  type RequesterSubmission,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import { discardUploads, stageFile } from "../uploads";

export interface CreateFromProcedureInput {
  organizationId: string;
  draftRequestId: string;
  procedureId: string;
  subject: string;
  body: string;
  priority: string;
  destinationId: string | null;
  requester: RequesterSubmission;
  schema: FormSchema;
  values: FormValues;
  /** Fichiers choisis, par id de champ pièce. */
  files: Record<string, File[]>;
}

export function useCreateFromProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateFromProcedureInput) => {
      const attachments: { upload_id: string; form_field_key: string }[] = [];
      const scope = { organizationId: input.organizationId };
      for (const entry of flatFields(input.schema)) {
        if (entry.field.type !== "attachment") continue;
        for (const file of input.files[entry.field.id] ?? []) {
          try {
            const receipt = await stageFile(file, scope);
            attachments.push({ upload_id: receipt.upload_id, form_field_key: dataKey(entry.field) });
          } catch (err) {
            // Ce qui a déjà été reçu n'a plus de raison d'attendre.
            await discardUploads(attachments.map((a) => a.upload_id));
            throw err;
          }
        }
      }

      try {
        return await invokeEdge<{ id: string; reference: string }>(
          "create-request-from-procedure",
          {
            organization_id: input.organizationId,
            request_id: input.draftRequestId,
            socle_procedure_id: input.procedureId,
            subject: input.subject.trim(),
            body: input.body.trim() === "" ? null : input.body.trim(),
            priority: input.priority,
            channel: "guichet",
            socle_organization_id: input.destinationId,
            requester: input.requester,
            form_values: input.values,
            attachments,
          },
        );
      } catch (err) {
        await discardUploads(attachments.map((a) => a.upload_id));
        throw err;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}
