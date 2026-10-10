// « Demande complexe » relayée à Clara — module PUR (aucune dépendance Deno,
// aucun réseau), partagé par l'edge function `relay-courrier-clara` et l'écran
// (`@fn/_shared/clara/relay`), testé par vitest.
//
// Une demande complexe est une saisie qu'un agent ne sait pas rattacher à une
// démarche : un texte collé, des fichiers. Iris NE LA CONSERVE PAS — aucune
// ligne, aucun octet au bucket : elle devient un courrier de Clara (canal
// « Relayé agent »), où l'analyse IA la qualifie. C'est ce qui la distingue
// d'une demande libre, qu'Iris refuse par invariant.
//
// Contrat de la porte `iris-courrier` de Clara : `docs/edge-functions.md` du
// dépôt Clara. Une clé par appelant : le canal se déduit de la porte.

import { pickDeclared } from "../identity/declared.ts";

export const RELAY_MAX_FILES = 5;
export const RELAY_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const RELAY_BODY_MAX = 50_000;

/**
 * Le `requester_config` d'une demande complexe : les trois publics, tous les
 * champs proposés, et l'identité EXIGÉE (civilité pour une personne — seule
 * exigence du Socle pour créer une fiche —, raison sociale pour une personne
 * morale). Pas d'anonymat : Clara rappelle l'usager.
 */
export const RELAY_REQUESTER_CONFIG = {
  citoyen: {
    enabled: true,
    fields: {
      civilite: "obligatoire", prenoms: "visible", nom_naissance: "visible", nom_usuel: "visible",
      courriel: "visible", tel_portable: "visible", tel_fixe: "visible", adresse: "visible",
    },
  },
  entreprise: {
    enabled: true,
    fields: { raison_sociale: "obligatoire", siret: "visible", courriel: "visible", tel_portable: "visible", tel_fixe: "visible", adresse: "visible" },
  },
  association: {
    enabled: true,
    fields: { raison_sociale: "obligatoire", siret: "visible", courriel: "visible", tel_portable: "visible", tel_fixe: "visible", adresse: "visible" },
  },
} as const;

export type SenderCategory = "citoyen" | "entreprise" | "association";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Catégorie Clara d'une fiche Socle (`contact_type`) ou d'un public Iris. */
export function senderCategoryOf(value: unknown): SenderCategory {
  if (value === "entreprise" || value === "association") return value;
  return "citoyen";
}

/**
 * Les champs `sender_*` de l'usager, depuis une identité déclarée (fiche Socle
 * relue côté serveur, ou saisie du guichet en secours). Les vides sont OMIS :
 * Clara lit l'absence, pas une chaîne vide.
 */
export function senderFields(
  declared: unknown,
  category: SenderCategory,
  socleContactId: string | null,
): Record<string, string> {
  const out: Record<string, string> = { sender_category: category };
  const set = (key: string, value: string | null) => {
    if (value) out[key] = value;
  };
  if (category === "citoyen") {
    set("sender_civilite", pickDeclared(declared, "civility"));
    set("sender_first_name", pickDeclared(declared, "firstName"));
    set(
      "sender_last_name",
      pickDeclared(declared, "lastName") ?? pickDeclared(declared, "usageName") ?? pickDeclared(declared, "displayName"),
    );
  } else {
    set("sender_last_name", pickDeclared(declared, "legalName") ?? pickDeclared(declared, "displayName"));
  }
  set("sender_email", pickDeclared(declared, "email"));
  set("sender_phone", pickDeclared(declared, "mobilePhone") ?? pickDeclared(declared, "landlinePhone"));
  set("sender_socle_contact_id", socleContactId);
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L'usager d'une demande complexe, tel que le navigateur le désigne. */
export type RelayRequester =
  /** Fiche du Socle — RELUE côté serveur, jamais crue du navigateur. */
  | { kind: "contact"; socle_contact_id: string }
  /** Sortie de secours (Socle en panne) : l'identité saisie, épurée. */
  | { kind: "sans_rapprochement"; audience: SenderCategory; declared: Record<string, string> };

/**
 * Lecture de l'usager envoyé par le navigateur. Pas d'anonymat. En secours,
 * seules les clés que la configuration propose pour ce public passent, et
 * l'identité exigée doit y être.
 */
export function parseRelayRequester(raw: unknown): RelayRequester | { error: string } {
  if (!isRecord(raw)) return { error: "Usager : objet requis." };
  if (raw.kind === "contact") {
    if (typeof raw.socle_contact_id !== "string" || !UUID_RE.test(raw.socle_contact_id)) {
      return { error: "Usager : fiche du référentiel invalide." };
    }
    return { kind: "contact", socle_contact_id: raw.socle_contact_id };
  }
  if (raw.kind === "sans_rapprochement") {
    if (raw.audience !== "citoyen" && raw.audience !== "entreprise" && raw.audience !== "association") {
      return { error: "Usager : public inconnu." };
    }
    if (!isRecord(raw.declared)) return { error: "Usager : identité requise." };
    const fields = RELAY_REQUESTER_CONFIG[raw.audience].fields as Record<string, string>;
    const declared: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.declared)) {
      if (!(key in fields) || typeof value !== "string" || value.trim() === "") continue;
      declared[key] = value.trim();
    }
    for (const [key, visibility] of Object.entries(fields)) {
      if (visibility === "obligatoire" && !declared[key]) {
        return { error: raw.audience === "citoyen" ? "Usager : civilité obligatoire." : "Usager : raison sociale obligatoire." };
      }
    }
    if (raw.audience === "citoyen" && !declared.nom_naissance && !declared.nom_usuel) {
      return { error: "Usager : nom obligatoire." };
    }
    return { kind: "sans_rapprochement", audience: raw.audience, declared };
  }
  return { error: "Usager : « contact » ou « sans_rapprochement » attendu." };
}

