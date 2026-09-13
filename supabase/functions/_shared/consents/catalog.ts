/**
 * Catalogue des consentements RGPD demandés SYSTÉMATIQUEMENT à l'usager, quelle
 * que soit la démarche. Logique pure, sans dépendance Deno — importée à la fois
 * par les edge functions (garde serveur, composition du libellé consigné) et
 * par le navigateur (`@fn/_shared/consents/catalog`), pour que l'écran affiche
 * EXACTEMENT la phrase qui sera enregistrée.
 *
 * ⚠️ Ces deux questions ne sont PAS des champs de `form_schema` : elles ne se
 * paramètrent pas démarche par démarche, ne s'ajoutent pas, ne se retirent pas.
 * Un consentement qu'un service pourrait décocher dans son paramétrage ne
 * vaudrait rien — c'est tout l'objet d'un catalogue fermé.
 *
 * ⚠️ Le navigateur n'envoie JAMAIS le libellé : il n'envoie que `kind` et
 * `granted`. La phrase consignée est recomposée ICI, côté serveur, depuis le
 * nom de l'organisme principal relu en base — même doctrine que les snapshots.
 */

/** Les deux consentements du catalogue. Aucun autre n'existe. */
export type ConsentKind = "traitement" | "partage";

export interface ConsentDef {
  kind: ConsentKind;
  /** Sans lui, le dépôt ne peut pas être validé (garde serveur, pas seulement UI). */
  required: boolean;
  /** État de la case à l'ouverture du formulaire. */
  defaultGranted: boolean;
  /** Libellé court : en-tête de colonne, badge de fiche. */
  label: string;
  /** Ce que le consentement autorise, en une ligne, pour l'agent qui lit la fiche. */
  purpose: string;
}

/**
 * Nom d'organisme de repli. Le libellé doit TOUJOURS être composable : une
 * phrase à trou (« aux services de  ») serait consignée telle quelle et
 * resterait au dossier pour des années.
 */
export const DEFAULT_ORGANISM = "la collectivité";

export const CONSENTS: readonly ConsentDef[] = [
  {
    kind: "traitement",
    required: true,
    defaultGranted: false,
    label: "Traitement de la demande",
    purpose: "Utiliser les informations fournies pour instruire cette demande.",
  },
  {
    kind: "partage",
    required: false,
    defaultGranted: true,
    label: "Partage aux services",
    purpose:
      "Partager ces informations aux services de la collectivité pour améliorer le traitement de cette demande et des suivantes.",
  },
];

const BY_KIND = new Map<string, ConsentDef>(CONSENTS.map((c) => [c.kind, c]));

export function consentDef(kind: string): ConsentDef | null {
  return BY_KIND.get(kind) ?? null;
}

export function isConsentKind(value: unknown): value is ConsentKind {
  return typeof value === "string" && BY_KIND.has(value);
}

/** Nom d'organisme propre, replié sur `DEFAULT_ORGANISM` si vide ou absent. */
export function organismLabel(name: string | null | undefined): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed === "" ? DEFAULT_ORGANISM : trimmed;
}

/**
 * Phrase EXACTE soumise à l'usager, et consignée telle quelle : c'est elle qui
 * fait la preuve du consentement, pas le booléen. Le nom de l'organisme
 * principal y est interpolé — une même collectivité ne pose donc pas la même
 * phrase qu'une autre, et l'historique garde celle du jour du dépôt même si la
 * collectivité est renommée ensuite.
 */
export function consentStatement(kind: ConsentKind, organismName?: string | null): string {
  if (kind === "traitement") {
    return "J'accepte que les informations fournies ici soient utilisées dans le cadre du traitement de ma demande.";
  }
  return `J'accepte de partager ces informations aux services de ${organismLabel(organismName)} `
    + "afin d'améliorer le traitement de ma demande et de mes futures demandes.";
}

/** Un consentement recueilli : ce qui est consigné sur la demande et au référentiel. */
export interface ConsentRecord {
  kind: ConsentKind;
  granted: boolean;
  /** Libellé soumis à l'usager, recomposé côté serveur. */
  statement: string;
}

