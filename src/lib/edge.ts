// Invocation des edge functions Iris avec relais du message d'erreur français
// (enveloppe { error: { code, message } } de la gamme).

import { supabase } from "@/lib/supabase";

export interface EdgeError extends Error {
  code?: string;
  /** Erreurs par champ (ex. validation de formulaire de démarche). */
  fields?: Record<string, string>;
}

async function throwEdgeError(error: unknown): Promise<never> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    const parsed = await ctx.json().catch(() => null) as
      | { error?: { code?: string; message?: string; fields?: Record<string, string> } }
      | null;
    if (typeof parsed?.error?.message === "string") {
      const err = new Error(parsed.error.message) as EdgeError;
      err.code = parsed.error.code;
      err.fields = parsed.error.fields;
      throw err;
    }
  }
  throw new Error("Serveur injoignable — réessayez dans un instant.");
}

export async function invokeEdge<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(path, { body });
  if (error) await throwEdgeError(error);
  return data as T;
}

/**
 * Envoi d'un formulaire multipart (un fichier) à une edge function. Le
 * navigateur pose lui-même le `Content-Type` avec sa frontière : ne jamais le
 * fixer ici. `query` porte le périmètre (organisation, demande) dans l'URL,
 * pour que le serveur vérifie les droits AVANT de lire le corps.
 */
export async function invokeEdgeForm<T>(
  path: string,
  form: FormData,
  query: Record<string, string> = {},
): Promise<T> {
  const qs = new URLSearchParams(query).toString();
  const { data, error } = await supabase.functions.invoke(qs ? `${path}?${qs}` : path, { body: form });
  if (error) await throwEdgeError(error);
  return data as T;
}
