// Identification du demandeur — logique pure (testée) du rapprochement avec le
// référentiel d'usagers du Socle. Iris ne stocke AUCUN contact localement :
// tout passe par socle-proxy, et seul le couple (socle_contact_id,
// requester_snapshot) sort de ce parcours.
//
// Règles portées ici :
// - aucun rapprochement automatique — le choix d'un candidat est toujours un
//   geste explicite de l'agent, et une similitude de nom seule est signalée ;
// - l'anonymat et les champs demandeur sont gouvernés par le requester_config
//   de la démarche (moteur partagé @fn/.../procedureForm).

import type { Audience } from "@fn/create-request-from-procedure/_shared/procedureForm";

/** Fiche usager telle que sanitisée par socle-proxy (whitelist serveur). */
export interface SocleContact {
  id: string;
  contact_type: string | null;
  status: string | null;
  display_name: string | null;
  civility: string | null;
  first_name: string | null;
  last_name: string | null;
  usage_name: string | null;
  birth_date: string | null;
  legal_name: string | null;
  siret: string | null;
  email: string | null;
  mobile_phone: string | null;
  landline_phone: string | null;
  preferred_channel: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  quartier: { id: string; name: string | null; color: string | null } | null;
}

export interface MatchCandidate {
  contact: SocleContact;
  score: number;
  reasons: string[];
}

/** Public Iris → contact_type Socle (contacts-api). */
export function audienceContactType(audience: Audience): "personne" | "entreprise" | "association" {
  return audience === "citoyen" ? "personne" : audience;
}

// ---- Critères de recherche --------------------------------------------------

export interface MatchIdentity {
  contact_type: "personne" | "entreprise" | "association";
  last_name?: string;
  usage_name?: string;
  first_name?: string;
  legal_name?: string;
  siret?: string;
  email?: string;
  phones?: string[];
  limit?: number;
}

/**
 * Identité déclarée (clés du contrat requester_config) → critères de
 * rapprochement Socle. Refuse une recherche sans discriminant (nom, raison
 * sociale, SIRET, e-mail ou téléphone).
 */
export function buildMatchIdentity(
  audience: Audience,
  declared: Record<string, string>,
): { ok: true; identity: MatchIdentity } | { ok: false; message: string } {
  const t = (v: string | undefined) => (v ?? "").trim();
  const identity: MatchIdentity = { contact_type: audienceContactType(audience) };

  if (audience === "citoyen") {
    if (t(declared.nom_naissance) !== "") identity.last_name = t(declared.nom_naissance);
    if (t(declared.nom_usuel) !== "") identity.usage_name = t(declared.nom_usuel);
    if (t(declared.prenoms) !== "") identity.first_name = t(declared.prenoms);
  } else {
    if (t(declared.raison_sociale) !== "") identity.legal_name = t(declared.raison_sociale);
    if (t(declared.siret) !== "") identity.siret = t(declared.siret);
  }
  if (t(declared.courriel) !== "") identity.email = t(declared.courriel);
  const phones = [t(declared.tel_portable), t(declared.tel_fixe)].filter((p) => p !== "");
  if (phones.length > 0) identity.phones = phones;

  const hasDiscriminant = Boolean(
    identity.last_name || identity.usage_name || identity.legal_name
    || identity.siret || identity.email || identity.phones,
  );
  if (!hasDiscriminant) {
    return {
      ok: false,
      message: "Renseignez au moins un nom, une raison sociale, un SIRET, un e-mail ou un téléphone.",
    };
  }
  return { ok: true, identity };
}

/**
 * Critères de la recherche AUTOMATIQUE d'homonymes au fil de la saisie : mêmes
 * règles que la recherche explicite, mais on attend un identifiant fort
 * (courriel, téléphone, SIRET) ou un nom d'au moins deux caractères avant
 * d'interroger le Socle — jamais sur une lettre isolée.
 */
export function liveSearchIdentity(
  audience: Audience,
  declared: Record<string, string>,
): MatchIdentity | null {
  const built = buildMatchIdentity(audience, declared);
  if (!built.ok) return null;
  const id = built.identity;
  const strong = Boolean(id.email || id.phones || id.siret);
  const nameLength = Math.max(
    (id.last_name ?? "").length,
    (id.usage_name ?? "").length,
    (id.legal_name ?? "").length,
  );
  if (!strong && nameLength < 2) return null;
  return id;
}

// ---- Présentation des candidats --------------------------------------------

/** Libellés FR des raisons de rapprochement Socle (raison inconnue = affichée telle quelle). */
export const MATCH_REASON_LABELS: Record<string, string> = {
  name_exact: "Nom identique",
  name_similar: "Nom similaire",
  usage_name_match: "Nom usuel correspondant",
  legal_name_exact: "Raison sociale identique",
  legal_name_similar: "Raison sociale similaire",
  siret_exact: "SIRET identique",
  email_exact: "E-mail identique",
  phone_exact: "Téléphone identique",
  birth_date_match: "Date de naissance correspondante",
};

export function reasonLabel(reason: string): string {
  return MATCH_REASON_LABELS[reason] ?? reason;
}

/**
 * Vrai si le rapprochement ne repose QUE sur le nom : jamais suffisant pour
 * choisir sans vérification (règle : pas de rapprochement sur le seul nom).
 */
export function isNameOnlyMatch(reasons: string[]): boolean {
  if (reasons.length === 0) return true;
  return reasons.every((r) => r.startsWith("name") || r.startsWith("usage_name") || r.startsWith("legal_name"));
}

