// Empreinte d'un fichier — WebCrypto uniquement (Deno ET Node/vitest), natif :
// pas une boucle JavaScript sur 25 Mo, donc hors du budget CPU des edge
// functions dans la pratique (à mesurer au premier déploiement — lot 1).

export async function sha256HexOf(bytes: Uint8Array): Promise<string> {
  const view = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", view as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
