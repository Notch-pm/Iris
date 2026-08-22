// Droits effectifs du tenant courant — enveloppe TanStack Query autour de la
// RPC my_rights (RM-08 : réévalués côté serveur à chaque appel, jamais
// calculés côté client). ⚠️ Keyée sur l'id utilisateur, jamais sur l'objet
// session (même piège que AuthProvider/TenantProvider — supabase-js réémet un
// nouvel objet session à chaque retour d'onglet).

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { ALL_RIGHTS, emptyRights, type MyRights, type ProfileStatus, type Right } from "./rights";

function isRight(v: unknown): v is Right {
  return typeof v === "string" && (ALL_RIGHTS as readonly string[]).includes(v);
}

function parseRightsArray(raw: unknown): Right[] {
  return Array.isArray(raw) ? raw.filter(isRight) : [];
}

function parseStatus(raw: unknown): ProfileStatus {
  return raw === "inactive" ? "inactive" : "active";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * JSON de la RPC `my_rights(p_org_id)` → `MyRights`, défensivement (le
 * serveur fait foi, mais une forme inattendue ne doit jamais faire planter
 * l'UI) : toute clé absente ou mal typée replie sur la valeur vide.
 */
export function parseMyRights(raw: unknown, orgId: string): MyRights {
  const fallback = emptyRights(orgId);
  if (!isRecord(raw)) return fallback;
  const profilesRaw = Array.isArray(raw.profiles) ? raw.profiles : [];
  return {
    organization_id: typeof raw.organization_id === "string" ? raw.organization_id : orgId,
    is_platform_admin: raw.is_platform_admin === true,
    is_admin: raw.is_admin === true,
    no_procedure_id: typeof raw.no_procedure_id === "string" ? raw.no_procedure_id : fallback.no_procedure_id,
    profiles: profilesRaw.filter(isRecord).map((p) => ({
      id: typeof p.id === "string" ? p.id : "",
      name: typeof p.name === "string" ? p.name : "",
      status: parseStatus(p.status),
      is_admin: p.is_admin === true,
      scope_organization_ids: Array.isArray(p.scope_organization_ids)
        ? p.scope_organization_ids.filter((v): v is string => typeof v === "string")
        : [],
      procedures: isRecord(p.procedures)
        ? Object.fromEntries(Object.entries(p.procedures).map(([k, v]) => [k, parseRightsArray(v)]))
        : {},
      default: parseRightsArray(p.default),
    })),
  };
}

/** Droits effectifs de l'utilisateur courant sur `orgId` — repli `emptyRights` avant chargement. */
export function useMyRights(orgId: string) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: ["my-rights", userId, orgId],
    enabled: Boolean(userId && orgId),
    queryFn: async (): Promise<MyRights> => {
      const { data, error } = await supabase.rpc("my_rights", { p_org_id: orgId });
      if (error) throw error;
      return parseMyRights(data, orgId);
    },
  });
}

/** À invoquer après toute mutation de profils ou d'attributions (RM-08 : effet immédiat). */
export function invalidateRights(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["my-rights"] });
}
