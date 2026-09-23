// Gabarit d'email Iris — reprise du gabarit Clara (carte centrée 520 px,
// bandeau de marque BLANC, bordures à la couleur de marque, bouton d'action,
// lien de repli, pied), rhabillé aux
// tokens du DS Ariane : vert AA, beurre, radius 14 px (carte) / 10 px
// (bouton), typographie Nunito Sans.
//
// Module PUR (aucune dépendance Deno, aucun réseau) — testé par vitest.
//
// ⚠️ Les couleurs sont écrites en hexadécimal : un client de messagerie ne
// sait lire ni `hsl()` ni les variables CSS, et tout doit être en style
// inline (Gmail supprime les <style> externes). Ce sont les tokens de
// `src/index.css` convertis une fois pour toutes — à retoucher ensemble.
//
// ⚠️ Tout ce qui vient de la base (nom du tenant, nom du destinataire) est
// échappé : un nom d'organisation est une donnée du Socle, pas du HTML.

// ⚠️ Import de TYPE uniquement : `charte.ts` importe `EMAIL_COLORS` d'ici. Un
// import de valeur formerait un cycle qui casserait à l'évaluation du module.
import type { EmailCharte } from "./charte.ts";

/** Nom du produit — il appartient à la MARQUE, donc au gabarit : le catalogue
 *  des messages d'authentification n'a pas à le posséder. */
export const PRODUCT_NAME = "Iris";

/** Tokens DS convertis en hexadécimal pour les clients de messagerie. */
export const EMAIL_COLORS = {
  primary: "#089B59", // --primary              153 90% 32%
  onPrimary: "#FFFFFF", // --primary-foreground   0 0% 100%
  ink: "#1C2220", // --foreground           160 10% 12%
  muted: "#5C6662", // --muted-foreground     160 5% 38%
  border: "#E4E7E6", // --border               160 5% 90%
  surface: "#FFFFFF", // --card                 0 0% 100%
  page: "#FAFAF8", // --brand-cream
  butter: "#FFCD57", // --secondary            42 100% 67%
  onButter: "#413310", // --secondary-foreground 42 60% 16%
} as const;

/** Nunito Sans est la seule famille du DS ; le repli couvre les clients qui l'ignorent. */
export const EMAIL_FONT =
  "'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, Helvetica, sans-serif";

export interface EmailBrand {
  /** Produit — toujours « Iris » en pratique, paramétré pour les tests. */
  productName: string;
  /** Tenant destinataire, quand il est connu (bandeau + pied). */
  tenantName?: string | null;
  /**
   * Charte graphique de la collectivité, résolue par le Socle et préparée par
   * `charte.ts` (couleur des bordures et du bouton, encre du bouton, logo). Absente ⇒
   * habillage Iris — c'est le cas de tous les messages qui vont aux AGENTS.
   */
  charte?: EmailCharte | null;
}

export interface EmailContent {
  subject: string;
  heading: string;
  /** Paragraphes du corps, en texte brut : le gabarit les échappe. */
  paragraphs: string[];
  /** Bouton d'action. Exclusif avec `code`. */
  cta?: { label: string; url: string };
  /** Code à recopier (réauthentification). Exclusif avec `cta`. */
  code?: string;
  /** Mention de bas de corps : validité du lien, quoi faire si on n'a rien demandé. */
  footnote?: string;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Une URL d'action ne doit jamais devenir un vecteur : on n'injecte dans
 * `href` que du http(s). Tout le reste retombe sur « # » (le lien de repli en
 * clair reste visible, l'utilisateur n'est pas coincé).
 */
export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : "#";
}

/** Ligne de marque du bandeau : « Iris » seul, ou « Iris · Ville de X ». */
export function brandLine(brand: EmailBrand): string {
  const tenant = brand.tenantName?.trim();
  return tenant ? `${brand.productName} · ${tenant}` : brand.productName;
}

/**
 * Un paragraphe. Les retours à la ligne SIMPLES sont conservés (`<br />`) :
 * sans cela, le HTML les avale et une signature saisie sur trois lignes
 * arriverait sur une seule — alors que la partie `text/plain`, elle, les
 * garderait. L'échappement passe AVANT le remplacement : rien d'autre que ces
 * `<br />` ne peut donc entrer dans le rendu.
 */
function paragraphHtml(text: string): string {
  const html = escapeHtml(text).replace(/\n/g, "<br />");
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${EMAIL_COLORS.ink};">${html}</p>`;
}

