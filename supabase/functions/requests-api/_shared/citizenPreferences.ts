// Contrat 2.10.0 (B12, lot L4c-2) — ce que le portail pousse pour les avis à
// l'usager. LOGIQUE PURE, testée. Champ inconnu ⇒ refus (motif des autres
// routes `/v1/citizen/*`) : un portail qui croit régler quelque chose qu'Iris
// ignore doit le savoir.

/** Les canaux connus. Le SMS (B14) ajoutera une valeur ici, rien d'autre. */
export const CITIZEN_CHANNELS = ["email"] as const;
export type CitizenChannels = { email: boolean };

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ channels: { email: boolean } }`, et rien d'autre. */
export function parseChannelsBody(body: unknown): Parsed<CitizenChannels> {
  if (!isRecord(body)) return { ok: false, message: "Corps JSON attendu : { channels: { email } }." };
  const unknown = Object.keys(body).filter((k) => k !== "channels");
  if (unknown.length > 0) return { ok: false, message: `Champ inconnu : ${unknown.join(", ")}.` };
  const channels = body.channels;
  if (!isRecord(channels)) return { ok: false, message: "channels : objet attendu." };
  const unknownChannels = Object.keys(channels).filter((k) => !(CITIZEN_CHANNELS as readonly string[]).includes(k));
  if (unknownChannels.length > 0) return { ok: false, message: `Canal inconnu : ${unknownChannels.join(", ")}.` };
  if (typeof channels.email !== "boolean") return { ok: false, message: "channels.email : booléen attendu." };
  return { ok: true, value: { email: channels.email } };
}

const MAX_URL = 500;

function httpsUrl(input: unknown): URL | null {
  if (typeof input !== "string" || input.length > MAX_URL) return null;
  try {
    const url = new URL(input);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? url : null;
  } catch {
    return null;
  }
}

export interface CitizenSpace {
  spaceUrl: string;
  requestUrlTemplate: string | null;
}

/**
 * `{ space_url, request_url_template? }` : https, 500 caractères au plus, sans
 * identifiants ; le gabarit contient `{request_id}` et partage l'origine de
 * l'espace — un avis ne renvoie jamais l'usager ailleurs que chez son portail.
 */
export function parseSpaceBody(body: unknown): Parsed<CitizenSpace> {
  if (!isRecord(body)) return { ok: false, message: "Corps JSON attendu : { space_url, request_url_template? }." };
  const unknown = Object.keys(body).filter((k) => k !== "space_url" && k !== "request_url_template");
  if (unknown.length > 0) return { ok: false, message: `Champ inconnu : ${unknown.join(", ")}.` };
  const space = httpsUrl(body.space_url);
  if (space === null) return { ok: false, message: "space_url : adresse https de 500 caractères au plus attendue." };
  const raw = body.request_url_template;
  if (raw === undefined || raw === null) return { ok: true, value: { spaceUrl: space.toString(), requestUrlTemplate: null } };
  if (typeof raw !== "string" || !raw.includes("{request_id}")) {
    return { ok: false, message: "request_url_template : doit contenir {request_id}." };
  }
  // `{request_id}` n'est pas une URL valide partout : on vérifie avec une valeur témoin.
  const probe = httpsUrl(raw.replace("{request_id}", "00000000-0000-4000-8000-000000000000"));
  if (probe === null || raw.length > MAX_URL) {
    return { ok: false, message: "request_url_template : adresse https de 500 caractères au plus attendue." };
  }
  if (probe.origin !== space.origin) {
    return { ok: false, message: "request_url_template : même origine que space_url attendue." };
  }
  return { ok: true, value: { spaceUrl: space.toString(), requestUrlTemplate: raw } };
}

/** `{ token }`, et rien d'autre (jeton de désinscription). */
export function parseUnsubscribeBody(body: unknown): Parsed<string> {
  if (!isRecord(body)) return { ok: false, message: "Corps JSON attendu : { token }." };
  const unknown = Object.keys(body).filter((k) => k !== "token");
  if (unknown.length > 0) return { ok: false, message: `Champ inconnu : ${unknown.join(", ")}.` };
  return typeof body.token === "string" ? { ok: true, value: body.token } : { ok: false, message: "token : texte attendu." };
}
