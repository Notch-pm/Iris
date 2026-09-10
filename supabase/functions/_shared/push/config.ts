// Configuration VAPID — module PUR, testé. Le transport (`transport.ts`) est
// la seule brique de ce dossier à dépendre du runtime.

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` ou `https:` — le contact que le service de push peut joindre. */
  subject: string;
}

/**
 * Lit les trois secrets. Un seul absent ⇒ `null` : le facteur répond 503 SANS
 * réclamer de lot, pour ne pas consommer les tentatives d'une file qu'il ne
 * peut pas servir.
 */
export function readVapid(env: Record<string, string | undefined>): VapidConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (env.VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** Durée de vie d'un push en attente chez le service : 24 h — un téléphone
 *  éteint le week-end doit encore recevoir l'affectation de vendredi. */
export const PUSH_TTL_SECONDS = 86_400;
