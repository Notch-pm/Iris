// Deux gestes de la fiche d'instruction : ajouter une pièce, et enregistrer
// les réponses corrigées du formulaire.
//
// AJOUT D'UNE PIÈCE — deux temps, le même ordre que partout ailleurs :
//   1. le fichier est REÇU par l'edge function `request-attachments` POUR cette
//      demande (droit d'instruction vérifié avant de lire le corps, type réel
//      vérifié, zone d'attente) ;
//   2. la RPC `attach_request_piece` reçoit l'`upload_id`, relit tout en base,
//      déclare la pièce, REMPLACE les pièces déjà actives de la même exigence
//      et journalise — le tout en une transaction.
// Un INSERT client suivi d'un UPDATE client laisserait, sur coupure, une pièce
// neuve à côté d'une ancienne encore active : une exigence bloquée que personne
// ne comprendrait.
//
// RÉPONSES DU FORMULAIRE — un simple UPDATE : `requests_guard_write` exige déjà
// le droit d'INSTRUCTION pour toucher `form_data`, et le trigger de journal
// écrit `form_data_updated`. Le `procedure_snapshot` ne bouge pas.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { discardUploads, stageFile } from "../uploads";

function useInvalidate() {
  const queryClient = useQueryClient();
  return (requestId: string) => {
    void queryClient.invalidateQueries({ queryKey: ["request_attachments", requestId] });
    void queryClient.invalidateQueries({ queryKey: ["request_events", requestId] });
    void queryClient.invalidateQueries({ queryKey: ["request", requestId] });
    void queryClient.invalidateQueries({ queryKey: ["requests"] });
  };
}

export interface AttachPieceInput {
  requestId: string;
  organizationId: string;
  file: File;
  /** Exigence à laquelle la pièce répond ; `null` pour une pièce hors formulaire. */
  formFieldKey: string | null;
  /** Pièce explicitement remplacée, quand il n'y a pas d'exigence à laquelle se rattacher. */
  replacesAttachmentId?: string | null;
}

export interface AttachPieceResult {
  attachment_id: string;
  request_id: string;
  /** Nombre de pièces que celle-ci vient de remplacer. */
  remplacees: number;
}

export function useAttachRequestPiece() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: AttachPieceInput): Promise<AttachPieceResult> => {
      const receipt = await stageFile(input.file, {
        organizationId: input.organizationId,
        requestId: input.requestId,
      });

      const { data, error } = await supabase.rpc("attach_request_piece", {
        p_request_id: input.requestId,
        p_upload_id: receipt.upload_id,
        p_form_field_key: input.formFieldKey ?? undefined,
        p_replaces_id: input.replacesAttachmentId ?? undefined,
      });
      if (error) {
        await discardUploads([receipt.upload_id]);
        throw error;
      }
      return data as unknown as AttachPieceResult;
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
}

export interface UpdateFormDataInput {
  requestId: string;
  formData: Record<string, unknown>;
}

export function useUpdateRequestFormData() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: UpdateFormDataInput): Promise<void> => {
      const { error } = await supabase
        .from("requests")
        .update({ form_data: input.formData } as never)
        .eq("id", input.requestId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
}
