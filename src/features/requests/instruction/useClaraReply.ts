// Courrier de réponse validé dans Clara (2026-11-12) — accès serveur.
//
// `useReplyViaClara` : la démarche de cette demande fait-elle valider ses
// courriers de réponse dans Clara (réglage Socle ET source clara active) ?
// RPC `request_reply_via_clara`, qui ne révèle qu'un booléen de paramétrage.
//
// `useSubmitClaraReply` : dépose le courrier rédigé par l'agent dans Clara
// (edge `submit-reply-to-clara`). Les gardes vivent en base (RPC
// `reserve_clara_reply`) ; cet écran ne fait que refléter.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import { supabase } from "@/lib/supabase";
import type { ReplyChannel, ReplyOutcome } from "@fn/_shared/clara/reply";

export function useReplyViaClara(requestId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["request_reply_via_clara", requestId],
    enabled: Boolean(requestId) && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("request_reply_via_clara", { p_request_id: requestId! });
      if (error) throw new Error(error.message);
      return data === true;
    },
  });
}

export interface ClaraReplyInput {
  requestId: string;
  submissionId: string;
  outcome: ReplyOutcome;
  motif: string | null;
  closureText: string | null;
  subject: string;
  body: string;
  channel: ReplyChannel;
}

export interface ClaraReplyResult {
  courier_id: string;
  courier_reference: string | null;
  courier_url: string | null;
  duplicate: boolean;
}

export function useSubmitClaraReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClaraReplyInput) =>
      await invokeEdge<ClaraReplyResult>("submit-reply-to-clara", {
        request_id: input.requestId,
        submission_id: input.submissionId,
        outcome: input.outcome,
        motif: input.motif,
        closure_text: input.closureText,
        subject: input.subject,
        body: input.body,
        channel: input.channel,
      }),
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["request", vars.requestId] });
      void queryClient.invalidateQueries({ queryKey: ["request_events", vars.requestId] });
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}