/** Le motif du refus d'une saisie, ou `null`. Même règle à l'écran et au serveur. */
export function relayContentError(body: string, files: { name: string; size: number }[]): string | null {
  if (body.trim() === "" && files.length === 0) {
    return "Collez un texte ou joignez au moins un fichier.";
  }
  if (body.length > RELAY_BODY_MAX) {
    return `Le texte dépasse ${RELAY_BODY_MAX.toLocaleString("fr-FR")} caractères.`;
  }
  if (files.length > RELAY_MAX_FILES) return `${RELAY_MAX_FILES} fichiers au plus.`;
  const big = files.find((f) => f.size > RELAY_MAX_FILE_BYTES);
  if (big) return `« ${big.name} » dépasse 10 Mo.`;
  return null;
}

/** L'issue d'un appel à Clara, ramenée aux cas dont Iris sait quoi faire. */
export type ClaraOutcome =
  | { kind: "ok"; reference: string | null; duplicate: boolean }
  | { kind: "validation"; message: string | null }
  | { kind: "unauthorized" }
  | { kind: "organisme_inconnu" }
  | { kind: "organisme_ambigu" }
  | { kind: "failed" }
  | { kind: "unexpected" };

export function claraOutcome(status: number, body: unknown): ClaraOutcome {
  const b = isRecord(body) ? body : {};
  if (status === 200 || status === 201) {
    if (b.ok !== true || typeof b.courier_id !== "string") return { kind: "unexpected" };
    return {
      kind: "ok",
      reference: typeof b.reference === "string" && b.reference !== "" ? b.reference : null,
      duplicate: b.duplicate === true,
    };
  }
  if (status === 400) return { kind: "validation", message: typeof b.message === "string" ? b.message : null };
  if (status === 401 || status === 403) return { kind: "unauthorized" };
  if (status === 404 && b.error === "organisme_inconnu") return { kind: "organisme_inconnu" };
  if (status === 409 && b.error === "organisme_ambigu") return { kind: "organisme_ambigu" };
  if (status >= 500) return { kind: "failed" };
  return { kind: "unexpected" };
}

/**
 * Le refus rendu au navigateur. Un 400 de Clara est un écart de CONTRAT (notre
 * bug, ou une règle que l'écran ne connaît pas) : son message, en français, est
 * relayé — il nomme le champ. Une clé refusée ne se raconte jamais à l'agent.
 */
export function relayFailure(outcome: Exclude<ClaraOutcome, { kind: "ok" }>): {
  status: number;
  code: string;
  message: string;
} {
  switch (outcome.kind) {
    case "validation":
      return {
        status: 422,
        code: "clara_rejected",
        message: outcome.message
          ? `Clara a refusé la demande : ${outcome.message}.`
          : "Clara a refusé la demande.",
      };
    case "organisme_inconnu":
    case "organisme_ambigu":
      return {
        status: 422,
        code: "clara_undeliverable",
        message: "Clara ne gère pas le courrier de cet organisme : la demande n'a pas été transmise.",
      };
    case "unauthorized":
      return {
        status: 502,
        code: "clara_misconfigured",
        message: "Le lien entre Iris et Clara est mal configuré : la demande n'a pas été transmise. Prévenez un administrateur.",
      };
    default:
      return {
        status: 502,
        code: "clara_unavailable",
        message: "Clara est injoignable : la demande n'a pas été transmise. Réessayez dans un instant.",
      };
  }
}

/** Nom affiché de l'agent relais : prénom nom, sinon son adresse (même repli que `user_display_name`). */
export function agentDisplayName(user: { first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  const name = [user.first_name, user.last_name].map((v) => (v ?? "").trim()).filter(Boolean).join(" ");
  return name || (user.email ?? "").trim() || "Agent Iris";
}
