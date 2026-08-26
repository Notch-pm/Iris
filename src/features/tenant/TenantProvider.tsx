import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import type { MemberRole } from "@/features/requests/statuts";
import {
  emptyRights, hasAnyProfile as hasAnyProfileOf, type MyRights,
} from "@/features/rights/rights";
import { useMyRights } from "@/features/rights/useRights";

// `role` reste porté pour compatibilité le temps de la bascule (RM-43 : colonne
// dérivée côté serveur, plus jamais saisie) — les droits effectifs (`rights`)
// sont désormais la seule source de vérité pour ce que l'utilisateur peut voir
// et faire dans le tenant.
export interface TenantMembership {
  organizationId: string;
  organizationName: string;
  /** Racine Socle du tenant — un tenant Iris EST une organisation racine Socle. */
  socleOrgId: string;
  role: MemberRole;
}

interface TenantContextValue {
  memberships: TenantMembership[];
  /** Tenant courant (null tant que rien n'est sélectionnable). */
  current: TenantMembership | null;
  setCurrentOrgId: (orgId: string) => void;
  loading: boolean;
  /** Droits effectifs de l'utilisateur sur le tenant courant (RM-08 : réévalués côté serveur). */
  rights: MyRights;
  rightsLoading: boolean;
  /** Administration quelque part dans le tenant (RM-20) — admin plateforme compris (RM-24). */
  isAdmin: boolean;
  /**
   * Administration de l'ORGANISME PRINCIPAL (racine du tenant). Gouverne ce qui
   * vaut pour tout le sous-arbre et ne se règle donc qu'en haut : le serveur
   * d'envoi (décision PO 2026-08-23).
   */
  /** Au moins un profil de droits actif attribué (CL-01) — hors admin plateforme. */
  hasAnyProfile: boolean;
}

const TenantContext = React.createContext<TenantContextValue | undefined>(undefined);
const STORAGE_KEY = "iris.tenant";

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [selected, setSelected] = React.useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-memberships", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<TenantMembership[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("role, organization:organizations(id, name, socle_org_id, status)")
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? [])
        .filter((row) => row.organization)
        .map((row) => ({
          organizationId: row.organization!.id,
          organizationName: row.organization!.name,
          socleOrgId: row.organization!.socle_org_id,
          role: row.role as MemberRole,
        }))
        .sort((a, b) => a.organizationName.localeCompare(b.organizationName, "fr"));
    },
  });

  const memberships = React.useMemo(() => data ?? [], [data]);
  const current = React.useMemo(() => {
    if (memberships.length === 0) return null;
    return memberships.find((m) => m.organizationId === selected) ?? memberships[0];
  }, [memberships, selected]);

  const setCurrentOrgId = React.useCallback((orgId: string) => {
    localStorage.setItem(STORAGE_KEY, orgId);
    setSelected(orgId);
  }, []);

  const orgId = current?.organizationId ?? "";
  const rightsQuery = useMyRights(orgId);
  const rights = rightsQuery.data ?? emptyRights(orgId);
  const isAdmin = rights.is_platform_admin || rights.is_admin;
  const hasAnyProfile = hasAnyProfileOf(rights);

  return (
    <TenantContext.Provider
      value={{
        memberships,
        current,
        setCurrentOrgId,
        loading: isLoading,
        rights,
        rightsLoading: rightsQuery.isLoading,
        isAdmin,
        hasAnyProfile,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = React.useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}

/** Tenant courant garanti — à n'utiliser que sous une garde d'existence. */
export function useCurrentTenant(): TenantMembership {
  const { current } = useTenant();
  if (!current) throw new Error("Aucun tenant sélectionné");
  return current;
}
