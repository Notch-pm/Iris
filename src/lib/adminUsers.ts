import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Appel de l'edge function `admin-users` (invitation, lien de mot de passe,
 * test d'envoi, suppression). Elle est appelée depuis deux zones — superadmin
 * et Paramètres du tenant — d'où ce point d'entrée unique.
 *
 * Le corps d'erreur `{ error: { code, message } }` est déballé pour que les
 * écrans affichent le message métier plutôt qu'un « FunctionsHttpError ».
 */
export async function invokeAdminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await error.context.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      throw new Error(payload?.error?.message ?? "Erreur serveur.");
    }
    throw new Error("Service d'administration injoignable.");
  }
  return data as T;
}
