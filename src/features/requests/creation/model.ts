// Types et helpers d'affichage partagés par les écrans du parcours de création.

import {
  AUDIENCES,
  type Field as SchemaField,
  type FormSchema,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import type { ProcedureSnapshot } from "@/features/socle/useSocleCatalog";
import { candidateSummary, type RequesterResolution } from "@/features/contacts/rapprochement";

export interface LoadedProcedure {
  snapshot: ProcedureSnapshot;
  schema: FormSchema;
}

/** Étapes de saisie (la confirmation de création n'est pas une étape du stepper). */
export type CreationStep = 1 | 2 | 3 | 4;

/** Demandes liées choisies pendant la saisie : id → référence. */
export type LinkedRequests = Record<string, string>;

export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Valeur d'un champ de formulaire telle que lue par un humain. */
export function displayFieldValue(field: SchemaField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "boolean") return value === true ? "Oui" : "Non";
  if (field.type === "date" && typeof value === "string") return formatIsoDate(value);
  if (field.type === "select" || field.type === "radio") {
    return field.options.find((o) => o.value === value)?.label ?? String(value);
  }
  if (field.type === "checkboxes" && Array.isArray(value)) {
    return value
      .map((v) => field.options.find((o) => o.value === v)?.label ?? String(v))
      .join(", ");
  }
  return String(value);
}

const DECLARED_LABELS: Record<string, string> = Object.fromEntries([
  ...AUDIENCES.flatMap((a) => a.fields.map((f) => [f.key, f.label] as const)),
  ["date_naissance", "Date de naissance"],
]);

export function declaredLabel(key: string): string {
  return DECLARED_LABELS[key] ?? key;
}

export interface RequesterRow {
  label: string;
  value: string;
  mono?: boolean;
}

/** Nom court du demandeur (stepper, rail, confirmation). */
export function requesterShortName(resolution: RequesterResolution | null): string | null {
  if (!resolution) return null;
  if (resolution.kind === "anonyme") return "Dépôt anonyme";
  if (resolution.kind === "contact") return candidateSummary(resolution.contact).title;
  const d = resolution.declared;
  return [d.nom_naissance || d.nom_usuel, d.prenoms].filter(Boolean).join(" ")
    || d.raison_sociale || "Identité déclarée";
}

/** Lignes du récapitulatif / récépissé pour le demandeur retenu. */
export function requesterRows(resolution: RequesterResolution): RequesterRow[] {
  if (resolution.kind === "anonyme") {
    return [{ label: "Identité", value: "Dépôt anonyme (assumé par l'agent)" }];
  }
  if (resolution.kind === "contact") {
    const c = resolution.contact;
    const rows: RequesterRow[] = [{ label: "Nom", value: candidateSummary(c).title }];
    if (c.birth_date) rows.push({ label: "Date de naissance", value: formatIsoDate(c.birth_date) });
    if (c.siret) rows.push({ label: "SIRET", value: c.siret });
    const address = [c.address_line1, c.address_line2, [c.postal_code, c.city].filter(Boolean).join(" ")]
      .filter((p) => p && p !== "").join(", ");
    if (address) rows.push({ label: "Adresse", value: address });
    if (c.email) rows.push({ label: "Courriel", value: c.email });
    const phones = [c.mobile_phone, c.landline_phone].filter(Boolean).join(" · ");
    if (phones) rows.push({ label: "Téléphone", value: phones });
    rows.push({ label: "Identifiant Socle", value: c.id, mono: true });
    return rows;
  }
  const rows = Object.entries(resolution.declared).map(([key, value]) => ({
    label: declaredLabel(key),
    value: key === "date_naissance" ? formatIsoDate(value) : value,
  }));
  rows.push({ label: "Rapprochement", value: "Aucun — identité déclarée (assumé par l'agent)" });
  return rows;
}
