// Données de la zone Paramètres — Droits. Lecture par le RLS (les
// administrateurs voient tous les profils du tenant, un agent seulement les
// siens — cf. spec § profils) ; les mutations passent par les RPC dédiées
// (`save_permission_profile` etc.) dont les erreurs Postgres sont déjà en
// français et affichées telles quelles (RM-09). Toute mutation invalide la
// feature ET `my-rights` ET `tenant-memberships` (RM-08/RM-43 : effet
// immédiat, rôle dérivé).

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/database.types";
import type { SocleOrgRow } from "@/features/superadmin/socleOrgTree";
import {
  buildProfileRows,
  type ProfileAssignmentRow,
  type ProfileOrgRow,
  type ProfileProcedureRow,
  type ProfileRow,
} from "./profileRows";
import { toSavePayload, type ProfileDraft } from "./profileValidation";

const PROFILES_KEY = "permission-profiles";
const MEMBERS_KEY = "permission-members";
const MEMBERS_WITHOUT_PROFILE_KEY = "permission-members-without-profile";
const COVERAGE_KEY = "permission-coverage";
const AUDIT_LOG_KEY = "permission-audit-log";

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Profils du tenant avec périmètre + matrice fusionnés (3 requêtes, RLS = source de vérité). */
export function useTenantProfiles(orgId: string) {
  return useQuery({
    queryKey: [PROFILES_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<ProfileRow[]> => {
      const { data: profiles, error: profilesError } = await supabase
        .from("permission_profiles")
        .select("*")
        .eq("organization_id", orgId)
        .order("name");
      if (profilesError) throw profilesError;
      const ids = (profiles ?? []).map((p) => p.id);
      if (ids.length === 0) return [];

      const [orgsRes, proceduresRes, assignmentsRes] = await Promise.all([
        supabase.from("permission_profile_organizations").select("profile_id, socle_org_id").in("profile_id", ids),
        supabase.from("permission_profile_procedures").select("*").in("profile_id", ids),
        supabase.from("permission_profile_assignments").select("profile_id, user_id").eq("organization_id", orgId),
      ]);
      if (orgsRes.error) throw orgsRes.error;
      if (proceduresRes.error) throw proceduresRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      return buildProfileRows(
        profiles ?? [],
        (orgsRes.data ?? []) as ProfileOrgRow[],
        (proceduresRes.data ?? []) as ProfileProcedureRow[],
        (assignmentsRes.data ?? []) as ProfileAssignmentRow[],
      );
    },
  });
}

export interface MemberProfileChip {
  id: string;
  name: string;
  status: "active" | "inactive";
}

export interface MemberRow {
  userId: string;
  displayName: string;
  email: string;
  /** Rôle dérivé côté serveur (RM-43) — chip « Administrateur ». */
  isAdmin: boolean;
  assignedProfiles: MemberProfileChip[];
}

/** Membres du tenant (organization_members + users) avec leurs profils attribués. */
export function useTenantMemberRows(orgId: string) {
  return useQuery({
    queryKey: [MEMBERS_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<MemberRow[]> => {
      const [membersRes, assignmentsRes] = await Promise.all([
        supabase
          .from("organization_members")
          .select("user_id, role, user:users(id, email, first_name, last_name)")
          .eq("organization_id", orgId),
        supabase
          .from("permission_profile_assignments")
          .select("user_id, profile:permission_profiles(id, name, status)")
          .eq("organization_id", orgId),
      ]);
      if (membersRes.error) throw membersRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      const byUser = new Map<string, MemberProfileChip[]>();
      for (const a of assignmentsRes.data ?? []) {
        if (!a.profile) continue;
        const list = byUser.get(a.user_id) ?? [];
        list.push({
          id: a.profile.id,
          name: a.profile.name,
          status: a.profile.status === "inactive" ? "inactive" : "active",
        });
        byUser.set(a.user_id, list);
      }

      return (membersRes.data ?? [])
        .filter((m) => m.user)
        .map((m) => ({
          userId: m.user_id,
          displayName: [m.user!.first_name, m.user!.last_name].filter(Boolean).join(" ") || m.user!.email,
          email: m.user!.email,
          isAdmin: m.role === "administrateur",
          assignedProfiles: byUser.get(m.user_id) ?? [],
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
    },
  });
}

export interface MemberWithoutProfileRow {
  user_id: string;
  display_name: string;
  email: string;
}

/** RM-63 : membres du tenant sans aucun profil actif attribué. */
export function useMembersWithoutProfile(orgId: string) {
  return useQuery({
    queryKey: [MEMBERS_WITHOUT_PROFILE_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<MemberWithoutProfileRow[]> => {
      const { data, error } = await supabase.rpc("members_without_profile", { p_org_id: orgId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CoverageRow {
  socle_org_id: string;
  org_name: string;
  socle_procedure_id: string;
  procedure_name: string;
  open_requests: number;
}

/** RM-62 : couples (organisation × démarche active) non couverts au niveau instruction. */
export function useCoverageReport(orgId: string) {
  return useQuery({
    queryKey: [COVERAGE_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<CoverageRow[]> => {
      const { data, error } = await supabase.rpc("permission_coverage_report", { p_org_id: orgId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface AuditActorInfo {
  name: string;
  email: string;
}

export interface AuditLogRow {
  id: string;
  created_at: string;
  action: string;
  profile_id: string | null;
  profile_name: string;
  actor: AuditActorInfo | null;
  target: AuditActorInfo | null;
  before: unknown;
  after: unknown;
}

function actorName(u: { first_name: string | null; last_name: string | null; email: string } | undefined): AuditActorInfo | null {
  if (!u) return null;
  return { name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email, email: u.email };
}

/**
 * RM-57 : les 50 dernières entrées du journal des droits (qui, quand, quoi,
 * avant/après). Deux requêtes plutôt qu'un embed PostgREST : `permission_audit_log`
 * référence `users` par deux colonnes distinctes (`actor_id`, `target_user_id`),
 * et le typage généré des embeds désambiguïsés par `!fkey` de supabase-js ne
 * résout pas correctement ce cas (constaté ici) — un second aller-retour,
 * simple et fiable, résout les noms.
 */
export function useAuditLog(orgId: string) {
  return useQuery({
    queryKey: [AUDIT_LOG_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<AuditLogRow[]> => {
      const { data, error } = await supabase
        .from("permission_audit_log")
        .select("id, created_at, action, profile_id, profile_name, before, after, actor_id, target_user_id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = data ?? [];
      const userIds = [...new Set(rows.flatMap((r) => [r.actor_id, r.target_user_id]).filter((id): id is string => Boolean(id)))];
      const usersById = new Map<string, { first_name: string | null; last_name: string | null; email: string }>();
      if (userIds.length > 0) {
        const { data: users, error: usersError } = await supabase
          .from("users")
          .select("id, first_name, last_name, email")
          .in("id", userIds);
        if (usersError) throw usersError;
        for (const u of users ?? []) usersById.set(u.id, u);
      }
      return rows.map((row) => ({
        id: row.id,
        created_at: row.created_at,
        action: row.action,
        profile_id: row.profile_id,
        profile_name: row.profile_name,
        before: row.before,
        after: row.after,
        actor: actorName(row.actor_id ? usersById.get(row.actor_id) : undefined),
        target: actorName(row.target_user_id ? usersById.get(row.target_user_id) : undefined),
      }));
    },
  });
}

/** Miroir des organisations Socle du tenant (arbre + `obsoleted_at`) — OrgScopePicker. */
export function useSocleOrgRows(orgId: string) {
  return useQuery({
    queryKey: ["permission-socle-orgs", orgId],
    enabled: Boolean(orgId),
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

export interface ProcedureCacheFullRow {
  socle_id: string;
  name: string;
  category_name: string | null;
  obsoleted_at: string | null;
}

/** Démarches actives ET obsolètes du cache (ProfileMatrix : affiche « Obsolète » sur les lignes existantes). */
export function useAllProcedureRows(orgId: string) {
  return useQuery({
    queryKey: ["permission-procedures-all", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<ProcedureCacheFullRow[]> => {
      const { data, error } = await supabase
        .from("socle_procedure_cache")
        .select("socle_id, name, category_name, obsoleted_at")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface ReferentielStatus {
  activeOrganizations: number;
  obsoleteOrganizations: number;
  activeProcedures: number;
  obsoleteProcedures: number;
  /** Dernière synchronisation observée sur le miroir du tenant (ISO) — null si jamais synchronisé. */
  lastSyncedAt: string | null;
}

/**
 * État du référentiel Socle du tenant (onglet Référentiel) : lu sur le miroir
 * et le cache (lisibles par tout membre) — `sync_runs` reste réservé à la
 * plateforme, la date de dernière sync se déduit de `synced_at`.
 */
export function useReferentielStatus(orgId: string) {
  return useQuery({
    queryKey: ["permission-referentiel", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<ReferentielStatus> => {
      const [orgs, procs] = await Promise.all([
        supabase.from("socle_organizations").select("synced_at, obsoleted_at").eq("organization_id", orgId),
        supabase.from("socle_procedure_cache").select("synced_at, obsoleted_at").eq("organization_id", orgId),
      ]);
      if (orgs.error) throw orgs.error;
      if (procs.error) throw procs.error;
      const o = orgs.data ?? [];
      const p = procs.data ?? [];
      const dates = [...o, ...p].map((r) => r.synced_at).filter((d): d is string => Boolean(d)).sort();
      return {
        activeOrganizations: o.filter((r) => !r.obsoleted_at).length,
        obsoleteOrganizations: o.filter((r) => Boolean(r.obsoleted_at)).length,
        activeProcedures: p.filter((r) => !r.obsoleted_at).length,
        obsoleteProcedures: p.filter((r) => Boolean(r.obsoleted_at)).length,
        lastSyncedAt: dates.length > 0 ? dates[dates.length - 1] : null,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function useInvalidatePermissions(orgId: string) {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    for (const key of [PROFILES_KEY, MEMBERS_KEY, MEMBERS_WITHOUT_PROFILE_KEY, COVERAGE_KEY, AUDIT_LOG_KEY]) {
      void queryClient.invalidateQueries({ queryKey: [key, orgId] });
    }
    // Effet immédiat (RM-08) et rôle dérivé (RM-43) : les deux repères
    // globaux du shell doivent refléter la modification sans reconnexion.
    void queryClient.invalidateQueries({ queryKey: ["my-rights"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant-memberships"] });
  }, [queryClient, orgId]);
}

function rpcError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export interface SaveProfileResult {
  id: string;
  version: number;
}

export function useSaveProfile(orgId: string) {
  const invalidate = useInvalidatePermissions(orgId);
  return useMutation({
    mutationFn: async (input: {
      draft: ProfileDraft;
      profileId?: string;
      expectedVersion?: number;
    }): Promise<SaveProfileResult> => {
      const payload = toSavePayload(input.draft, orgId, input.profileId, input.expectedVersion);
      const { data, error } = await supabase.rpc("save_permission_profile", { p: payload as unknown as Json });
      rpcError(error);
      return data as unknown as SaveProfileResult;
    },
    onSuccess: () => invalidate(),
  });
}

export function useSetProfileStatus(orgId: string) {
  const invalidate = useInvalidatePermissions(orgId);
  return useMutation({
    mutationFn: async (input: { profileId: string; status: "active" | "inactive"; expectedVersion: number }) => {
      const { error } = await supabase.rpc("set_permission_profile_status", {
        p_profile_id: input.profileId,
        p_status: input.status,
        p_expected_version: input.expectedVersion,
      });
      rpcError(error);
    },
    onSuccess: () => invalidate(),
  });
}

export function useDeleteProfile(orgId: string) {
  const invalidate = useInvalidatePermissions(orgId);
  return useMutation({
    mutationFn: async (input: { profileId: string; expectedVersion: number }) => {
      const { error } = await supabase.rpc("delete_permission_profile", {
        p_profile_id: input.profileId,
        p_expected_version: input.expectedVersion,
      });
      rpcError(error);
    },
    onSuccess: () => invalidate(),
  });
}

export function useAssignProfile(orgId: string) {
  const invalidate = useInvalidatePermissions(orgId);
  return useMutation({
    mutationFn: async (input: { profileId: string; userId: string }) => {
      const { error } = await supabase.rpc("assign_permission_profile", {
        p_profile_id: input.profileId,
        p_user_id: input.userId,
      });
      rpcError(error);
    },
    onSuccess: () => invalidate(),
  });
}

export function useRevokeProfile(orgId: string) {
  const invalidate = useInvalidatePermissions(orgId);
  return useMutation({
    mutationFn: async (input: { profileId: string; userId: string }) => {
      const { error } = await supabase.rpc("revoke_permission_profile", {
        p_profile_id: input.profileId,
        p_user_id: input.userId,
      });
      rpcError(error);
    },
    onSuccess: () => invalidate(),
  });
}
