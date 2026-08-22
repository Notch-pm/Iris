// Données de la zone superadmin. Lecture et appartenances passent par le RLS
// (l'admin plateforme court-circuite les helpers) ; seules la création de
// compte, la réinitialisation de mot de passe et la suppression passent par
// l'edge function admin-users (service role).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database.types";
import type { SocleOrgRow } from "./socleOrgTree";

export type TenantRow = Tables<"organizations">;
export type UserRow = Tables<"users">;

export interface MembershipRow {
  organization_id: string;
  user_id: string;
  role: string;
}

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error?.message ?? "Erreur serveur.");
    }
    throw new Error("Service d'administration injoignable.");
  }
  return data as T;
}

export function useAllTenants() {
  return useQuery({
    queryKey: ["sa-tenants"],
    queryFn: async (): Promise<TenantRow[]> => {
      const { data, error } = await supabase.from("organizations").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTenantTreeRows(orgId: string) {
  return useQuery({
    queryKey: ["sa-tenant-tree", orgId],
    queryFn: async (): Promise<SocleOrgRow[]> => {
      const { data, error } = await supabase
        .from("socle_organizations")
        .select("socle_id, socle_parent_id, name, status, obsoleted_at")
        .eq("organization_id", orgId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLastSyncRun() {
  return useQuery({
    queryKey: ["sa-last-sync"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useAllUsers() {
  return useQuery({
    queryKey: ["sa-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const { data, error } = await supabase.from("users").select("*").order("email");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAllMemberships() {
  return useQuery({
    queryKey: ["sa-memberships"],
    queryFn: async (): Promise<MembershipRow[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("organization_id, user_id, role");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface ProfileAssignmentInfo {
  organization_id: string;
  user_id: string;
  profile_id: string;
  profile_name: string;
  profile_status: string;
}

/**
 * Profils attribués, tous tenants confondus — lecture seule (l'attribution
 * reste un geste du tenant, RM-44). L'admin plateforme voit tout via le RLS.
 */
export function useAllProfileAssignments() {
  return useQuery({
    queryKey: ["sa-profile-assignments"],
    queryFn: async (): Promise<ProfileAssignmentInfo[]> => {
      const { data, error } = await supabase
        .from("permission_profile_assignments")
        .select("organization_id, user_id, profile:permission_profiles(id, name, status)");
      if (error) throw error;
      return (data ?? [])
        .filter((r) => r.profile)
        .map((r) => ({
          organization_id: r.organization_id,
          user_id: r.user_id,
          profile_id: r.profile!.id,
          profile_name: r.profile!.name,
          profile_status: r.profile!.status,
        }));
    },
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["sa-users"] });
    void queryClient.invalidateQueries({ queryKey: ["sa-memberships"] });
    void queryClient.invalidateQueries({ queryKey: ["sa-profile-assignments"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant-memberships"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant-members"] });
    void queryClient.invalidateQueries({ queryKey: ["my-rights"] });
  };
}

export interface CreatedAccount {
  user_id: string;
  email: string;
  /** Affiché UNE SEULE FOIS à l'admin plateforme. */
  password: string;
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: {
      email: string;
      firstName: string;
      lastName: string;
      membership: { organizationId: string } | null;
    }): Promise<CreatedAccount> => {
      const created = await invokeAdmin<CreatedAccount>({
        action: "create_user",
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
      });
      if (input.membership) {
        // RM-43/RM-44 : le rattachement est un simple accès au tenant, sans
        // rôle — `role` n'est plus qu'un filet de compatibilité, écrasé côté
        // serveur par la colonne dérivée (administration = un profil actif
        // is_admin attribué). L'attribution d'un profil de droits est un
        // geste du tenant (Paramètres), pas de la plateforme.
        const { error } = await supabase.from("organization_members").insert({
          organization_id: input.membership.organizationId,
          user_id: created.user_id,
          role: "agent",
        } as never);
        if (error) throw new Error("Compte créé, mais rattachement au tenant en échec : " + error.message);
      }
      return created;
    },
    onSuccess: () => invalidate(),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (userId: string): Promise<CreatedAccount> =>
      invokeAdmin<CreatedAccount>({ action: "set_password", user_id: userId }),
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (userId: string) => invokeAdmin({ action: "delete_user", user_id: userId }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateUserProfile() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      firstName: string;
      lastName: string;
      isPlatformAdmin: boolean;
    }) => {
      const { error } = await supabase
        .from("users")
        .update({
          first_name: input.firstName.trim() === "" ? null : input.firstName.trim(),
          last_name: input.lastName.trim() === "" ? null : input.lastName.trim(),
          is_platform_admin: input.isPlatformAdmin,
        } as never)
        .eq("id", input.userId);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
}

/** « Donner accès » à un tenant — sans rôle (RM-44) : `role` reste envoyé pour compatibilité, écrasé côté serveur. */
export function useSetMembership() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: { organizationId: string; userId: string }) => {
      const { error } = await supabase.from("organization_members").upsert(
        {
          organization_id: input.organizationId,
          user_id: input.userId,
          role: "agent",
        } as never,
        { onConflict: "organization_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
}

export function useRemoveMembership() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: { organizationId: string; userId: string }) => {
      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("organization_id", input.organizationId)
        .eq("user_id", input.userId);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
}
