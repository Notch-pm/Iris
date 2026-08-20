// Soumission finale du parcours guidé : dépose les pièces dans le bucket
// (chemin de brouillon {org}/{draftId}/…, admis par la policy storage), puis
// appelle l'edge function create-request-from-procedure qui revalide TOUT
// côté serveur et écrit atomiquement. Le navigateur n'envoie jamais de
// snapshot — uniquement des identifiants, valeurs et références de fichiers.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import { supabase } from "@/lib/supabase";
import { slugifyFileName } from "@fn/requests-api/_shared/validation";
import {
  dataKey,
  flatFields,
  type FormSchema,
  type FormValues,
  type RequesterSubmission,
} from "@fn/create-request-from-procedure/_shared/procedureForm";

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
      const attachments: Record<string, unknown>[] = [];
      for (const entry of flatFields(input.schema)) {
        if (entry.field.type !== "attachment") continue;
        for (const file of input.files[entry.field.id] ?? []) {
          const path = `${input.organizationId}/${input.draftRequestId}/` +
            `${crypto.randomUUID()}-${slugifyFileName(file.name)}`;
          const { error } = await supabase.storage
            .from("request-attachments")
            .upload(path, file, { contentType: file.type || undefined });
          if (error) {
            throw new Error(`Échec de l'envoi de « ${file.name} » : ${error.message}`);
          }
          attachments.push({
            form_field_key: dataKey(entry.field),
            file_name: file.name,
            storage_path: path,
            mime_type: file.type || null,
            size_bytes: file.size,
          });
        }
      }

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
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}
