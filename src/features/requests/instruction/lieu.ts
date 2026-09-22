// Lieu d'intervention — extraction PURE (sans DOM ni réseau) de l'adresse
// portée par le formulaire de la démarche.
//
// Deux formes coexistent dans le contrat Socle, et Iris lit les deux :
//
//  1. **Le champ `location`** (Socle 1.29.0, 2026-09-22) : UN champ, reconnu
//     par son `type`, dont la valeur est `{ address, lat, lon, precision,
//     adjusted }` — l'adresse sur une ligne et le POINT que l'usager a retenu,
//     éventuellement déplacé (150 m au plus) pour désigner l'endroit exact.
//     ⚠️ Ce point PRIME sur tout géocodage : l'usager sait mieux que la BAN où
//     il a posé son épingle. Il est porté par `point`, et la fiche comme la
//     carte l'utilisent sans appeler le géocodeur.
//  2. **L'ancien bloc** : une **section ordinaire** pré-remplie de champs dont
//     les clés machine sont préfixées `intervention_` (numéro, BTQ, voie…).
//     Tout y reste modifiable après insertion : on le reconnaît d'abord par ses
//     **clés**, puis, à défaut, par le **titre** de la section et les libellés
//     de ses champs. Sans point : c'est le géocodage qui situe.
//
// Aucune de ces reconnaissances n'est une garde : elle ne décide que d'un
// affichage. Sur un snapshot dégradé (schéma illisible), on relit `form_data`
// par les clés du contrat — `intervention_lieu` d'abord, puis toute valeur qui a
// la forme d'un lieu, puis les sept clés de l'ancien bloc.
//
// ⚠️ **Ce qui a été DÉPOSÉ l'emporte sur ce que le schéma annonce.** Le snapshot
// est figé au dépôt et peut ignorer le champ que la réponse porte : Socle
// injoignable (snapshot dégradé, `form_schema: null`), ou démarche dont le
// formulaire a changé entre le chargement du portail et l'arrivée de la
// demande. Sans cette règle, l'adresse tombait dans les « Informations
// saisies » en JSON brut, et la fiche affichait un lieu vide (vécu le
// 2026-09-22). On ne renonce donc jamais à une adresse réellement présente
// dans `form_data`.

