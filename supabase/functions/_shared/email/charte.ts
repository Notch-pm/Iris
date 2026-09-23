// Charte graphique de la collectivité dans les e-mails — LOGIQUE PURE (aucune
// dépendance Deno, aucun réseau), testée par vitest.
//
// D'OÙ ELLE VIENT. Du Socle, et de lui seul :
// `GET /v1/organizations/{id}/branding` (public-api 1.5.0, scope `read`). La
// route sert la charte **applicable** à l'organisation demandée — la sienne, ou
// celle de l'ancêtre le plus proche dont elle hérite —, avec
// `source_organization_id` et `inherited` pour dire laquelle des deux la porte.
// Iris interroge donc l'organisation PORTEUSE de la demande
// (`requests.socle_scope_org_id`) et n'a AUCUN arbre à remonter : « le logo de
// l'organisme concerné, ou à défaut celui de son organisation parente » est une
// règle du référentiel, résolue là où elle est définie.
//
// ⚠️ NE JAMAIS reconstituer la charte depuis `GET /v1/organizations/{id}` : les
// colonnes brutes d'une organisation qui hérite sont NULLES, et les couleurs n'y
// sont de toute façon pas servies. On peindrait du vide en croyant peindre les
// couleurs de la collectivité.
//
// CE QUE CE MODULE DÉCIDE, et que le gabarit n'a donc pas à savoir :
//   • la couleur de marque — celle de la collectivité, le vert du DS à défaut.
//     Elle trace les BORDURES de la carte et le filet sous le bandeau, et remplit
//     le bouton ; le bandeau lui-même reste BLANC (un aplat de couleur
//     entrait en collision avec le logo) ;
//   • la couleur du TEXTE sur le bouton — CALCULÉE par contraste, jamais
//     devinée : une charte peut être un jaune vif sur lequel du blanc est
//     illisible ;
//   • le logo à afficher — le logo COULEUR, seul fait pour un fond blanc. Le
//     logo blanc y disparaîtrait : il n'est jamais servi.
//
// Rien de ce qui sort d'ici n'est du HTML : le gabarit échappe, comme pour tout
// le reste. Les URL, elles, sont filtrées ICI (http(s) seulement) — une charte
// vient du référentiel, mais un `javascript:` dans un `src` reste un vecteur, et
// une URL invalide vaut mieux tue qu'affichée cassée.

import { EMAIL_COLORS } from "./template.ts";

/** Réponse de `GET /v1/organizations/{id}/branding`, telle que le contrat la
 *  décrit. Tout est optionnel ici : on parse un contrat, on ne fait pas
 *  confiance à sa forme (règle de la gamme sur les JSON possédés). */
export interface SocleBrandingDto {
  organization_id?: string | null;
  source_organization_id?: string | null;
  inherited?: boolean;
  configured?: boolean;
  logo_url?: string | null;
  logo_white_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
}

/** Ce que le gabarit consomme : déjà résolu, déjà sûr, rien à décider. */
export interface EmailCharte {
  /** Bordures de la carte, filet sous le bandeau, fond du bouton d'action. */
  primary: string;
  /** Texte lisible SUR `primary` (le bouton). Calculé, jamais saisi. */
  onPrimary: string;
  /**
   * Logo du bandeau, ou `null`. Toujours une URL http(s), toujours le logo
   * COULEUR : le bandeau est blanc.
   */
  logoUrl: string | null;
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** `#1F8A5B`, `1f8a5b` → `#1f8a5b`. Toute autre saisie → `null`. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = HEX.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

/**
 * Une URL d'image ne doit jamais devenir un vecteur : seul du http(s) entre
 * dans un `src`. Le reste — `javascript:`, `data:`, chemin relatif, chaîne
 * vide — vaut absence de logo (le bandeau se contente alors du nom, qui y est
 * de toute façon).
 */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** Luminance relative WCAG 2.1. Une couleur illisible compte pour du noir :
 *  l'appelant ne passe que de l'hexadécimal validé, ce repli ne sert qu'à ne
 *  jamais lever dans un chemin d'envoi d'e-mail. */
export function relativeLuminance(color: string): number {
  const hex = normalizeHex(color);
  if (!hex) return 0;
  const channel = (offset: number): number => {
    const srgb = parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Rapport de contraste WCAG entre deux couleurs, de 1 à 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Seuil AA « grand texte » (WCAG 2.1) : le libellé du bouton est en 15 px gras.
 *
 * ⚠️ Le critère est « le blanc SUFFIT-IL », pas « le blanc est-il le PLUS
 * contrasté ». Sur le vert du DS (`#089b59`), l'encre sombre contraste
 * davantage que le blanc (4,5 contre 3,6) — un critère de maximum ferait donc
 * basculer en texte sombre le bouton de tous les e-mails d'Iris, alors que le
 * DS Ariane prescrit du blanc sur son vert. On garde le blanc tant qu'il tient,
 * et on ne bascule que là où il ne tient plus (un jaune de charte, par exemple).
 */
export const WHITE_MIN_CONTRAST = 3;

/** Le fond est-il assez sombre pour porter du blanc ? */
export function prefersWhiteInk(background: string): boolean {
  return contrastRatio(EMAIL_COLORS.onPrimary, background) >= WHITE_MIN_CONTRAST;
}

/** Texte lisible sur `background` : le blanc du DS, ou son encre sombre. */
export function readableInk(background: string): string {
  return prefersWhiteInk(background) ? EMAIL_COLORS.onPrimary : EMAIL_COLORS.ink;
}

/**
 * La charte du Socle → ce que le gabarit sait peindre. `null` quand il n'y a
 * rien d'exploitable (`configured: false`, charte vide, ou couleur et logos
 * tous invalides) : l'e-mail garde alors l'habillage Iris par défaut, ce qui
 * est un rendu correct — pas une panne.
 *
 * ⚠️ Une couleur SANS logo est une charte : les bordures prennent la couleur de
 * la collectivité. Un logo SANS couleur en est une aussi : les bordures restent
 * vertes et le bandeau porte le logo. Les deux cas se produisent.
 *
 * ⚠️ `logo_white_url` est ignoré, délibérément : sur le bandeau blanc il serait
 * invisible. Une collectivité qui ne déclare QUE la version blanche n'a donc
 * pas de logo dans l'e-mail — mieux vaut pas de logo qu'un rectangle vide ; le
 * nom, écrit dans le bandeau, suffit.
 */
export function charteFromSocle(dto: SocleBrandingDto | null | undefined): EmailCharte | null {
  if (!dto || dto.configured === false) return null;

  const declared = normalizeHex(dto.primary_color);
  const primary = declared ?? EMAIL_COLORS.primary;
  const onPrimary = readableInk(primary);
  const logoUrl = httpUrl(dto.logo_url);

  if (!declared && !logoUrl) return null;
  return { primary, onPrimary, logoUrl };
}
