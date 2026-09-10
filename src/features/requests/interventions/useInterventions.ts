// Interventions — hooks TanStack Query. Lecture sous RLS (la sollicitation
// ouvre la demande à son intervenant) ; écriture par les DEUX RPC, seules
// portes : `request_interventions` n'a aucune policy cliente d'écriture.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { discardUploads, stageFile } from "../uploads";
import { MAX_INTERVENTION_FILES, type InterventionRow } from "./interventions";

export const INTERVENTIONS_KEY = "request_interventions";
export const MY_INTERVENTIONS_KEY = "my-interventions";

/** Sollicitations d'une demande, dans l'ordre de création (l'écran retrie). */
export function useRequestInterventions(requestId: string | undefined) {
  return useQuery({
    queryKey: [INTERVENTIONS_KEY, requestId],
    enabled: Boolean(requestId),
    queryFn: async (): Promise<InterventionRow[]> => {
      const { data, error } = await supabase
        .from("request_interventions")
        .select("*")
        .eq("request_id", requestId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InterventionRow[];
    },
  });
}

export interface EligibleIntervenantRow {
  user_id: string;
  display_name: string;
  email: string;
}

/** Intervenants sollicitables sur cette demande (profil `is_intervenant` couvrant l'organisme). */
export function useEligibleIntervenants(requestId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["eligible-intervenants", requestId],
    enabled: Boolean(requestId) && enabled,
    queryFn: async (): Promise<EligibleIntervenantRow[]> => {
      const { data, error } = await supabase.rpc("eligible_intervenants", { p_request_id: requestId! });
      if (error) throw error;
      return (data ?? []) as EligibleIntervenantRow[];
    },
  });
}

function useInvalidateInterventions() {
  const queryClient = useQueryClient();
  return (requestId: string) => {
    void queryClient.invalidateQueries({ queryKey: [INTERVENTIONS_KEY, requestId] });
    void queryClient.invalidateQueries({ queryKey: ["request_events", requestId] });
    void queryClient.invalidateQueries({ queryKey: ["request_attachments", requestId] });
    void queryClient.invalidateQueries({ queryKey: [MY_INTERVENTIONS_KEY] });
    // La liste et le tableau de bord de l'intervenant peuvent gagner une demande.
    void queryClient.invalidateQueries({ queryKey: ["requests"] });
  };
}

/** Solliciter — RPC `request_intervention` (statut, droit, éligibilité, date : gardes serveur). */
export function useRequestIntervention() {
  const invalidate = useInvalidateInterventions();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      intervenantId: string;
      /** `AAAA-MM-JJ` */
      requestedFor: string;
      comment: string;
    }): Promise<{ id: string }> => {
      const { data, error } = await supabase.rpc("request_intervention", {
        p_request_id: input.requestId,
        p_intervenant_id: input.intervenantId,
        p_requested_for: input.requestedFor,
        p_comment: input.comment,
      });
      if (error) throw error;
      return (data ?? { id: "" }) as { id: string };
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
}

export interface CompleteInterventionInput {
  interventionId: string;
  requestId: string;
  organizationId: string;
  /** `AAAA-MM-JJ` */
  completedOn: string;
  comment: string;
  /** Justificatifs, quatre au plus : reçus UN PAR UN par la porte unique, puis consommés par la RPC. */
  files: File[];
}

export interface CompleteInterventionResult {
  id: string;
  completed_on: string;
  attachments: number;
}

/**
 * Déclarer réalisée — deux temps, le même ordre que l'ajout d'une pièce :
 *   1. chaque justificatif est REÇU par `request-attachments` avec la portée
 *      `intervention_id` (l'intervenant sollicité, sans droit d'instruction) ;
 *   2. la RPC `complete_request_intervention` reçoit les `upload_id`, les
 *      consomme et déclare — en UNE transaction. Si elle refuse, les pièces
 *      reçues sont retirées de la zone d'attente.
 * `progress` dit à l'écran quel fichier part : quatre photos à 5 Mo sur un
 * téléphone, ça se voit passer.
 */
export function useCompleteIntervention() {
  const invalidate = useInvalidateInterventions();
  const [progress, setProgress] = React.useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (input: CompleteInterventionInput): Promise<CompleteInterventionResult> => {
      const files = input.files.slice(0, MAX_INTERVENTION_FILES);
      const uploadIds: string[] = [];
      try {
        for (const [index, file] of files.entries()) {
          setProgress(`Envoi de ${file.name} (${index + 1}/${files.length})…`);
          const receipt = await stageFile(file, {
            organizationId: input.organizationId,
            requestId: input.requestId,
            interventionId: input.interventionId,
          });
          uploadIds.push(receipt.upload_id);
        }
        setProgress(files.length > 0 ? "Enregistrement de la déclaration…" : null);
        const { data, error } = await supabase.rpc("complete_request_intervention", {
          p_intervention_id: input.interventionId,
          p_completed_on: input.completedOn,
          p_comment: input.comment,
          p_upload_ids: uploadIds,
        });
        if (error) throw error;
        return (data ?? { id: input.interventionId, completed_on: input.completedOn, attachments: 0 }) as unknown as CompleteInterventionResult;
      } catch (err) {
        await discardUploads(uploadIds);
        throw err;
      } finally {
        setProgress(null);
      }
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
  return { ...mutation, progress };
}

/** Ce que la page « Mes interventions » lit de la demande, par jointure. */
export interface MyInterventionRow extends InterventionRow {
  request: {
    id: string;
    reference: string;
    subject: string;
    status: string;
    socle_organization_label: string | null;
    socle_procedure_label: string | null;
  } | null;
}

/**
 * Mes interventions dans le tenant courant. Keyée sur l'id utilisateur, jamais
 * sur l'objet session (piège de l'AuthProvider). Le RLS borne déjà aux lignes
 * que je peux lire ; le filtre `intervenant_id` retire celles que je vois en
 * tant qu'agent sur des demandes que j'instruis.
 */
export function useMyInterventions(orgId: string) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: [MY_INTERVENTIONS_KEY, userId, orgId],
    enabled: Boolean(userId && orgId),
    queryFn: async (): Promise<MyInterventionRow[]> => {
      const { data, error } = await supabase
        .from("request_interventions")
        .select("*, request:requests(id, reference, subject, status, socle_organization_label, socle_procedure_label)")
        .eq("organization_id", orgId)
        .eq("intervenant_id", userId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as MyInterventionRow[];
    },
  });
}
