// Permaliens transmis par un partenaire — LOGIQUE PURE, testée.
//
// Un partenaire nous confie deux sortes d'adresses : le permalien de la
// ressource d'origine (`context.external_url`) et celui de chaque lien
// (`links[].url`). Iris les stocke tels quels — c'est la ressource du
// partenaire, Iris n'a pas à la redéfinir — puis les rend cliquables dans
// l'onglet « Résumé » d'une demande (`ResumePane`).
//
// D'où la seule question qui vaille ici : cette adresse a-t-elle un sens
// DEPUIS LE NAVIGATEUR D'UN AGENT ? Un `http://localhost:8080/courrier/…`
// n'en a aucun : poussé par une edge function de partenaire configurée sur un
// poste de développement, il désigne, une fois cliqué, la machine de l'agent —
// au mieux une erreur de connexion, au pire une sonde de son propre intranet.
// Vécu le 2026-09-10 : le secret `APP_ORIGIN` de Clara pointait sur localhost,
// et chaque demande ingérée ce jour-là a hérité d'un lien mort.
//
// Iris ne CORRIGE pas ces adresses — il ne sait pas où vit vraiment le
// partenaire, et deviner reviendrait à fabriquer une référence croisée. Il les
// ÉCARTE, et le dit : la demande passe (un permalien n'est qu'un confort), avec
// l'anomalie `permalien_non_public` pour que la panne de configuration reste
// visible au lieu de se déposer en silence dans la base.

import type { IngestEnvelope, LinkRef } from "./validation.ts";

/** Anomalie posée sur la demande quand au moins un permalien a été écarté. */
export const PERMALINK_ANOMALY = "permalien_non_public";

/**
 * Domaines de premier niveau réservés à un usage local ou interne : jamais
 * résolus sur l'Internet public, donc jamais un permalien exploitable.
 */
const PRIVATE_TLDS = [".local", ".localhost", ".internal", ".intranet", ".home.arpa"];

/** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `0.0.0.0/8`. */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (n.some((v) => Number.isNaN(v) || v > 255)) return false;
  const [a, b] = n;
  return a === 0 || a === 10 || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

/** Boucle locale `::1`, uniques locales `fc00::/7`, lien-local `fe80::/10`. */
function isPrivateIPv6(host: string): boolean {
  // `URL.hostname` rend une IPv6 entre crochets.
  const inner = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (!inner.includes(":")) return false;
  const lower = inner.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  return /^fe[89ab][0-9a-f]:/.test(lower);
}

/**
 * Un permalien est-il joignable depuis le navigateur d'un agent ?
 *
 * Vrai seulement pour une URL `http(s)` dont l'hôte est un nom public — ce qui
 * exclut la boucle locale, les plages privées, les TLD réservés, et tout hôte
 * sans point (`http://clara/…` : un nom d'intranet, résolu différemment sur
 * chaque poste).
 */
export function isPublicPermalink(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return false;
  if (host === "localhost") return false;
  if (PRIVATE_TLDS.some((tld) => host.endsWith(tld))) return false;
  if (isPrivateIPv6(host)) return false;
  if (isPrivateIPv4(host)) return false;
  // Nom d'hôte nu (ni point, ni IPv6) : ne résout que sur un réseau donné.
  if (!host.includes(".") && !host.includes(":")) return false;
  return true;
}

/** Rend l'URL si elle est publique, `null` sinon. Ne réécrit jamais. */
export function keepPublicPermalink(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url === "") return null;
  return isPublicPermalink(url) ? url : null;
}

export interface SanitizedPermalinks {
  /** Permalien de la ressource d'origine, `null` s'il a été écarté ou absent. */
  externalUrl: string | null;
  /** Liens de l'enveloppe, chacun privé de son URL si elle a été écartée. */
  links: LinkRef[];
  /** Au moins un permalien écarté : la demande porte `permalien_non_public`. */
  dropped: boolean;
}

/**
 * Retient, de l'enveloppe, les seuls permaliens exploitables. Le reste de
 * l'enveloppe est intact : ni le `type`, ni l'`id`, ni le `label` d'un lien ne
 * bougent — un lien privé de son URL reste une référence croisée valide,
 * affichée sans bouton « Ouvrir ».
 *
 * ⚠️ N'entre PAS dans l'empreinte de contenu (`fingerprintPayload`) : celle-ci
 * porte sur ce que le partenaire a ENVOYÉ, pour que « rejouez à l'identique »
 * garde son sens. Un partenaire qui rejoue le même permalien local obtient donc
 * bien un 200, et non un 409.
 */
export function sanitizePermalinks(env: IngestEnvelope): SanitizedPermalinks {
  const externalUrl = keepPublicPermalink(env.context?.external_url);
  let dropped = env.context?.external_url !== undefined && externalUrl === null;

  const links = (env.links ?? []).map((l) => {
    if (l.url === undefined) return l;
    const url = keepPublicPermalink(l.url);
    if (url !== null) return l;
    dropped = true;
    const { url: _écarté, ...reste } = l;
    return reste;
  });

  return { externalUrl, links, dropped };
}