export interface CandidateSummary {
  title: string;
  /** Les seules informations utiles à la distinction — rien de plus. */
  details: string[];
}

function frDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export function candidateSummary(contact: SocleContact): CandidateSummary {
  const title = contact.display_name
    || [contact.last_name, contact.first_name].filter(Boolean).join(" ")
    || contact.legal_name
    || "Usager sans nom";
  const details: string[] = [];
  if (contact.birth_date) details.push(`Né(e) le ${frDate(contact.birth_date)}`);
  if (contact.siret) details.push(`SIRET ${contact.siret}`);
  if (contact.email) details.push(contact.email);
  const phones = [contact.mobile_phone, contact.landline_phone].filter(Boolean).join(" · ");
  if (phones) details.push(phones);
  const address = [contact.address_line1, [contact.postal_code, contact.city].filter(Boolean).join(" ")]
    .filter((p) => p && p !== "").join(", ");
  if (address) details.push(address);
  if (contact.quartier?.name) details.push(`Quartier ${contact.quartier.name}`);
  return { title, details };
}

// ---- Création d'un usager ---------------------------------------------------

export interface NewContactForm {
  civilite: string;
  lastName: string;
  usageName: string;
  firstName: string;
  legalName: string;
  siret: string;
  email: string;
  mobilePhone: string;
  landlinePhone: string;
  addressLine1: string;
  postalCode: string;
  city: string;
}

export const EMPTY_NEW_CONTACT: NewContactForm = {
  civilite: "", lastName: "", usageName: "", firstName: "", legalName: "", siret: "",
  email: "", mobilePhone: "", landlinePhone: "",
  addressLine1: "", postalCode: "", city: "",
};

/** Pré-remplit le formulaire de création depuis l'identité déclarée. */
export function newContactFromDeclared(declared: Record<string, string>): NewContactForm {
  return {
    ...EMPTY_NEW_CONTACT,
    civilite: declared.civilite ?? "",
    lastName: declared.nom_naissance ?? "",
    usageName: declared.nom_usuel ?? "",
    firstName: declared.prenoms ?? "",
    legalName: declared.raison_sociale ?? "",
    siret: declared.siret ?? "",
    email: declared.courriel ?? "",
    mobilePhone: declared.tel_portable ?? "",
    landlinePhone: declared.tel_fixe ?? "",
    addressLine1: declared.adresse ?? "",
  };
}

/**
 * Payload de création pour socle-proxy /v1/contacts/create (whitelist côté
 * proxy ET côté Socle) : clés non vides uniquement, jamais d'internal_notes.
 */
export function buildContactCreatePayload(
  audience: Audience,
  form: NewContactForm,
): { ok: true; payload: Record<string, string> } | { ok: false; message: string } {
  const t = (v: string) => v.trim();
  if (audience === "citoyen" && t(form.lastName) === "") {
    return { ok: false, message: "Le nom de naissance est obligatoire pour créer un usager." };
  }
  if (audience !== "citoyen" && t(form.legalName) === "") {
    return { ok: false, message: "La raison sociale est obligatoire pour créer cet usager." };
  }
  const entries: [string, string][] = [["contact_type", audienceContactType(audience)]];
  const push = (key: string, value: string) => {
    if (t(value) !== "") entries.push([key, t(value)]);
  };
  if (audience === "citoyen") {
    push("civility", form.civilite.toLowerCase());
    push("last_name", form.lastName);
    push("usage_name", form.usageName);
    push("first_name", form.firstName);
  } else {
    push("legal_name", form.legalName);
    push("siret", form.siret);
  }
  push("email", form.email);
  push("mobile_phone", form.mobilePhone);
  push("landline_phone", form.landlinePhone);
  push("address_line1", form.addressLine1);
  push("postal_code", form.postalCode);
  push("city", form.city);
  return { ok: true, payload: Object.fromEntries(entries) };
}

/** Critères du rejeu anti-doublon juste avant création (mêmes règles que la recherche). */
export function duplicateCheckIdentity(
  audience: Audience,
  form: NewContactForm,
): { ok: true; identity: MatchIdentity } | { ok: false; message: string } {
  return buildMatchIdentity(audience, {
    nom_naissance: form.lastName,
    nom_usuel: form.usageName,
    prenoms: form.firstName,
    raison_sociale: form.legalName,
    siret: form.siret,
    courriel: form.email,
    tel_portable: form.mobilePhone,
    tel_fixe: form.landlinePhone,
  });
}

// ---- Résolution du demandeur ------------------------------------------------

/**
 * Issue du parcours d'identification. `requester_snapshot` est construit CÔTÉ
 * SERVEUR au dépôt (l'identité d'un contact rapproché est relue depuis Socle) —
 * la résolution ne transporte que le choix de l'agent.
 */
export type RequesterResolution =
  | { kind: "contact"; audience: Audience; contact: SocleContact }
  | { kind: "sans_rapprochement"; audience: Audience; declared: Record<string, string> }
  | { kind: "anonyme" };

export function resolutionSummary(resolution: RequesterResolution): string {
  if (resolution.kind === "anonyme") return "Dépôt anonyme (assumé)";
  if (resolution.kind === "contact") {
    return `${candidateSummary(resolution.contact).title} — usager Socle rapproché`;
  }
  const d = resolution.declared;
  const name = [d.nom_naissance || d.nom_usuel, d.prenoms].filter(Boolean).join(" ")
    || d.raison_sociale || "Identité déclarée";
  return `${name} — sans rapprochement (assumé)`;
}
