// Recommandations aux agents de la collectivité — relues dans le Socle à chaque
// visite (`socle-proxy /v1/organizations/agent-guidance`), jamais stockées :
// une consigne corrigée ce matin dans le référentiel doit être celle que
// l'agent lit cet après-midi. Même fraîcheur que la fiche d'une démarche.

import { useQuery } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import {
  sanitizeAgentGuidanceView,
  type AgentGuidanceView,
} from "@fn/_shared/organizations/agentGuidance";

export function useAgentGuidance(organizationId: string) {
  return useQuery({
    queryKey: ["agent-guidance", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 300_000,
    retry: false,
    queryFn: async (): Promise<AgentGuidanceView> => {
      const data = await invokeEdge<{ agent_guidance?: unknown }>(
        "socle-proxy/v1/organizations/agent-guidance",
        { organization_id: organizationId },
      );
      // Le navigateur re-parse par défiance : même whitelist que le proxy.
      return sanitizeAgentGuidanceView(data.agent_guidance);
    },
  });
}
