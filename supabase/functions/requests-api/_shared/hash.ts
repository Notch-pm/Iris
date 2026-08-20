// Hachage et canonicalisation — WebCrypto uniquement (fonctionne sous Deno
// ET sous Node/vitest, aucune dépendance).

/** SHA-256 hexadécimal d'une chaîne (clés d'API, empreintes de contenu). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * JSON canonique : clés d'objets triées récursivement, valeurs `undefined`
 * ignorées. Deux payloads sémantiquement identiques produisent la même chaîne,
 * quel que soit l'ordre d'écriture des clés côté émetteur.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}
