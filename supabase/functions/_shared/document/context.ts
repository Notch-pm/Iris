// Ce qu'une demande donne à un document — module PUR (lignes de base en
// entrée, contexte de fusion en sortie), testé par vitest.
//
// Le contexte est composé CÔTÉ SERVEUR, jamais accepté du navigateur : c'est la
// même règle que pour l'e-mail à l'usager et pour le prompt de l'assistant. Un
// client qui pourrait dicter la valeur de `{{organisme.nom}}` ou de
// `{{usager.adresse_complete}}` signerait un courrier au nom de la
// collectivité avec le contenu de son choix.
//
// Les libellés (statut, urgence) sont ceux de `_shared/ai/context.ts` — eux-
// mêmes jumeaux testés de `src/features/requests/statuts.ts`. Un courrier ne
// doit pas nommer un statut autrement que l'écran de l'agent.

import { PRIORITY_LABELS, STATUS_LABELS } from "../ai/context.ts";
import { pickDeclared } from "../identity/declared.ts";
import type { MergeInput, PieceValue } from "./variables.ts";

/** La demande, telle que l'edge function la lit. */
export interface DocumentRequestRow {
  reference: string;
  subject: string;
  status: string;
  priority: string;
  received_at: string;
  due_at: string | null;
  closed_at: string | null;
  socle_organization_label: string | null;
  socle_procedure_label: string | null;
  socle_category_label: string | null;
}

/** L'agent instructeur — `null` quand la demande n'est pas affectée. */
export interface DocumentAgentRow {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

/** Une pièce du dossier, pour la boucle `{{#demande.pieces}}`. */
export interface DocumentPieceRow {
  file_name: string;
  document_type_label: string | null;
  compliance: string | null;
}

/** La collectivité émettrice : ce que le Socle a bien voulu dire. */
export interface DocumentOrganismeInput {
  nom: string | null;
  adresse: string | null;
  telephone: string | null;
  courriel: string | null;
  couleurPrincipale: string | null;
  couleurSecondaire: string | null;
}

/** « 12/08/2026 » — sans fuseau : une date de courrier n'en a pas besoin. */
export function frDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

const COMPLIANCE_LABELS: Record<string, string> = {
  conforme: "Conforme",
  non_conforme: "Non conforme",
};

/** Une pièce jamais qualifiée se dit « À qualifier », comme à l'écran. */
export function complianceLabel(compliance: string | null): string {
  if (!compliance) return "À qualifier";
  return COMPLIANCE_LABELS[compliance] ?? compliance;
}

/** État à la clôture : le mot que l'usager comprend, pas le code. */
export function closureLabel(status: string): string {
  if (status === "resolue_positive") return "Positive";
  if (status === "resolue_negative") return "Négative";
  if (status === "annulee") return "Annulée";
  return "";
}

/**
 * Identité de l'usager pour la fusion. `source` est SOIT la fiche Socle relue,
 * SOIT le `declared` du snapshot de dépôt — les mêmes cascades de synonymes
 * (`DECLARED_KEYS`) lisent les deux, comme partout ailleurs dans la gamme.
 */
export function usagerFrom(source: unknown, quartier: string | null): MergeInput["usager"] {
  const nom = pickDeclared(source, "usageName")
    ?? pickDeclared(source, "lastName")
    ?? pickDeclared(source, "legalName")
    ?? pickDeclared(source, "displayName");
  return {
    civilite: pickDeclared(source, "civility"),
    prenom: pickDeclared(source, "firstName"),
    nom,
    voie: pickDeclared(source, "addressLine1") ?? pickDeclared(source, "addressFree"),
    complement: pickDeclared(source, "addressLine2"),
    code_postal: pickDeclared(source, "postalCode"),
    ville: pickDeclared(source, "city"),
    telephone_mobile: pickDeclared(source, "mobilePhone"),
    telephone_fixe: pickDeclared(source, "landlinePhone"),
    courriel: pickDeclared(source, "email"),
    quartier,
  };
}

export interface DocumentInput {
  request: DocumentRequestRow;
  agent: DocumentAgentRow | null;
  pieces: DocumentPieceRow[];
  identity: unknown;
  quartier: string | null;
  organisme: DocumentOrganismeInput;
}

/** Le contexte complet, prêt pour `buildMergeContext`. */
export function buildDocumentInput(input: DocumentInput): MergeInput {
  const r = input.request;
  const pieces: PieceValue[] = input.pieces.map((p) => ({
    libelle: (p.document_type_label ?? "").trim() || p.file_name,
    statut: complianceLabel(p.compliance),
    fichier: p.file_name,
  }));

  return {
    usager: usagerFrom(input.identity, input.quartier),
    demande: {
      libelle_demarche: r.socle_procedure_label,
      code_suivi: r.reference,
      categorie: r.socle_category_label,
      organisme_responsable: r.socle_organization_label,
      date_depot: frDate(r.received_at),
      date_echeance: frDate(r.due_at),
      urgence: PRIORITY_LABELS[r.priority] ?? r.priority,
      etat_actuel: STATUS_LABELS[r.status] ?? r.status,
      date_cloture: frDate(r.closed_at),
      etat_cloture: closureLabel(r.status),
      agent_nom: input.agent?.last_name ?? "",
      agent_prenom: input.agent?.first_name ?? "",
      agent_courriel: input.agent?.email ?? "",
      pieces,
    },
    organisme: {
      nom: input.organisme.nom,
      adresse: input.organisme.adresse,
      telephone: input.organisme.telephone,
      courriel: input.organisme.courriel,
      couleur_principale: input.organisme.couleurPrincipale,
      couleur_secondaire: input.organisme.couleurSecondaire,
    },
  };
}

// ---- Nom du fichier produit -------------------------------------------------

/** `Courrier usager` + `DEM-2026-000042` → `courrier-usager-DEM-2026-000042.pdf`. */
export function documentFileName(templateName: string, reference: string, format: "docx" | "pdf"): string {
  const base = templateName
    .replace(/\.docx$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "document";
  return `${base}-${reference}.${format}`;
}
