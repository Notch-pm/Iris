// Avis à l'usager (B12) — le jeton de DÉSINSCRIPTION (ADR-12). Module PUR, testé.
//
// HMAC, sans stockage ni expiration : il ne permet qu'une chose, désinscrire
// CETTE demande (invité) ou CETTE fiche (compte). Sa clé est dérivée du secret
// des jetons usager avec un préfixe de finalité propre : un jeton de
// désinscription n'est jamais un jeton d'accès, ni l'inverse.
//
// Le lien mène à une page DU PORTAIL (Nora), à la charte de la collectivité :
// Iris ne sert aucune page à un usager. Le chemin est un CONTRAT avec Nora
// (lot L4c-4) ; la page relaie le jeton à `POST /v1/citizen/notifications/unsubscribe`.

export const UNSUBSCRIBE_PATH = "/notifications/desinscription";
const PURPOSE = "iris:desinscription:v1";

export type UnsubscribeTarget = { kind: "invite" } | { kind: "compte"; contactId: string };

export interface UnsubscribeClaims {
  requestId: string;
  channel: "email";
  target: UnsubscribeTarget;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const raw = typeof key === "string" ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

const derivedKey = (secret: string) => hmac(secret, PURPOSE);

function payloadOf(claims: UnsubscribeClaims): string {
  const target = claims.target.kind === "invite" ? "invite" : `compte:${claims.target.contactId}`;
  return `v1|${claims.requestId}|${claims.channel}|${target}`;
}

export async function unsubscribeToken(secret: string, claims: UnsubscribeClaims): Promise<string> {
  const payload = payloadOf(claims);
  return `${b64url(enc.encode(payload))}.${b64url(await hmac(await derivedKey(secret), payload))}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `null` pour tout jeton illisible, falsifié ou d'une autre finalité — sans dire lequel. */
export async function verifyUnsubscribeToken(secret: string, token: unknown): Promise<UnsubscribeClaims | null> {
  if (typeof token !== "string" || token.length > 400) return null;
  const [p, m, extra] = token.split(".");
  if (!p || !m || extra !== undefined) return null;
  const payloadBytes = fromB64url(p);
  const mac = fromB64url(m);
  if (!payloadBytes || !mac) return null;
  const payload = new TextDecoder().decode(payloadBytes);
  const expected = await hmac(await derivedKey(secret), payload);
  if (expected.length !== mac.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac[i] ^ expected[i];
  if (diff !== 0) return null;

  const [v, requestId, channel, target, more] = payload.split("|");
  if (v !== "v1" || more !== undefined || !UUID.test(requestId ?? "") || channel !== "email") return null;
  if (target === "invite") return { requestId, channel, target: { kind: "invite" } };
  const contactId = target?.startsWith("compte:") ? target.slice("compte:".length) : "";
  return UUID.test(contactId) ? { requestId, channel, target: { kind: "compte", contactId } } : null;
}

/** La page du portail, sur l'origine du lien de l'avis (espace ou suivi) ; `null` si elle est illisible. */
export function unsubscribeUrl(linkUrl: string, token: string): string | null {
  try {
    const url = new URL(UNSUBSCRIBE_PATH, new URL(linkUrl).origin);
    url.searchParams.set("jeton", token);
    return url.toString();
  } catch {
    return null;
  }
}
