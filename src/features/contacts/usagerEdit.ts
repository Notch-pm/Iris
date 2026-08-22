// Modification d'une fiche usager — logique pure (sans DOM ni réseau), testée.
//
// L'écriture va au SOCLE (source de vérité), en PATCH partiel : seules les
// clés réellement changées partent, et une valeur vidée part à `null`. Ce
// module ne protège rien — le Socle reste l'arbitre (invariants par type,
// SIRET unique, formats) ; il ne fait que refléter ses règles pour éviter un
// aller-retour et donner un message français au bon champ.
//
// Iris n'édite QUE ce qu'il lit (whitelist `sanitizeContact`) : ni notes
// internes, ni consentements, ni rôles, ni relations, ni quartier — ce dernier
// est recalculé par le Socle depuis l'adresse.

import type { SocleContact } from "./rapprochement";

export interface UsagerForm {
  civility: string;
  firstName: string;
  lastName: string;
  usageName: string;
  birthDate: string;
  legalName: string;
  siret: string;
  email: string;
  mobilePhone: string;
  landlinePhone: string;
  preferredChannel: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
}

/** Clé du formulaire → clé du contrat contacts-api. */
const FIELD_KEYS: [keyof UsagerForm, string][] = [
  ["civility", "civility"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["usageName", "usage_name"],
  ["birthDate", "birth_date"],
  ["legalName", "legal_name"],
  ["siret", "siret"],
  ["email", "email"],
  ["mobilePhone", "mobile_phone"],
  ["landlinePhone", "landline_phone"],
  ["preferredChannel", "preferred_channel"],
  ["addressLine1", "address_line1"],
  ["addressLine2", "address_line2"],
  ["postalCode", "postal_code"],
  ["city", "city"],
  ["country", "country"],
];

/** Champs interdits par le Socle selon le type (CHECK en base, rejoués ici). */
const PERSON_ONLY: (keyof UsagerForm)[] = ["civility", "firstName", "lastName", "usageName", "birthDate"];
const STRUCTURE_ONLY: (keyof UsagerForm)[] = ["legalName", "siret"];

export function isPerson(contactType: string | null): boolean {
  return contactType === "personne" || contactType === null;
}

/** Champs saisissables pour ce type d'usager (les autres ne sont ni montrés ni transmis). */
export function editableFields(contactType: string | null): Set<keyof UsagerForm> {
  const excluded = isPerson(contactType) ? STRUCTURE_ONLY : PERSON_ONLY;
  return new Set(FIELD_KEYS.map(([key]) => key).filter((key) => !excluded.includes(key)));
}

export function formFromContact(contact: SocleContact): UsagerForm {
  const v = (value: string | null) => value ?? "";
  return {
    civility: v(contact.civility),
    firstName: v(contact.first_name),
    lastName: v(contact.last_name),
    usageName: v(contact.usage_name),
    birthDate: v(contact.birth_date),
    legalName: v(contact.legal_name),
    siret: v(contact.siret),
    email: v(contact.email),
    mobilePhone: v(contact.mobile_phone),
    landlinePhone: v(contact.landline_phone),
    preferredChannel: v(contact.preferred_channel),
    addressLine1: v(contact.address_line1),
    addressLine2: v(contact.address_line2),
    postalCode: v(contact.postal_code),
    city: v(contact.city),
    country: v(contact.country),
  };
}

export type FieldErrors = Partial<Record<keyof UsagerForm, string>>;

const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Contrôles de confort, miroir des règles du Socle : invariants par type,
 * SIRET à 14 chiffres, date ISO, pays non vidé. Le serveur revalide.
 */
export function validateUsagerForm(form: UsagerForm, contactType: string | null): FieldErrors {
  const errors: FieldErrors = {};
  const t = (v: string) => v.trim();

  if (isPerson(contactType)) {
    // Le Socle refuse une personne sans civilité (CHECK contacts_person_shape).
    if (t(form.civility) === "") errors.civility = "Obligatoire pour un citoyen.";
    // Pas d'exigence de « nom de naissance » (le Socle ne l'impose pas), mais
    // un usager sans aucun nom n'aurait plus de display_name : on l'évite.
    if (t(form.lastName) === "" && t(form.usageName) === "" && t(form.firstName) === "") {
      errors.lastName = "Renseignez au moins un nom : naissance, usage ou prénom.";
    }
    if (t(form.birthDate) !== "" && !BIRTH_DATE_RE.test(t(form.birthDate))) {
      errors.birthDate = "Date attendue au format AAAA-MM-JJ.";
    }
  } else {
    if (t(form.legalName) === "") errors.legalName = "La raison sociale est obligatoire.";
    const siret = form.siret.replace(/\s/g, "");
    if (siret !== "" && !/^\d{14}$/.test(siret)) errors.siret = "SIRET : 14 chiffres attendus.";
  }

  const email = t(form.email);
  if (email !== "" && (!email.includes("@") || /\s/.test(email))) {
    errors.email = "Adresse électronique invalide.";
  }
  if (t(form.country) === "") errors.country = "Le pays ne peut pas être vidé.";
  return errors;
}

/**
 * Patch partiel pour `socle-proxy /v1/contacts/update` : uniquement les champs
 * saisissables pour ce type ET réellement modifiés ; valeur vidée → `null`
 * (efface côté Socle). Retourne un patch vide s'il n'y a rien à enregistrer.
 */
export function buildContactPatch(
  initial: UsagerForm,
  form: UsagerForm,
  contactType: string | null,
): Record<string, string | null> {
  const editable = editableFields(contactType);
  const patch: Record<string, string | null> = {};
  for (const [formKey, socleKey] of FIELD_KEYS) {
    if (!editable.has(formKey)) continue;
    const before = initial[formKey].trim();
    const after = formKey === "siret" ? form[formKey].replace(/\s/g, "") : form[formKey].trim();
    if (after === before) continue;
    patch[socleKey] = after === "" ? null : after;
  }
  return patch;
}
