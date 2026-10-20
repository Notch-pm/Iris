// Jeton court de la vue usager (contrat 2.7.0) — LOGIQUE PURE (WebCrypto),
// testée.
//
// Relecture de sécurité du 2026-10-19 (M4), décision PO : la clé plateforme du
// portail ne doit pas suffire, à elle seule, à lire les demandes des usagers.
// Chaque lecture `/v1/citizen/*` porte donc, en plus de la clé, un jeton
// signé par un SECOND secret (IRIS_CITIZEN_TOKEN_SECRET, partagé avec le
// portail seulement), court (quelques minutes) et lié à CE qu'il ouvre :
//   · `request:<uuid>`  — une demande, ouverte par courriel + code (invité) ;
//   · `contact:<uuid>`  — les demandes d'une fiche, pour son compte connecté ;
//     il porte alors l'adresse du compte (`e`), qui filtre les messages.
// Le portail ne le délivre qu'après SES propres contrôles (session).
//
// Format : `<charge base64url>.<HMAC-SHA256 base64url>`, charge
// `{ v: 1, t: <racine Socle>, sub, e?, exp }` (exp en secondes).

export const CITIZEN_TOKEN_HEADER = "x-citizen-token";
/** Au-delà, un jeton est refusé même bien signé : il doit rester court. */
export const CITIZEN_TOKEN_MAX_SECONDS = 15 * 60;

export type CitizenSubject = { kind: "request"; id: string } | { kind: "contact"; id: string; email: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: KeyUsage) {
  return await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/**
 * Ce qu'ouvre le jeton, s'il est bien signé, pour CE tenant, non expiré et
 * court ; `null` sinon. La comparaison de signature est celle de WebCrypto
 * (`verify`, temps constant).
 */
export async function verifyCitizenToken(
  secret: string,
  token: string | null,
  tenantRootId: string,
  nowSeconds: number,
): Promise<CitizenSubject | null> {
  if (!token || token.length > 2000) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const signature = fromBase64Url(mac);
  const payloadBytes = fromBase64Url(body);
  if (signature === null || payloadBytes === null) return null;
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), signature, new TextEncoder().encode(body)))) {
    return null;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (payload.v !== 1 || payload.t !== tenantRootId || typeof payload.exp !== "number") return null;
  if (payload.exp <= nowSeconds || payload.exp > nowSeconds + CITIZEN_TOKEN_MAX_SECONDS) return null;
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const [kind, id] = sub.split(":");
  if (!UUID_RE.test(id ?? "")) return null;
  if (kind === "request") return { kind, id };
  if (kind === "contact") {
    const email = typeof payload.e === "string" && payload.e.includes("@") ? payload.e.trim().toLowerCase() : null;
    return { kind, id, email };
  }
  return null;
}

/** Le jeton tel que le portail le signe — exporté pour les tests et la documentation du contrat. */
export async function signCitizenToken(secret: string, payload: Record<string, unknown>): Promise<string> {
  const toB64 = (bytes: Uint8Array) => {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const body = toB64(new TextEncoder().encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(body)));
  return `${body}.${toB64(mac)}`;
}
