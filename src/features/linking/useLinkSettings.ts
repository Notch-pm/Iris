// Demandes liées — lecture et écriture du réglage par démarche.
// Écriture : la RPC `save_procedure_link_settings` est la SEULE porte (aucune
// policy d'écriture cliente) ; elle exige l'administration de l'organisation
// principale et ses refus sont affichés tels quels.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { LinkSettingRow } from "./linking";

export function useLinkSettings(orgId: string) {
  return useQuery({
    queryKey: ["procedure-link-settings", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<LinkSettingRow[]> => {
      const { data, error } = await supabase
        .from("procedure_link_settings")
        .select("socle_procedure_id, enabled, radius_m, window_days")
        .eq("organization_id", orgId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface SaveLinkSettingInput {
  procedureId: string;
  enabled: boolean;
  radiusM: number;
  windowDays: number;
}

export function useSaveLinkSetting(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveLinkSettingInput) => {
      const { error } = await supabase.rpc("save_procedure_link_settings", {
        p_org_id: orgId,
        p_procedure_id: input.procedureId,
        p_enabled: input.enabled,
        p_radius_m: input.radiusM,
        p_window_days: input.windowDays,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["procedure-link-settings", orgId] }),
  });
}
