import { describe, expect, it } from "vitest";
import {
  addressRows, channelLabel, civilityLabel, contactName, contactRows, contactStatusLabel,
  contactTypeLabel, frDate, identityRows, isDarkColor, isInactive, usagerStats,
} from "./usager";
import type { SocleContact } from "./rapprochement";

const EMPTY: SocleContact = {
  id: "c1", contact_type: null, status: null, display_name: null, civility: null,
  first_name: null, last_name: null, usage_name: null, birth_date: null, legal_name: null,
  siret: null, email: null, mobile_phone: null, landline_phone: null, preferred_channel: null,
  address_line1: null, address_line2: null, postal_code: null, city: null, country: null,
  quartier: null,
};

const contact = (patch: Partial<SocleContact>): SocleContact => ({ ...EMPTY, ...patch });

describe("libellés", () => {
  it("traduit les publics connus et laisse passer les inconnus", () => {
    expect(contactTypeLabel("personne")).toBe("Citoyen");
    expect(contactTypeLabel("entreprise")).toBe("Entreprise");
    expect(contactTypeLabel("collectivite")).toBe("collectivite");
    expect(contactTypeLabel(null)).toBe("Usager");
  });

  it("traduit statut, civilité et canal préféré, null si absent", () => {
    expect(contactStatusLabel("active")).toBe("Actif");
    expect(contactStatusLabel("archived")).toBe("Archivé");
    expect(contactStatusLabel(null)).toBeNull();
    expect(civilityLabel("monsieur")).toBe("Monsieur");
    expect(civilityLabel(null)).toBeNull();
    expect(channelLabel("email")).toBe("Courriel");
    expect(channelLabel("pigeon")).toBe("pigeon");
  });

  it("ne badge que les statuts autres qu'« active »", () => {
    expect(isInactive("active")).toBe(false);
    expect(isInactive(null)).toBe(false);
    expect(isInactive("archived")).toBe(true);
  });

  it("formate une date ISO nue sans décalage de fuseau", () => {
    expect(frDate("1978-08-21")).toBe("21/08/1978");
    expect(frDate("inconnue")).toBe("inconnue");
  });
});

describe("contactName", () => {
  it("préfère display_name", () => {
    expect(contactName(contact({ display_name: "Marie Dupont", first_name: "Marie", last_name: "Martin" })))
      .toBe("Marie Dupont");
  });

  it("compose prénom + nom d'usage (à défaut nom de naissance)", () => {
    expect(contactName(contact({ first_name: "Marie", last_name: "Martin", usage_name: "Dupont" })))
      .toBe("Marie Dupont");
    expect(contactName(contact({ first_name: "Marie", last_name: "Martin" }))).toBe("Marie Martin");
  });

  it("retombe sur la raison sociale puis sur un libellé neutre", () => {
    expect(contactName(contact({ legal_name: "Boulangerie Martin" }))).toBe("Boulangerie Martin");
    expect(contactName(EMPTY)).toBe("Usager sans nom");
  });

});

describe("blocs d'informations", () => {
  it("n'expose que les champs renseignés", () => {
    const rows = identityRows(contact({ civility: "madame", first_name: "Marie", birth_date: "1978-08-21" }));
    expect(rows.map((r) => r.label)).toEqual(["Civilité", "Prénom(s)", "Date de naissance"]);
    expect(rows[2]!.value).toBe("21/08/1978");
    expect(identityRows(EMPTY)).toEqual([]);
  });

  it("marque le SIRET en valeur technique", () => {
    expect(identityRows(contact({ siret: "12345678900012" }))).toEqual([
      { label: "SIRET", value: "12345678900012", mono: true },
    ]);
  });

  it("liste les coordonnées et traduit le canal préféré", () => {
    const rows = contactRows(contact({ email: "m@example.org", mobile_phone: "0600000000", preferred_channel: "email" }));
    expect(rows).toEqual([
      { label: "Courriel", value: "m@example.org" },
      { label: "Téléphone mobile", value: "0600000000" },
      { label: "Canal préféré", value: "Courriel" },
    ]);
  });

  it("regroupe code postal et commune", () => {
    const rows = addressRows(contact({ address_line1: "12 rue des Lilas", postal_code: "44000", city: "Nantes" }));
    expect(rows).toEqual([
      { label: "Adresse", value: "12 rue des Lilas" },
      { label: "Commune", value: "44000 Nantes" },
    ]);
  });
});

describe("usagerStats", () => {
  it("compte ouvertes/clôturées et retient le dépôt le plus récent", () => {
    const stats = usagerStats([
      { status: "a_traiter", created_at: "2026-08-01T10:00:00Z" },
      { status: "en_instruction", created_at: "2026-08-20T10:00:00Z" },
      { status: "resolue_positive", created_at: "2026-07-01T10:00:00Z" },
      { status: "archivee", created_at: "2026-06-01T10:00:00Z" },
    ]);
    expect(stats).toEqual({ total: 4, open: 2, closed: 2, lastAt: "2026-08-20T10:00:00Z" });
  });

  it("supporte l'absence de demande", () => {
    expect(usagerStats([])).toEqual({ total: 0, open: 0, closed: 0, lastAt: null });
  });
});

describe("isDarkColor", () => {
  it("choisit un texte clair sur une couleur sombre", () => {
    expect(isDarkColor("#1b3a2f")).toBe(true);
    expect(isDarkColor("#000")).toBe(true);
  });

  it("choisit un texte sombre sur une couleur claire", () => {
    expect(isDarkColor("#ffd166")).toBe(false);
    expect(isDarkColor("fff")).toBe(false);
  });

  it("traite toute valeur non reconnue comme claire", () => {
    expect(isDarkColor("rebeccapurple")).toBe(false);
    expect(isDarkColor("")).toBe(false);
  });
});
