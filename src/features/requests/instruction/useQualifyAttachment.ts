// Qualification d'une pièce justificative — conforme ou non conforme.
//
// UNE SEULE PORTE : la RPC `qualify_request_attachment`. `request_attachments`
// n'a aucune policy UPDATE cliente (elle n'en a jamais eu), donc un UPDATE
// direct depuis le navigateur ne toucherait aucune ligne — silencieusement.
// C'est la RPC qui vérifie le droit d'instruction, journalise le geste et
// place la demande « En attente d'information » quand la pièce ne va pas.
//
// La bascule de statut se fait CÔTÉ SERVEUR, dans la même transaction que le
// verdict : un aller-retour de plus depuis le navigateur laisserait, le temps
// d'une panne réseau, une pièce non conforme sur une demande « en cours ».

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Compliance, NonConformityMotif } from "./conformite";

export interface QualifyAttachmentInput {
  attachmentId: string;
  /** Sert aux invalidations — le serveur, lui, retrouve la demande par la pièce. */
  requestId: string;
  compliance: Compliance;
  motif?: NonConformityMotif | null;
  note?: string | null;
}

export interface QualifyAttachmentResult {
  attachment_id: string;
  request_id: string;
  compliance: Compliance;
  motif: NonConformityMotif | null;
  status: string;
  /** La demande vient-elle de passer en attente d'information ? */
  status_changed: boolean;
}

export function useQualifyAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: QualifyAttachmentInput): Promise<QualifyAttachmentResult> => {
      const { data, error } = await supabase.rpc("qualify_request_attachment", {
        p_attachment_id: input.attachmentId,
        p_compliance: input.compliance,
        p_motif: input.motif ?? undefined,
        p_note: input.note ?? undefined,
      });
      if (error) throw error;
      return data as unknown as QualifyAttachmentResult;
    },
    onSuccess: (_data, vars) => {
      // Le verdict, le journal, et le statut de la demande — que la RPC a pu
      // faire basculer. La liste et ses facettes suivent le statut.
      void queryClient.invalidateQueries({ queryKey: ["request_attachments", vars.requestId] });
      void queryClient.invalidateQueries({ queryKey: ["request_events", vars.requestId] });
      void queryClient.invalidateQueries({ queryKey: ["request", vars.requestId] });
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
      void queryClient.invalidateQueries({ queryKey: ["request-facets"] });
    },
  });
}
