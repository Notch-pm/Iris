// Code d'accès invité de l'usager — LOGIQUE PURE (WebCrypto seul : Deno et
// vitest), testée.
//
// L'usager qui dépose sans compte et accepte le suivi en ligne reçoit un code
// tiré ici ; avec son adresse et la référence, il ouvre sur le portail une
// vue de SA demande (migration 20261019150000_acces_usager_invite.sql).
//
//   · 10 caractères dans l'alphabet base32 de Crockford (sans I, L, O, U) :
//     50 bits, et rien qu'un usager puisse confondre en le recopiant —
//     `normalizeAccessCode` ramène O→0, I/L→1 et ignore espaces et tirets ;
//   · Iris n'en garde qu'une empreinte HMAC-SHA256 POIVRÉE
//     (IRIS_ACCESS_CODE_PEPPER), comme l'adresse : sans le poivre, une fuite
//     de la base ne permet pas d'essayer les 2^50 codes hors ligne ;
//   · « code de suivi » désigne déjà la référence dans les modèles de document :
//     on dit « code d'accès ».

export const ACCESS_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10;

/** Ce que garde l'échange enregistré (onglet Échanges) à la place du code. */
export const MASKED_ACCESS_CODE = "••••-••••-••";

/** Le poivre doit être long : en deçà, on n'ouvre aucun accès (« ne devine rien »). */
export const MIN_PEPPER_LENGTH = 32;

export function pepperFrom(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length >= MIN_PEPPER_LENGTH ? value : null;
}

/** `ABCD-EFGH-JK` à partir de 10 caractères normalisés. */
export function formatAccessCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 10)}`;
}

/**
 * Un code neuf, formaté. 256 est un multiple de 32 : prendre les 5 bits de
 * poids faible d'un octet uniforme donne un caractère uniforme, sans biais.
 */
export function newAccessCode(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += ACCESS_CODE_ALPHABET[byte & 31];
  return formatAccessCode(code);
}

/** Le code tel que l'usager l'a recopié → forme canonique, ou `null` s'il est mal formé. */
export function normalizeAccessCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (compact.length !== CODE_LENGTH) return null;
  for (const char of compact) if (!ACCESS_CODE_ALPHABET.includes(char)) return null;
  return compact;
}

/** L'adresse comparée : sans espaces autour, en minuscules. */
export function normalizeAccessEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  return email.length >= 3 && email.length <= 320 && email.includes("@") ? email : null;
}

async function hmacHex(pepper: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Empreinte d'un code NORMALISÉ (préfixe de domaine : un code n'est jamais une adresse). */
export function accessCodeHash(pepper: string, normalizedCode: string): Promise<string> {
  return hmacHex(pepper, `code:${normalizedCode}`);
}

/** Empreinte d'une adresse NORMALISÉE. */
export function accessEmailHash(pepper: string, normalizedEmail: string): Promise<string> {
  return hmacHex(pepper, `email:${normalizedEmail}`);
}

/** Page de suivi transmise par le portail : https seulement, sans identifiants. */
export function normalizeTrackingUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 500) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
    return url.toString();
  } catch {
    return null;
  }
}
