import { describe, expect, it } from "vitest";
import {
  agentDisplayName,
  claraOutcome,
  parseRelayRequester,
  relayContentError,
  relayFailure,
  RELAY_BODY_MAX,
  RELAY_MAX_FILE_BYTES,
  RELAY_MAX_FILES,
  senderCategoryOf,
  senderFields,
} from "./relay.ts";

const CONTACT_ID = "4f1c2a9e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

describe("senderFields", () => {
  it("transmet une fiche du Socle relue, rattachée, sans valeur vide", () => {
    const declared = {
      civility: "madame", first_name: "Claire", last_name: "Durand",
      email: "claire@example.org", mobile_phone: "", landline_phone: "0490000000",
    };
    expect(senderFields(declared, "citoyen", CONTACT_ID)).toEqual({
      sender_category: "citoyen",
      sender_civilite: "madame",
      sender_first_name: "Claire",
      sender_last_name: "Durand",
      sender_email: "claire@example.org",
      sender_phone: "0490000000",
      sender_socle_contact_id: CONTACT_ID,
    });
  });
  it("retombe sur le nom d'usage quand il n'y a pas de nom de naissance", () => {
    expect(senderFields({ civilite: "monsieur", nom_usuel: "Martin" }, "citoyen", null)).toEqual({
      sender_category: "citoyen",
      sender_civilite: "monsieur",
      sender_last_name: "Martin",
    });
  });
  it("nomme une personne morale par sa raison sociale, sans civilité ni prénom", () => {
    expect(senderFields({ legal_name: "Les Amis du Rhône", first_name: "X", civility: "monsieur" }, "association", null))
      .toEqual({ sender_category: "association", sender_last_name: "Les Amis du Rhône" });
  });
});

describe("senderCategoryOf", () => {
  it("ramène un type de fiche inconnu à la personne", () => {
    expect(senderCategoryOf("entreprise")).toBe("entreprise");
    expect(senderCategoryOf("association")).toBe("association");
    expect(senderCategoryOf("personne")).toBe("citoyen");
    expect(senderCategoryOf(undefined)).toBe("citoyen");
  });
});

describe("parseRelayRequester", () => {
  it("accepte une fiche du Socle", () => {
    expect(parseRelayRequester({ kind: "contact", socle_contact_id: CONTACT_ID }))
      .toEqual({ kind: "contact", socle_contact_id: CONTACT_ID });
  });
  it("refuse l'anonymat et un identifiant mal formé", () => {
    expect(parseRelayRequester({ kind: "anonyme" })).toHaveProperty("error");
    expect(parseRelayRequester({ kind: "contact", socle_contact_id: "x" })).toHaveProperty("error");
    expect(parseRelayRequester(null)).toHaveProperty("error");
  });
  it("épure une saisie de secours aux champs du public", () => {
    expect(parseRelayRequester({
      kind: "sans_rapprochement",
      audience: "citoyen",
      declared: { civilite: "madame", nom_usuel: " Durand ", siret: "123", internal_notes: "x", courriel: "" },
    })).toEqual({ kind: "sans_rapprochement", audience: "citoyen", declared: { civilite: "madame", nom_usuel: "Durand" } });
  });
  it("exige la civilité et un nom pour une personne, la raison sociale pour une personne morale", () => {
    expect(parseRelayRequester({ kind: "sans_rapprochement", audience: "citoyen", declared: { nom_usuel: "Durand" } }))
      .toEqual({ error: "Usager : civilité obligatoire." });
    expect(parseRelayRequester({ kind: "sans_rapprochement", audience: "citoyen", declared: { civilite: "madame" } }))
      .toEqual({ error: "Usager : nom obligatoire." });
    expect(parseRelayRequester({ kind: "sans_rapprochement", audience: "entreprise", declared: { siret: "1" } }))
      .toEqual({ error: "Usager : raison sociale obligatoire." });
  });
});

describe("relayContentError", () => {
  it("exige un texte ou un fichier", () => {
    expect(relayContentError("  ", [])).toBe("Collez un texte ou joignez au moins un fichier.");
    expect(relayContentError("Texte", [])).toBeNull();
    expect(relayContentError("", [{ name: "scan.pdf", size: 10 }])).toBeNull();
  });
  it("borne le texte, le nombre et la taille des fichiers", () => {
    expect(relayContentError("x".repeat(RELAY_BODY_MAX + 1), [])).toMatch(/dépasse/);
    const many = Array.from({ length: RELAY_MAX_FILES + 1 }, (_, i) => ({ name: `${i}.pdf`, size: 1 }));
    expect(relayContentError("", many)).toBe(`${RELAY_MAX_FILES} fichiers au plus.`);
    expect(relayContentError("", [{ name: "gros.pdf", size: RELAY_MAX_FILE_BYTES + 1 }]))
      .toBe("« gros.pdf » dépasse 10 Mo.");
  });
});

describe("claraOutcome", () => {
  it("lit un dépôt réussi et un rejeu", () => {
    expect(claraOutcome(200, { ok: true, courier_id: "c", reference: "2026-0042" }))
      .toEqual({ kind: "ok", reference: "2026-0042", duplicate: false });
    expect(claraOutcome(200, { ok: true, courier_id: "c", reference: null, duplicate: true }))
      .toEqual({ kind: "ok", reference: null, duplicate: true });
  });
  it("tient un 200 sans courrier pour une réponse inattendue", () => {
    expect(claraOutcome(200, { ok: true })).toEqual({ kind: "unexpected" });
    expect(claraOutcome(200, "<html>")).toEqual({ kind: "unexpected" });
  });
  it("distingue les refus de Clara", () => {
    expect(claraOutcome(400, { error: "validation", message: "Nom de l'usager obligatoire" }))
      .toEqual({ kind: "validation", message: "Nom de l'usager obligatoire" });
    expect(claraOutcome(401, { error: "unauthorized" })).toEqual({ kind: "unauthorized" });
    expect(claraOutcome(404, { error: "organisme_inconnu" })).toEqual({ kind: "organisme_inconnu" });
    expect(claraOutcome(404, {})).toEqual({ kind: "unexpected" });
    expect(claraOutcome(409, { error: "organisme_ambigu" })).toEqual({ kind: "organisme_ambigu" });
    expect(claraOutcome(503, null)).toEqual({ kind: "failed" });
  });
});

describe("relayFailure", () => {
  it("relaie le motif d'un refus de contenu", () => {
    expect(relayFailure({ kind: "validation", message: "Nom de l'usager obligatoire" })).toEqual({
      status: 422,
      code: "clara_rejected",
      message: "Clara a refusé la demande : Nom de l'usager obligatoire.",
    });
  });
  it("ne raconte jamais une clé refusée, et dit toujours que rien n'est parti", () => {
    const failure = relayFailure({ kind: "unauthorized" });
    expect(failure.code).toBe("clara_misconfigured");
    expect(failure.message).not.toMatch(/clé|key|401/i);
    for (const kind of ["unauthorized", "organisme_inconnu", "failed", "unexpected"] as const) {
      expect(relayFailure({ kind }).message).toMatch(/n'a pas été transmise/);
    }
  });
});

describe("agentDisplayName", () => {
  it("nomme l'agent, sinon par son adresse", () => {
    expect(agentDisplayName({ first_name: "Léa", last_name: "Roux", email: "l@x.fr" })).toBe("Léa Roux");
    expect(agentDisplayName({ first_name: null, last_name: " ", email: "l@x.fr" })).toBe("l@x.fr");
    expect(agentDisplayName({})).toBe("Agent Iris");
  });
});
