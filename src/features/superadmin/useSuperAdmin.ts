// Données de la zone superadmin. Lecture et appartenances passent par le RLS
// (l'admin plateforme court-circuite les helpers) ; seules l'invitation d'un
// compte, l'envoi d'un lien de mot de passe et la suppression passent par
// l'edge function admin-users (service role).
//
// Aucun mot de passe ne transite plus par cet écran : un compte s'ouvre par un
// lien d'activation envoyé à son titulaire (docs/emails.md).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeAdminUsers } from "@/lib/adminUsers";
import { identityPatch, type IdentityForm } from "@/features/account/account";
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

export interface InviteResult {
  user_id: string;
  email: string;
  /** Un compte a été créé (faux si un compte existant a simplement été rattaché). */
  invited: boolean;
  email_sent: boolean;
  /** Renseigné quand le compte est créé mais que le message n'est pas parti. */
  email_error?: string;
  message?: string;
}

/**
 * Invitation : création du compte, rattachement au tenant et envoi du lien
 * d'activation sont faits d'un bloc côté serveur — plus de compte à moitié
 * créé si le rattachement échoue.
 */
export function useInviteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: {
      email: string;
      identity: IdentityForm;
      organizationId: string | null;
    }): Promise<InviteResult> => {
      const patch = identityPatch(input.identity);
      return invokeAdminUsers<InviteResult>({
        action: "invite_user",
        email: input.email,
        first_name: patch.first_name ?? "",
        last_name: patch.last_name ?? "",
        landline_phone: patch.landline_phone ?? "",
        mobile_phone: patch.mobile_phone ?? "",
        organization_id: input.organizationId,
      });
    },
    onSuccess: () => invalidate(),
  });
}

export interface PasswordResetResult {
  user_id: string;
  email: string;
  email_sent: boolean;
}

/** Envoie au titulaire un lien de réinitialisation — l'admin ne voit aucun secret. */
export function useSendPasswordReset() {
  return useMutation({
    mutationFn: async (userId: string): Promise<PasswordResetResult> =>
      invokeAdminUsers<PasswordResetResult>({ action: "send_password_reset", user_id: userId }),
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (userId: string) => invokeAdminUsers({ action: "delete_user", user_id: userId }),
    onSuccess: () => invalidate(),
  });
}

/**
 * Identité d'un compte, vue de l'administration de plateforme.
 *
 * L'identité proprement dite (nom, prénom, téléphones) est taillée par
 * `identityPatch`, le MÊME module que « Mon compte » : deux écrans écrivent ces
 * colonnes, ils ne doivent pas avoir deux idées de ce qu'est un champ vide.
 * `is_platform_admin` s'y ajoute — il n'appartient qu'à cet écran, et sa garde
 * (`t01_users_prevent_admin_escalation`) reste en base.
 */
export function useUpdateUserProfile() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      identity: IdentityForm;
      isPlatformAdmin: boolean;
    }) => {
      const { error } = await supabase
        .from("users")
        .update({
          ...identityPatch(input.identity),
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
