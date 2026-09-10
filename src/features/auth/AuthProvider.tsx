import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { forgetDevicePush } from "@/features/notifications/usePushSubscription";
import type { Tables } from "@/types/database.types";

type Profile = Tables<"users">;

interface AuthContextValue {
  session: Session | null;
  /** Ligne public.users de l'utilisateur courant (is_platform_admin, noms). */
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Relit `public.users` après une modification faite par l'utilisateur
   *  lui-même (nom, photo) — « Mon compte ». Ne touche PAS à `loading` : le
   *  shell ne doit pas se démonter pour un rafraîchissement de profil. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // ⚠️ Keyé sur l'id utilisateur, PAS sur l'objet session : supabase-js ré-émet
  // SIGNED_IN / TOKEN_REFRESHED avec un NOUVEL objet session à chaque retour sur
  // l'onglet ; keyer sur l'objet repasserait `loading` à true, afficherait
  // l'écran de chargement des routes protégées et démonterait toute la page
  // (perte des saisies en cours). Piège documenté et vécu chez Socle.
  const userId = session?.user.id ?? null;

  React.useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);

    supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setProfile(data);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const signOut = React.useCallback(async () => {
    // Poste partagé : cet appareil ne doit pas continuer à recevoir les
    // notifications push du titulaire qui s'en va. Best effort, jamais bloquant.
    try { await forgetDevicePush(); } catch { /* ignoré */ }
    await supabase.auth.signOut();
  }, []);

  // ⚠️ Volontairement SANS setLoading : passer `loading` à true ferait
  // retomber les routes protégées sur leur écran de chargement et démonterait
  // la page en cours — exactement le piège que le keyage sur `userId`
  // ci-dessus évite. Un rafraîchissement de profil est silencieux.
  const refreshProfile = React.useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
    setProfile(data);
  }, [userId]);

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
