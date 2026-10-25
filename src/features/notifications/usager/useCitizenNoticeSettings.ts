// Avis automatiques à l'usager (B12) — l'interrupteur de la collectivité.
// Lecture : tout membre du tenant (policy select). Écriture : la RPC
// `save_citizen_notification_settings` est la SEULE porte ; elle exige
// l'administration de l'organisation principale, ses refus s'affichent tels quels.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const key = (orgId: string) => ["citizen-notification-settings", orgId];

/** Aucune ligne = éteint : c'est le défaut de tout tenant (ADR-7). */
export function useCitizenNoticeSettings(orgId: string) {
  return useQuery({
    queryKey: key(orgId),
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("citizen_notification_settings")
        .select("enabled, updated_at")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return { enabled: data?.enabled ?? false, updatedAt: data?.updated_at ?? null };
    },
  });
}

export function useSaveCitizenNoticeSettings(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.rpc("save_citizen_notification_settings", {
        p_org_id: orgId,
        p_enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId) }),
  });
}
