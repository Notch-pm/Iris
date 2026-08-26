// Lieu d'intervention — extraction PURE (sans DOM ni réseau) de l'adresse
// portée par le formulaire de la démarche.
//
// Le Socle propose un bloc prêt à l'emploi « Lieu d'intervention » : une
// **section ordinaire** du `form_schema` (aucun type dédié dans le contrat —
// cf. `docs/integration.md` du Socle), pré-remplie de champs dont les clés
// machine sont préfixées `intervention_`. Tout y reste modifiable après
// insertion : on reconnaît donc le bloc d'abord par ses **clés** (la donnée du
// contrat), puis, à défaut, par le **titre** de la section et les libellés de
// ses champs. Aucune de ces reconnaissances n'est une garde : elle ne décide
// que d'un affichage.

import {
  dataKey,
  fieldIsVisible,
  flatFields,
  isSection,
  type FlatField,
  type FormValues,
  type Section,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import { displayFieldValue } from "../creation/model";
import { normalizeSearch } from "../creation/procedureSearch";
import { formSchemaFrom } from "./instruction";

const PARTS = ["numero", "btq", "voie", "complement", "appartement", "code_postal", "ville"] as const;
export type AddressPart = (typeof PARTS)[number];

/** Clés machine posées par le bloc « Lieu d'intervention » du Socle. */
const KEY_BY_PART: Record<AddressPart, string> = {
  numero: "intervention_numero",
  btq: "intervention_btq",
  voie: "intervention_voie",
  complement: "intervention_complement",
  appartement: "intervention_appartement",
  code_postal: "intervention_code_postal",
  ville: "intervention_ville",
};

const PART_BY_KEY = new Map<string, AddressPart>(
  PARTS.map((part) => [KEY_BY_PART[part], part] as const),
);

/** Libellés du bloc Socle — repli quand les clés ont été renommées. */
const LABEL_BY_PART: Record<AddressPart, string> = {
  numero: "Numéro",
  btq: "BTQ",
  voie: "Voie",
  complement: "Complément d'adresse",
  appartement: "Appartement",
  code_postal: "Code postal",
  ville: "Ville",
};

const PART_BY_LABEL = new Map<string, AddressPart>([
  ["numero", "numero"],
  ["n", "numero"],
  ["numero de voie", "numero"],
  ["btq", "btq"],
  ["bis ter quater", "btq"],
  ["voie", "voie"],
  ["rue", "voie"],
  ["nom de la voie", "voie"],
  ["complement d adresse", "complement"],
  ["complement", "complement"],
  ["appartement", "appartement"],
  ["code postal", "code_postal"],
  ["ville", "ville"],
  ["commune", "ville"],
]);

const SECTION_TITLE = "lieu d intervention";

/** « Complément d'adresse » → « complement d adresse » (comparaison de libellés). */
function normalize(text: string): string {
  return normalizeSearch(text).replace(/[^a-z0-9]+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface InterventionLocation {
  /** Titre de la section tel que la démarche le porte (souvent « Lieu d'intervention »). */
  title: string;
  /** Clés de `form_data` couvertes par le bloc — à retirer des « Informations saisies ». */
  keys: string[];
  /** Adresse postale à afficher, ligne par ligne. */
  lines: string[];
  /** Adresse postale sur une ligne : destination d'itinéraire ET requête de géocodage. */
  query: string;
  /** Précisions d'accès (complément, appartement) : utiles à l'agent, inutiles au GPS. */
  details: { label: string; value: string }[];
  postcode: string | null;
  city: string | null;
  /** La démarche pose la question, l'adresse n'a pas été renseignée. */
  empty: boolean;
}

/**
 * Adresse du lieu d'intervention d'une demande, ou `null` si la démarche ne
 * pose pas la question (le bloc n'est alors pas affiché du tout).
 *
 * Les conditions de visibilité sont rejouées sur les réponses stockées, comme
 * pour les autres informations saisies : une section masquée ne produit rien.
 */
export function interventionLocation(
  procedureSnapshot: unknown,
  formData: unknown,
): InterventionLocation | null {
  const data = isRecord(formData) ? formData : {};
  const schema = formSchemaFrom(procedureSnapshot);
  // Snapshot dégradé (Socle injoignable à l'ingestion) : les clés du contrat
  // suffisent à reconstituer l'adresse, avec les libellés du bloc Socle.
  if (!schema) return fromRawData(data);

  const entries = flatFields(schema);
  const byId: FormValues = {};
  for (const entry of entries) byId[entry.field.id] = data[dataKey(entry.field)];
  const visible = entries.filter(
    (entry) => entry.field.type !== "attachment" && fieldIsVisible(entry, byId),
  );

  const found = new Map<AddressPart, FlatField>();
  const used = new Set<string>();

  // 1. Par clé machine, où que le champ se trouve dans le formulaire.
  for (const entry of visible) {
    const part = PART_BY_KEY.get(dataKey(entry.field));
    if (part && !found.has(part)) {
      found.set(part, entry);
      used.add(entry.field.id);
    }
  }

  // 2. Par section : celle des champs reconnus, sinon celle titrée « Lieu
  //    d'intervention ». Ses champs comblent les parts manquantes par libellé
  //    (clés renommées dans le Socle après insertion du bloc).
  const section = sectionOf(found) ?? titledSection(schema.content, visible);
  if (section) {
    for (const entry of visible) {
      if (entry.section !== section || used.has(entry.field.id)) continue;
      const part = PART_BY_LABEL.get(normalize(entry.field.label));
      if (part && !found.has(part)) {
        found.set(part, entry);
        used.add(entry.field.id);
      }
    }
  }

  // Ni voie ni commune : ce n'est pas une adresse — pas de bloc.
  if (!found.has("voie") && !found.has("ville") && !found.has("code_postal")) return null;

  const valueOf = (part: AddressPart): string => {
    const entry = found.get(part);
    if (!entry) return "";
    return displayFieldValue(entry.field, data[dataKey(entry.field)]).trim();
  };
  const labelOf = (part: AddressPart): string => {
    const label = found.get(part)?.field.label.trim();
    return label && label !== "" ? label : LABEL_BY_PART[part];
  };

  return build({
    title: section?.title.trim() || "Lieu d'intervention",
    keys: PARTS.filter((part) => found.has(part)).map((part) => dataKey(found.get(part)!.field)),
    valueOf,
    labelOf,
  });
}

/** Section portant les champs reconnus (la première rencontrée fait foi). */
function sectionOf(found: Map<AddressPart, FlatField>): Section | null {
  for (const part of PARTS) {
    const section = found.get(part)?.section;
    if (section) return section;
  }
  return null;
}

function titledSection(content: readonly unknown[], visible: FlatField[]): Section | null {
  for (const node of content) {
    if (!node || typeof node !== "object") continue;
    const candidate = node as Section;
    if (!isSection(candidate)) continue;
    if (!normalize(candidate.title).startsWith(SECTION_TITLE)) continue;
    // Section masquée par ses conditions : aucun de ses champs n'est visible.
    if (visible.some((entry) => entry.section === candidate)) return candidate;
  }
  return null;
}

/** Reconstitution depuis les seules clés du contrat (sans schéma exploitable). */
function fromRawData(data: Record<string, unknown>): InterventionLocation | null {
  const present = PARTS.filter((part) => {
    const value = data[KEY_BY_PART[part]];
    return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
  });
  if (!present.includes("voie") && !present.includes("ville") && !present.includes("code_postal")) {
    return null;
  }
  const valueOf = (part: AddressPart): string => {
    const value = data[KEY_BY_PART[part]];
    return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
  };
  return build({
    title: "Lieu d'intervention",
    keys: present.map((part) => KEY_BY_PART[part]),
    valueOf,
    labelOf: (part) => LABEL_BY_PART[part],
  });
}

function build(input: {
  title: string;
  keys: string[];
  valueOf: (part: AddressPart) => string;
  labelOf: (part: AddressPart) => string;
}): InterventionLocation {
  const { valueOf } = input;
  const street = [valueOf("numero"), valueOf("btq"), valueOf("voie")].filter((v) => v !== "").join(" ");
  const city = [valueOf("code_postal"), valueOf("ville")].filter((v) => v !== "").join(" ");
  const lines = [street, city].filter((v) => v !== "");

  const details: { label: string; value: string }[] = [];
  for (const part of ["complement", "appartement"] as const) {
    const value = valueOf(part);
    if (value !== "") details.push({ label: input.labelOf(part), value });
  }

  return {
    title: input.title,
    keys: input.keys,
    lines,
    query: lines.join(", "),
    details,
    postcode: valueOf("code_postal") || null,
    city: valueOf("ville") || null,
    empty: lines.length === 0 && details.length === 0,
  };
}
