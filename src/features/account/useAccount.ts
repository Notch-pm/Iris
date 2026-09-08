// Accès « Mon compte » — profil, photo, mot de passe, préférences.
// Un hook par ressource, `queryKey` explicite, invalidation dans `onSuccess`.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  avatarPath, identityPatch, matrixFromRows, rowsFromMatrix,
  type IdentityForm, type PreferenceMatrix, type PreferenceRow,
} from "./account";

export const accountKeys = {
  avatar: (path: string | null) => ["avatar-url", path] as const,
  // Pas de tenant dans la clé : les préférences valent pour TOUS les tenants
  // du compte (décision PO 2026-08-24).
  preferences: () => ["notification-preferences"] as const,
};

/** Durée de l'URL signée. Au-delà, TanStack Query la redemande. */
const AVATAR_URL_TTL_SECONDS = 3600;

/**
 * URL signée de la photo. Le bucket est PRIVÉ : il n'existe pas d'URL stable,
 * et c'est voulu — une photo d'agent est une donnée personnelle, elle ne doit
 * pas être servie à qui connaît l'adresse.
 */
export function useAvatarUrl(path: string | null) {
  return useQuery({
    queryKey: accountKeys.avatar(path),
    enabled: Boolean(path),
    // Redemandée un peu avant l'expiration de la signature.
    staleTime: (AVATAR_URL_TTL_SECONDS - 300) * 1000,
    queryFn: async (): Promise<string | null> => {
      if (!path) return null;
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(path, AVATAR_URL_TTL_SECONDS);
      // Une photo manquante ne doit pas casser le header : on retombe sur les
      // initiales, silencieusement.
      if (error) return null;
      return data?.signedUrl ?? null;
    },
  });
}

/**
 * URLs signées de PLUSIEURS photos, en un seul aller-retour
 * (`createSignedUrls`) : un menu de mentions afficherait sinon une requête par
 * personne. Rend une Map chemin → URL ; un chemin absent de la Map retombe sur
 * les initiales.
 */
export function useAvatarUrls(paths: (string | null | undefined)[]) {
  // Clé stable : triée et dédoublonnée, sinon l'ordre de la liste suffirait à
  // relancer la requête.
  const wanted = Array.from(new Set(paths.filter((p): p is string => Boolean(p)))).sort();
  return useQuery({
    queryKey: ["avatar-url", "batch", wanted.join("|")],
    enabled: wanted.length > 0,
    staleTime: (AVATAR_URL_TTL_SECONDS - 300) * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrls(wanted, AVATAR_URL_TTL_SECONDS);
      const out = new Map<string, string>();
      // Une photo manquante ne casse rien : elle est simplement absente de la
      // Map, et l'appelant affiche les initiales.
      if (error) return out;
      for (const row of data ?? []) {
        if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
      }
      return out;
    },
  });
}

/** Photo de l'utilisateur connecté — enveloppe de confort pour le header. */
export function useMyAvatarUrl() {
  const { profile } = useAuth();
  return useAvatarUrl(profile?.avatar_path ?? null).data ?? null;
}

export function useUploadAvatar() {
  const { session, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? "";

  return useMutation({
    mutationFn: async (file: File) => {
      if (!userId) throw new Error("Session absente.");
      const previous = profile?.avatar_path ?? null;
      const path = avatarPath(userId, file.type, crypto.randomUUID());

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase
        .from("users")
        .update({ avatar_path: path } as never)
        .eq("id", userId);
      if (rowError) {
        // La ligne n'a pas suivi : on retire l'objet pour ne pas laisser
        // d'orphelin, et on remonte l'échec tel quel.
        await supabase.storage.from("avatars").remove([path]);
        throw rowError;
      }

      // L'ancienne photo ne sert plus. Un échec ici est sans conséquence
      // fonctionnelle (objet orphelin) : il ne doit pas faire échouer le geste.
      if (previous && previous !== path) {
        await supabase.storage.from("avatars").remove([previous]);
      }
      return path;
    },
    onSuccess: async () => {
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ["avatar-url"] });
    },
  });
}

export function useRemoveAvatar() {
  const { profile, session, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? "";

  return useMutation({
    mutationFn: async () => {
      const path = profile?.avatar_path ?? null;
      const { error } = await supabase
        .from("users")
        .update({ avatar_path: null } as never)
        .eq("id", userId);
      if (error) throw error;
      if (path) await supabase.storage.from("avatars").remove([path]);
    },
    onSuccess: async () => {
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ["avatar-url"] });
    },
  });
}

/**
 * Identité de l'agent : prénom, nom et coordonnées téléphoniques, écrites
 * directement dans `public.users` — la policy `users_update` autorise déjà
 * l'utilisateur sur SA ligne.
 *
 * ⚠️ Le COURRIEL n'en fait pas partie et n'en fera jamais : c'est
 * l'identifiant de connexion, gardé par `t03_users_protect_email`. Un
 * téléphone, lui, n'est l'identifiant de rien — d'où l'absence de garde.
 */
export function useUpdateIdentity() {
  const { session, refreshProfile } = useAuth();
  return useMutation({
    mutationFn: async (form: IdentityForm) => {
      const userId = session?.user.id ?? "";
      if (!userId) throw new Error("Session absente.");
      const { error } = await supabase
        .from("users")
        .update(identityPatch(form) as never)
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => refreshProfile(),
  });
}

/**
 * Changement de mot de passe.
 *
 * ⚠️ GoTrue n'a pas d'« update password with current password » : `updateUser`
 * accepte le nouveau mot de passe sans jamais demander l'ancien. La
 * revérification est donc faite ICI, par une reconnexion avec l'ancien mot de
 * passe — c'est le seul moyen d'exiger la preuve demandée. Un échec de cette
 * étape laisse la session en place et ne change rien.
 */
export function useChangePassword() {
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (input: { current: string; next: string }) => {
      const email = session?.user.email;
      if (!email) throw new Error("Session absente.");

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: input.current,
      });
      if (signInError) {
        throw new Error("Mot de passe actuel incorrect.");
      }

      const { error } = await supabase.auth.updateUser({ password: input.next });
      if (error) throw error;
    },
  });
}

// ---------------------------------------------------------------------------
// Préférences de notification — GLOBALES au compte, tous tenants confondus
// ---------------------------------------------------------------------------

export function useNotificationPreferences() {
  const { session } = useAuth();
  const userId = session?.user.id ?? "";

  return useQuery({
    queryKey: accountKeys.preferences(),
    enabled: Boolean(userId),
    queryFn: async (): Promise<PreferenceMatrix> => {
      // Aucun filtre de tenant : le RLS ne rend que SES lignes, et elles
      // valent pour tous ses rattachements.
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("kind, in_app, email");
      if (error) throw error;
      return matrixFromRows((data ?? []) as PreferenceRow[]);
    },
  });
}

export function useSaveNotificationPreferences() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? "";

  return useMutation({
    mutationFn: async (matrix: PreferenceMatrix) => {
      if (!userId) throw new Error("Session absente.");
      const rows = rowsFromMatrix(matrix).map((r) => ({
        user_id: userId,
        kind: r.kind,
        in_app: r.in_app,
        email: r.email,
      }));
      // La clé primaire est (user_id, kind) : un upsert suffit, et le RLS
      // revérifie que ce sont bien SES lignes.
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(rows as never, { onConflict: "user_id,kind" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.preferences() }),
  });
}
