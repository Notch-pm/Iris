/**
 * Quelles adresses Iris accepte-t-il d'aller lire pour l'assistant ?
 *
 * Les pages consultables sont DÉCLARÉES dans le Socle (sources IA d'une
 * démarche, sources recommandées par la collectivité) : un administrateur de
 * collectivité les saisit, sans autre contrôle qu'un `format: uri`. Iris va
 * pourtant les chercher depuis son propre réseau — c'est exactement la forme
 * d'une requête forgée côté serveur (SSRF). Ce module ferme la porte aux
 * adresses qui ne désignent pas une page PUBLIQUE :
 *
 *  • `https:` seulement — une page en clair peut être réécrite en chemin, et
 *    ce qu'elle dit finit dans une réponse à un agent ;
 *  • ni identifiants dans l'URL, ni port exotique ;
 *  • ni adresse IP littérale, ni nom sans point (`localhost`, `intranet`), ni
 *    suffixe réservé aux réseaux privés.
 *
 * La résolution DNS vers une adresse privée se vérifie à part
 * (`isPublicAddress`), au moment du `fetch` — un nom public peut pointer vers
 * 127.0.0.1. C'est une défense en profondeur, pas une garantie : entre la
 * résolution et la connexion, un DNS complaisant peut changer d'avis.
 *
 * Module PUR, testé.
 */

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet"];

export function isFetchableUrl(raw: string): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "" && url.port !== "443") return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // IPv6 littérale : le parseur WHATWG la rend entre crochets.
  if (host.startsWith("[")) return false;
  // IPv4 littérale — y compris ses graphies décimale ou hexadécimale, que le
  // parseur normalise déjà en quatre octets (`https://2130706433/` → 127.0.0.1).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  // Un nom sans point n'existe que sur un réseau local.
  if (!host.includes(".")) return false;
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return false;
  return true;
}

/**
 * Une adresse IP résolue est-elle publique ? `false` pour tout ce qui désigne
 * la machine, le réseau local, le lien local (dont 169.254.169.254, l'adresse
 * de métadonnées des hébergeurs), le CGNAT et les plages réservées.
 * Une chaîne illisible n'est pas publique.
 */
export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== "string") return false;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // lien local, métadonnées
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false; // 192.0.0/24, 192.0.2/24 (documentation)
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && Number(v4[3]) === 100) return false; // documentation
    if (a === 203 && b === 0 && Number(v4[3]) === 113) return false; // documentation
    if (a >= 224) return false; // multidiffusion et réservé
    return true;
  }
  const v6 = ip.toLowerCase();
  if (!v6.includes(":")) return false;
  if (v6 === "::" || v6 === "::1") return false;
  // IPv4 encapsulée (::ffff:10.0.0.1), ou traduite (NAT64, 64:ff9b::10.0.0.1) :
  // on juge l'IPv4.
  const embedded = v6.match(/^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded) return isPublicAddress(embedded[1]);
  // NAT64 et 6to4 en notation hexadécimale : l'IPv4 est dans l'adresse,
  // inutile de la décoder — ces préfixes n'ont rien à faire dans une source.
  if (v6.startsWith("64:ff9b:") || v6.startsWith("2002:")) return false;
  if (/^f[cd]/.test(v6)) return false; // adresses uniques locales
  if (/^fe[89abcdef]/.test(v6)) return false; // lien local, site local (fec0::/10)
  if (v6.startsWith("ff")) return false; // multidiffusion
  return true;
}
