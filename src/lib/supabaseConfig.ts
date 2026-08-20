export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

/**
 * Valide la configuration Supabase du frontend. Échoue explicitement au
 * démarrage plutôt que de laisser le client produire des erreurs réseau
 * incompréhensibles plus tard (même exigence que Socle).
 */
export function readSupabaseConfig(env: Record<string, unknown>): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL;
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (typeof url !== "string" || url.length === 0) {
    throw new Error(
      "Configuration Supabase manquante : VITE_SUPABASE_URL n'est pas définie. " +
        "Copiez .env.example en .env.local et renseignez les valeurs (voir docs/demarrage.md).",
    );
  }
  if (typeof publishableKey !== "string" || publishableKey.length === 0) {
    throw new Error(
      "Configuration Supabase manquante : VITE_SUPABASE_PUBLISHABLE_KEY n'est pas définie. " +
        "Copiez .env.example en .env.local et renseignez les valeurs (voir docs/demarrage.md).",
    );
  }

  return { url, publishableKey };
}
