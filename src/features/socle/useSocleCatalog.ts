// Catalogues Socle synchronisés (miroir d'organisations + cache de démarches).
// Tant que la sync n'a pas tourné, les listes sont vides et l'UI replie sur
// les facettes observées (features/requests/facets.ts).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FacetOption } from "@/features/requests/facets";

export function useSocleOrganizationsCatalog(orgId: string) {
  return useQuery({
    queryKey: ["socle-organizations", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<FacetOption[]> => {
      const { data, error } = await supabase
        .from("socle_organizations")
        .select("socle_id, name")
        .eq("organization_id", orgId)
        .is("obsoleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => ({ value: r.socle_id, label: r.name }));
    },
  });
}

export function useSocleProceduresCatalog(orgId: string) {
  return useQuery({
    queryKey: ["socle-procedures", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<FacetOption[]> => {
      const { data, error } = await supabase
        .from("socle_procedure_cache")
        .select("socle_id, name, category_name")
        .eq("organization_id", orgId)
        .is("obsoleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        value: r.socle_id,
        label: r.category_name ? `${r.name} (${r.category_name})` : r.name,
      }));
    },
  });
}

export interface ProcedureSnapshot {
  id: string;
  name: string;
  organization_id?: string | null;
  type: string | null;
  category_id: string | null;
  form_schema: unknown;
  requester_config: unknown;
}

/**
 * Snapshot de la démarche au moment T, construit côté serveur via socle-proxy.
 * Un échec (null) bloque la création : aucune demande sans démarche — le
 * builder affiche alors un message explicite d'indisponibilité du Socle.
 */
export async function fetchProcedureSnapshot(
  organizationId: string,
  socleProcedureId: string,
): Promise<ProcedureSnapshot | null> {
  try {
    const { data, error } = await supabase.functions.invoke("socle-proxy/v1/procedures/get", {
      body: { organization_id: organizationId, socle_procedure_id: socleProcedureId },
    });
    if (error || !data?.procedure) return null;
    return data.procedure as ProcedureSnapshot;
  } catch {
    return null;
  }
}