import {
  dataKey,
  fieldIsVisible,
  flatFields,
  isSection,
  parseLocationValue,
  type FlatField,
  type FormSchema,
  type FormValues,
  type LocationPrecision,
  type Section,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import { displayFieldValue } from "../creation/model";
import { normalizeSearch } from "../creation/procedureSearch";
import { formSchemaFrom } from "./instruction";

const PARTS = [
  "numero", "btq", "voie", "batiment", "complement", "appartement", "code_postal", "ville",
] as const;
export type AddressPart = (typeof PARTS)[number];

/** Clés machine posées par le bloc « Lieu d'intervention » du Socle. */
const KEY_BY_PART: Record<AddressPart, string> = {
  numero: "intervention_numero",
  btq: "intervention_btq",
  voie: "intervention_voie",
  // Le bloc Socle se complète après insertion : `batiment` n'y est pas toujours,
  // mais quand il y est on le reconnaît plutôt que de le laisser tomber dans
  // les « Informations saisies ».
  batiment: "intervention_batiment",
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
  batiment: "Bâtiment",
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
  ["batiment", "batiment"],
  ["bat", "batiment"],
  ["immeuble", "batiment"],
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

/** Le point déclaré au dépôt par un champ `location` — jamais un point géocodé par Iris. */
export interface StoredPoint {
  lat: number;
  lon: number;
  precision: LocationPrecision | null;
  /** L'usager a déplacé le point : il diffère de celui de l'adresse (150 m au plus). */
  adjusted: boolean;
}

export interface InterventionLocation {
  /** Titre de la section ou libellé du champ tel que la démarche le porte. */
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
  /**
   * Le point déclaré au dépôt (champ `location`), ou `null` : ancien bloc,
   * texte libre sans proposition retenue — il faut alors géocoder.
   */
  point: StoredPoint | null;
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
  // Snapshot dégradé (Socle injoignable à l'ingestion) — ou schéma que ce moteur
  // n'a pas su lire (un type inconnu vide TOUT le schéma, parité Socle) : les
  // clés du contrat suffisent à reconstituer l'adresse.
  if (!schema || schema.content.length === 0) return fromRawData(data);

  const entries = flatFields(schema);
  const byId: FormValues = {};
  for (const entry of entries) byId[entry.field.id] = data[dataKey(entry.field)];
  const visible = entries.filter(
    (entry) => entry.field.type !== "attachment" && fieldIsVisible(entry, byId),
  );

  // Le champ `location` d'abord : c'est la forme qui porte un point.
  const location = locationField(visible);
  if (location) {
    return fromLocationValue(
      location.field.label.trim() || "Lieu d'intervention",
      dataKey(location.field),
      data[dataKey(location.field)],
    );
  }

  const found = interventionFields(schema, visible);
  if (!found) {
    // Rien de visible. Deux situations à ne pas confondre :
    //  - le schéma DÉCRIT un lieu, masqué par une condition : le masquage est
    //    une décision de la démarche, on ne ressuscite rien ;
    //  - le schéma n'en décrit AUCUN : la réponse en porte peut-être un quand
    //    même (snapshot dégradé ou périmé — voir l'en-tête).
    const tous = entries.filter((entry) => entry.field.type !== "attachment");
    const decritUnLieu = locationField(tous) !== null || interventionFields(schema, tous) !== null;
    return decritUnLieu ? null : fromRawData(data);
  }

  const valueOf = (part: AddressPart): string => {
    const entry = found.get(part);
    if (!entry) return "";
    return displayFieldValue(entry.field, data[dataKey(entry.field)]).trim();
  };
  const labelOf = (part: AddressPart): string => {
    const label = found.get(part)?.field.label.trim();
    return label && label !== "" ? label : LABEL_BY_PART[part];
  };

  const lieu = build({
    title: sectionOf(found)?.title.trim() || "Lieu d'intervention",
    keys: PARTS.filter((part) => found.has(part)).map((part) => dataKey(found.get(part)!.field)),
    valueOf,
    labelOf,
  });
  // Le bloc reconnu est resté vide, mais une adresse a bien été déposée sous
  // une autre clé : c'est elle qui est vraie. Le bloc vide reste le cas normal
  // d'une question sans réponse — on ne le remplace que si l'on trouve mieux.
  if (lieu.empty) {
    const deposee = fromRawData(data);
    if (deposee && !deposee.empty) return deposee;
  }
  return lieu;
}

/**
 * Le champ `location` parmi `candidates` — reconnu par son TYPE, jamais par sa
 * clé (`intervention_lieu` n'est qu'un défaut, modifiable dans le Socle). Le
 * premier rencontré fait foi. Servi à la lecture (fiche, carte) comme à la
 * saisie (création guichet).
 */
export function locationField(candidates: FlatField[]): FlatField | null {
  return candidates.find((entry) => entry.field.type === "location") ?? null;
}

/** Itinéraire : les coordonnées quand l'usager a déplacé le point, l'adresse sinon. */
export function directionsTarget(lieu: InterventionLocation): string | { lat: number; lon: number } | null {
  if (lieu.point && lieu.point.adjusted) return { lat: lieu.point.lat, lon: lieu.point.lon };
  return lieu.query === "" ? null : lieu.query;
}

/**
 * Reconnaissance du bloc parmi `candidates` — l'unique endroit où l'on décide
 * « ce champ-là porte le numéro, celui-ci la voie ».
 *
 * Servie DEUX FOIS : à la LECTURE d'une demande (`interventionLocation`, sur
 * les champs visibles compte tenu des réponses) et à la SAISIE (formulaire de
 * création, sur tous les champs du schéma). Une seule reconnaissance, sans quoi
 * un bloc reconnu à l'écriture pourrait ne plus l'être à la relecture.
 *
 * `null` quand rien ne ressemble à une adresse : ni voie, ni commune, ni code
 * postal.
 */
export function interventionFields(
  schema: FormSchema,
  candidates: FlatField[],
): Map<AddressPart, FlatField> | null {
  const found = new Map<AddressPart, FlatField>();
  const used = new Set<string>();

  // 1. Par clé machine, où que le champ se trouve dans le formulaire.
  for (const entry of candidates) {
    const part = PART_BY_KEY.get(dataKey(entry.field));
    if (part && !found.has(part)) {
      found.set(part, entry);
      used.add(entry.field.id);
    }
  }

  // 2. Par section : celle des champs reconnus, sinon celle titrée « Lieu
  //    d'intervention ». Ses champs comblent les parts manquantes par libellé
  //    (clés renommées dans le Socle après insertion du bloc).
  const section = sectionOf(found) ?? titledSection(schema.content, candidates);
  if (section) {
    for (const entry of candidates) {
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
  return found;
}

export interface StreetParts {
  numero: string;
  btq: string;
  voie: string;
}

/**
 * Répartit une ligne de voie sur les champs QUE LE BLOC PORTE RÉELLEMENT.
 *
 * Le bloc du Socle se retaille après insertion : il peut n'avoir ni numéro ni
 * BTQ, et son BTQ est souvent une liste fermée (bis / ter / quater) qui ne sait
 * pas dire « A ». Ce qu'aucun champ ne peut porter rejoint la **voie** au lieu
 * d'être perdu : une adresse un peu tassée reste une adresse, un numéro effacé
 * n'en est plus une.
 */
export function fitStreetParts(
  parts: StreetParts,
  available: (part: AddressPart) => boolean,
  coerceBtq: (text: string) => string | null,
): StreetParts {
  const head: string[] = [];
  let numero = parts.numero.trim();
  let btq = parts.btq.trim();

  if (btq !== "") {
    const option = available("btq") ? coerceBtq(btq) : null;
    if (option === null) {
      head.push(btq);
      btq = "";
    } else {
      btq = option;
    }
  }
  if (numero !== "" && !available("numero")) {
    head.unshift(numero);
    numero = "";
  }
  return { numero, btq, voie: [...head, parts.voie.trim()].filter((v) => v !== "").join(" ") };
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

/** Un lieu d'intervention depuis la valeur d'un champ `location`. */
function fromLocationValue(title: string, key: string, raw: unknown): InterventionLocation {
  const value = parseLocationValue(raw);
  const address = value?.address ?? "";
  const point: StoredPoint | null =
    value !== null && value.lat !== null && value.lon !== null
      ? { lat: value.lat, lon: value.lon, precision: value.precision, adjusted: value.adjusted }
      : null;
  return {
    title,
    keys: [key],
    lines: address === "" ? [] : [address],
    query: address,
    details: [],
    postcode: address.match(/\b\d{5}\b/)?.[0] ?? null,
    city: null,
    empty: address === "",
    point,
  };
}

/** Reconstitution depuis les seules clés du contrat (sans schéma exploitable). */
function fromRawData(data: Record<string, unknown>): InterventionLocation | null {
  // Le champ `location` d'abord — sous sa clé par défaut, puis sous n'importe
  // quelle clé dont la valeur a la forme d'un lieu (clé renommée dans le Socle).
  const locationKey =
    parseLocationValue(data.intervention_lieu) !== null
      ? "intervention_lieu"
      : Object.keys(data).find((key) => isRecord(data[key]) && parseLocationValue(data[key]) !== null);
  if (locationKey !== undefined) return fromLocationValue("Lieu d'intervention", locationKey, data[locationKey]);

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
  // Précisions d'accès : utiles à l'agent sur place, inutiles — voire nuisibles —
  // au géocodeur, qui ne les comprend pas et dégraderait le point.
  for (const part of ["batiment", "complement", "appartement"] as const) {
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
    point: null,
  };
}
