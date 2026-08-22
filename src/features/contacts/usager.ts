// Fiche usager — logique pure (sans DOM ni réseau), testée. Tout ce qui se
// DÉDUIT d'une fiche Socle sanitisée (nom d'affichage, public, coordonnées,
// adresse, quartier) et du jeu de demandes visibles de cet usager vit ici ;
// les composants ne font qu'afficher.
//
// Rappel : Iris ne stocke AUCUN usager. La fiche affichée est relue à chaque
// visite depuis le Socle via socle-proxy (whitelist serveur) ; seules les
// demandes sont des données Iris, bornées par le RLS.

import { isFinal, type RequestStatus } from "@/features/requests/statuts";
import type { SocleContact } from "./rapprochement";

/** Ligne « libellé / valeur » d'un bloc d'informations. */
export interface FieldRow {
  label: string;
  value: string;
  /** Valeur technique (identifiant) : rendue en fonte à chasse fixe. */
  mono?: boolean;
}

// Contrat contacts-api du Socle : contact_type personne | entreprise |
// association | administration, status active | archived, civility madame |
// monsieur. Toute valeur hors contrat est affichée telle quelle.
const CONTACT_TYPE_LABELS: Record<string, string> = {
  personne: "Citoyen",
  entreprise: "Entreprise",
  association: "Association",
  administration: "Administration",
};

const CONTACT_STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  archived: "Archivé",
};

const CIVILITY_LABELS: Record<string, string> = {
  madame: "Madame",
  monsieur: "Monsieur",
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Courriel",
  courrier: "Courrier",
  telephone: "Téléphone",
  sms: "SMS",
  guichet: "Guichet",
};

/** Public de l'usager — valeur inconnue affichée telle quelle (contrat Socle ouvert). */
export function contactTypeLabel(type: string | null): string {
  if (!type) return "Usager";
  return CONTACT_TYPE_LABELS[type] ?? type;
}

export function contactStatusLabel(status: string | null): string | null {
  if (!status) return null;
  return CONTACT_STATUS_LABELS[status] ?? status;
}

/** Statut à signaler (archivé, ou toute valeur hors contrat) — « active » ne se badge pas. */
export function isInactive(status: string | null): boolean {
  return status !== null && status !== "" && status !== "active";
}

export function civilityLabel(civility: string | null): string | null {
  if (!civility) return null;
  return CIVILITY_LABELS[civility] ?? civility;
}

export function channelLabel(channel: string | null): string | null {
  if (!channel) return null;
  return CHANNEL_LABELS[channel] ?? channel;
}

/** « 21/08/1978 » depuis une date ISO nue (aucun décalage de fuseau). */
export function frDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Nom d'affichage : display_name Socle, sinon nom composé, sinon raison sociale. */
export function contactName(contact: SocleContact): string {
  const composed = [contact.first_name, contact.usage_name ?? contact.last_name]
    .filter((p) => p && p.trim() !== "")
    .join(" ")
    .trim();
  return (contact.display_name?.trim() || composed || contact.legal_name?.trim() || "Usager sans nom");
}

/** Bloc « Identité » — seulement les champs renseignés. */
export function identityRows(contact: SocleContact): FieldRow[] {
  const rows: FieldRow[] = [];
  const push = (label: string, value: string | null | undefined, mono = false) => {
    if (value && value.trim() !== "") rows.push({ label, value: value.trim(), mono });
  };
  push("Civilité", civilityLabel(contact.civility));
  push("Prénom(s)", contact.first_name);
  push("Nom de naissance", contact.last_name);
  push("Nom d'usage", contact.usage_name);
  if (contact.birth_date) rows.push({ label: "Date de naissance", value: frDate(contact.birth_date) });
  push("Raison sociale", contact.legal_name);
  push("SIRET", contact.siret, true);
  return rows;
}

/** Bloc « Coordonnées ». */
export function contactRows(contact: SocleContact): FieldRow[] {
  const rows: FieldRow[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim() !== "") rows.push({ label, value: value.trim() });
  };
  push("Courriel", contact.email);
  push("Téléphone mobile", contact.mobile_phone);
  push("Téléphone fixe", contact.landline_phone);
  push("Canal préféré", channelLabel(contact.preferred_channel));
  return rows;
}

/** Bloc « Adresse » — le quartier est rendu à part (pastille de couleur). */
export function addressRows(contact: SocleContact): FieldRow[] {
  const rows: FieldRow[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim() !== "") rows.push({ label, value: value.trim() });
  };
  push("Adresse", contact.address_line1);
  push("Complément", contact.address_line2);
  const city = [contact.postal_code, contact.city].filter((p) => p && p.trim() !== "").join(" ");
  if (city !== "") rows.push({ label: "Commune", value: city });
  push("Pays", contact.country);
  return rows;
}

/**
 * Quartier du référentiel : sa couleur est libre (choisie dans le Socle), le
 * texte du badge doit donc s'adapter. Luminance perçue ITU-R BT.601 ; toute
 * couleur non reconnue est traitée comme claire (texte sombre).
 */
export function isDarkColor(color: string): boolean {
  const raw = (color.startsWith("#") ? color.slice(1) : color).trim();
  const hex = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

// ---- Demandes de l'usager ---------------------------------------------------

export interface UsagerRequestLike {
  status: string;
  created_at: string;
}

export interface UsagerStats {
  total: number;
  /** Demandes encore ouvertes (statut non final). */
  open: number;
  closed: number;
  /** Dépôt le plus récent (ISO), null si aucune demande. */
  lastAt: string | null;
}

export function usagerStats(rows: UsagerRequestLike[]): UsagerStats {
  let open = 0;
  let lastAt: string | null = null;
  for (const r of rows) {
    if (!isFinal(r.status as RequestStatus)) open += 1;
    if (lastAt === null || r.created_at > lastAt) lastAt = r.created_at;
  }
  return { total: rows.length, open, closed: rows.length - open, lastAt };
}