function ctaHtml(label: string, url: string, charte: EmailCharte): string {
  const href = safeUrl(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 8px;">
            <tr>
              <td style="background-color:${charte.primary};border-radius:10px;">
                <a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 30px;color:${charte.onPrimary};font-family:${EMAIL_FONT};font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
              </td>
            </tr>
          </table>`;
}

/** L'habillage Iris — le gabarit n'a ainsi qu'UN chemin de rendu, charte ou pas. */
const IRIS_CHARTE: EmailCharte = {
  primary: EMAIL_COLORS.primary,
  onPrimary: EMAIL_COLORS.onPrimary,
  logoUrl: null,
};

/**
 * Le bandeau — BLANC, délibérément. La marque s'y lit par le logo et par le
 * filet de couleur qui le sépare du corps (posé sur la cellule, voir
 * `renderEmailHtml`), plus par un aplat : un fond à la couleur principale
 * entrait en collision avec le logo — un logo de collectivité est dessiné pour
 * du papier, et sur un aplat de sa propre couleur il perdait tout contraste.
 * Le nom est écrit à l'encre du corps : sur blanc il se lit quelle que soit la
 * charte, jaune vif compris.
 *
 * ⚠️ `alt=""` sur le logo, DÉLIBÉRÉMENT : le nom de la collectivité est écrit
 * juste à côté, dans le même bandeau. Beaucoup de clients bloquent les images
 * distantes par défaut ; un `alt` porteur afficherait alors ce nom DEUX FOIS.
 * Le logo est ici la redite visuelle d'un texte présent, pas une information
 * de plus — et c'est exactement le cas où la règle d'accessibilité demande un
 * `alt` vide.
 *
 * La hauteur est posée en attribut ET en style : Outlook ignore le style, les
 * clients modernes ignorent parfois l'attribut. La largeur reste `auto` — on ne
 * connaît pas les proportions du logo d'une collectivité, on ne les impose pas.
 *
 * `line` arrive DÉJÀ échappée (elle l'est une fois pour le bandeau et le pied) ;
 * l'URL du logo, elle, est échappée ici — elle n'entre nulle part ailleurs.
 */
function bannerHtml(line: string, charte: EmailCharte): string {
  const label =
    `<p style="margin:0;font-size:17px;font-weight:800;letter-spacing:0.2px;color:${EMAIL_COLORS.ink};">${line}</p>`;
  if (!charte.logoUrl) return label;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" style="padding-right:14px;">
                    <img src="${escapeHtml(charte.logoUrl)}" alt="" height="36" style="display:block;height:36px;width:auto;max-width:160px;border:0;outline:none;text-decoration:none;" />
                  </td>
                  <td valign="middle">${label}</td>
                </tr>
              </table>`;
}

function codeHtml(code: string): string {
  return `<div style="margin:24px 0 8px;padding:18px;background-color:${EMAIL_COLORS.butter};border-radius:14px;text-align:center;font-size:28px;font-weight:800;letter-spacing:6px;color:${EMAIL_COLORS.onButter};">${escapeHtml(code)}</div>`;
}

/**
 * Rend le corps HTML complet. Structure en tables imbriquées et styles inline
 * — c'est le seul HTML que les clients de messagerie rendent de façon fiable.
 */
export function renderEmailHtml(content: EmailContent, brand: EmailBrand): string {
  const line = escapeHtml(brandLine(brand));
  const charte = brand.charte ?? IRIS_CHARTE;
  const preheader = escapeHtml(content.paragraphs.find((p) => p.trim().length > 0) ?? content.heading);

  const action = content.code
    ? codeHtml(content.code)
    : content.cta
      ? ctaHtml(content.cta.label, content.cta.url, charte)
      : "";

  // Un code se recopie, il n'y a pas de lien à replier.
  const fallback = content.cta && !content.code
    ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br />${escapeHtml(safeUrl(content.cta.url))}</p>`
    : "";

  const footnote = content.footnote
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};">${escapeHtml(content.footnote)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.page};font-family:${EMAIL_FONT};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_COLORS.page};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%;background-color:${EMAIL_COLORS.surface};border:1px solid ${charte.primary};border-radius:14px;overflow:hidden;">
          <tr>
            <td style="background-color:${EMAIL_COLORS.surface};border-bottom:1px solid ${charte.primary};padding:20px 32px;">
              ${bannerHtml(line, charte)}
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px;">
              <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:800;color:${EMAIL_COLORS.ink};">${escapeHtml(content.heading)}</h1>
              ${content.paragraphs.map(paragraphHtml).join("\n              ")}
              ${action}
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;">
              ${fallback}
              ${footnote}
              <hr style="border:none;border-top:1px solid ${EMAIL_COLORS.border};margin:24px 0 16px;" />
              <p style="margin:0;font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};text-align:center;">${line} — message automatique, merci de ne pas y répondre.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Version texte brut — obligatoire : un email sans `text/plain` part au spam. */
export function renderEmailText(content: EmailContent, brand: EmailBrand): string {
  const parts = [content.heading, "", ...content.paragraphs];
  if (content.code) {
    parts.push("", `Code : ${content.code}`);
  } else if (content.cta) {
    parts.push("", `${content.cta.label} : ${safeUrl(content.cta.url)}`);
  }
  if (content.footnote) parts.push("", content.footnote);
  parts.push("", `${brandLine(brand)} — message automatique, merci de ne pas y répondre.`);
  return parts.join("\n");
}