/** État initial du formulaire : `traitement` décoché, `partage` coché. */
export function defaultConsentAnswers(): Record<ConsentKind, boolean> {
  const out = {} as Record<ConsentKind, boolean>;
  for (const c of CONSENTS) out[c.kind] = c.defaultGranted;
  return out;
}

/** Le dépôt est-il validable ? (reflet d'écran — la garde vit dans `normalizeConsents`) */
export function consentsSatisfied(answers: Partial<Record<ConsentKind, boolean>>): boolean {
  return CONSENTS.every((c) => !c.required || answers[c.kind] === true);
}

export type ConsentParse =
  | { ok: true; consents: ConsentRecord[] }
  | { ok: false; message: string };

/**
 * Garde serveur du dépôt. Entrée acceptée : `[{ kind, granted }]` — tout le
 * reste est refusé, le libellé compris (il se compose ici, jamais ailleurs).
 *
 * Refuse : forme invalide, `kind` hors catalogue, doublon, consentement
 * OBLIGATOIRE absent ou refusé. Un `kind` du catalogue non transmis et non
 * obligatoire vaut « non accordé » — l'absence de case cochée est un refus,
 * jamais un défaut silencieux (le défaut `coché` est une commodité d'écran,
 * pas une présomption de consentement).
 */
export function normalizeConsents(raw: unknown, organismName?: string | null): ConsentParse {
  if (raw === undefined || raw === null) {
    return { ok: false, message: "consents : tableau des consentements requis." };
  }
  if (!Array.isArray(raw)) return { ok: false, message: "consents : tableau attendu." };
  if (raw.length > CONSENTS.length) {
    return { ok: false, message: "consents : plus de consentements que le catalogue n'en compte." };
  }

  const answers = new Map<ConsentKind, boolean>();
  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, message: `consents[${i}] : objet attendu.` };
    }
    const row = entry as Record<string, unknown>;
    const unknown = Object.keys(row).filter((k) => k !== "kind" && k !== "granted");
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `consents[${i}] : seules les clés kind et granted sont acceptées `
          + `(${unknown.join(", ")} refusée${unknown.length > 1 ? "s" : ""} — le libellé est composé par le serveur).`,
      };
    }
    if (!isConsentKind(row.kind)) {
      return { ok: false, message: `consents[${i}].kind : valeur hors catalogue.` };
    }
    if (typeof row.granted !== "boolean") {
      return { ok: false, message: `consents[${i}].granted : booléen attendu.` };
    }
    if (answers.has(row.kind)) {
      return { ok: false, message: `consents[${i}].kind : ${row.kind} transmis deux fois.` };
    }
    answers.set(row.kind, row.granted);
  }

  const consents: ConsentRecord[] = [];
  for (const def of CONSENTS) {
    const granted = answers.get(def.kind) ?? false;
    if (def.required && !granted) {
      return {
        ok: false,
        message: "Le consentement à l'utilisation des informations pour le traitement de la demande "
          + "est obligatoire : sans lui, le dépôt ne peut pas être validé.",
      };
    }
    consents.push({ kind: def.kind, granted, statement: consentStatement(def.kind, organismName) });
  }
  return { ok: true, consents };
}

/**
 * Consentements tels qu'ils sont relus sur une demande ou sur une fiche usager
 * — tolérant : une trace écrite par une version antérieure, ou par un
 * partenaire, ne doit jamais faire tomber un écran.
 */
export function parseConsentRecords(raw: unknown): ConsentRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsentRecord[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (!isConsentKind(row.kind) || seen.has(row.kind)) continue;
    seen.add(row.kind);
    out.push({
      kind: row.kind,
      granted: row.granted === true,
      statement: typeof row.statement === "string" && row.statement.trim() !== ""
        ? row.statement.trim()
        : consentStatement(row.kind),
    });
  }
  // Ordre du CATALOGUE, jamais celui de la donnée : l'obligatoire d'abord.
  return CONSENTS.map((c) => out.find((r) => r.kind === c.kind)).filter((r): r is ConsentRecord => r !== undefined);
}
