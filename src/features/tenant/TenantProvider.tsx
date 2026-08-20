import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import type { MemberRole } from "@/features/requests/statuts";

export interface TenantMembership {
  organizationId: string;
  organizationName: string;
  role: MemberRole;
}

interface TenantContextValue {
  memberships: TenantMembership[];
  /** Tenant courant (null tant que rien n'est sélectionnable). */
  current: TenantMembership | null;
  setCurrentOrgId: (orgId: string) => void;
  loading: boolean;
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
        .select("role, organization:organizations(id, name, status)")
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? [])
        .filter((row) => row.organization)
        .map((row) => ({
          organizationId: row.organization!.id,
          organizationName: row.organization!.name,
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

  return (
    <TenantContext.Provider value={{ memberships, current, setCurrentOrgId, loading: isLoading }}>
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
