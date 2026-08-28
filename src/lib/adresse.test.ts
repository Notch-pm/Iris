import { describe, expect, it } from "vitest";
import {
  addressSearchUrl, MIN_QUERY_LENGTH, parseAddressSuggestions, reverseAddressUrl,
  splitHouseNumber, splitStreetLine, streetLine, suggestionContext, toContactAddress,
  toInterventionParts, type AddressSuggestion,
} from "./adresse";

const BASE = "https://geo.test/search/";

/**
 * Réponse RÉELLE de la Géoplateforme (2026-08-28), champs inconnus compris :
 * c'est le contrat qu'on lit, pas une idée qu'on s'en fait.
 */
const REAL_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-1.573, 47.223] },
      properties: {
        label: "10 Avenue de Frémeur 44000 Nantes",
        score: 0.5195881818181818,
        housenumber: "10",
        id: "44109_3356_00010",
        banId: "2c8e69ec-738b-49a1-a894-a6348f088748",
        name: "10 Avenue de Frémeur",
        postcode: "44000",
        citycode: "44109",
        x: 357140.87,
        y: 6691210.31,
        city: "Nantes",
        context: "44, Loire-Atlantique, Pays de la Loire",
        type: "housenumber",
        importance: 0.71547,
        depcode: "44",
        street: "Avenue de Frémeur",
        _type: "address",
      },
    },
  ],
};

function suggestion(over: Partial<AddressSuggestion> = {}): AddressSuggestion {
  return {
    id: "x", label: "10 Avenue de Frémeur 44000 Nantes", name: "10 Avenue de Frémeur",
    housenumber: "10", street: "Avenue de Frémeur", postcode: "44000", city: "Nantes",
    citycode: "44109", context: "44, Loire-Atlantique, Pays de la Loire",
    precision: "adresse", score: 0.5, lat: 47.223, lon: -1.573,
    ...over,
  };
}

describe("addressSearchUrl", () => {
  it("complète pendant la frappe — c'est ce qui la distingue de geocodeUrl", () => {
    const url = new URL(addressSearchUrl("10 av frem", BASE)!);
    expect(url.searchParams.get("q")).toBe("10 av frem");
    expect(url.searchParams.get("autocomplete")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("ne pose pas de requête trop courte", () => {
    expect(addressSearchUrl("ru", BASE)).toBeNull();
    expect(addressSearchUrl("   ", BASE)).toBeNull();
    expect(addressSearchUrl("a".repeat(MIN_QUERY_LENGTH), BASE)).not.toBeNull();
  });
});

describe("reverseAddressUrl", () => {
  it("déduit le point d'entrée inverse de celui de la recherche", () => {
    const url = new URL(reverseAddressUrl(47.22, -1.57, BASE)!);
    expect(url.pathname).toBe("/reverse/");
    expect(url.searchParams.get("lat")).toBe("47.22");
    expect(url.searchParams.get("lon")).toBe("-1.57");
  });

  it("renonce plutôt que de composer une URL au hasard sur un endpoint substitué", () => {
    expect(reverseAddressUrl(47.22, -1.57, "https://geo.test/autre/")).toBeNull();
  });

  it("refuse des coordonnées hors du monde", () => {
    expect(reverseAddressUrl(120, 0, BASE)).toBeNull();
    expect(reverseAddressUrl(Number.NaN, 0, BASE)).toBeNull();
  });
});

describe("parseAddressSuggestions", () => {
  it("lit une réponse réelle et ignore les champs inconnus", () => {
    const [s] = parseAddressSuggestions(REAL_RESPONSE);
    expect(s).toEqual({
      id: "44109_3356_00010",
      label: "10 Avenue de Frémeur 44000 Nantes",
      name: "10 Avenue de Frémeur",
      housenumber: "10",
      street: "Avenue de Frémeur",
      postcode: "44000",
      city: "Nantes",
      citycode: "44109",
      context: "44, Loire-Atlantique, Pays de la Loire",
      precision: "adresse",
      score: 0.5195881818181818,
      lat: 47.223,
      lon: -1.573,
    });
  });

  it("rend une liste vide sur toute forme inattendue — jamais d'exception", () => {
    for (const raw of [null, undefined, 42, "texte", {}, { features: "non" }, { features: [] }]) {
      expect(parseAddressSuggestions(raw)).toEqual([]);
    }
  });

  it("saute les entrées inexploitables et garde les bonnes", () => {
    const parsed = parseAddressSuggestions({
      features: [
        { properties: { label: "Sans géométrie" } },
        { geometry: { coordinates: [0] }, properties: { label: "Coordonnées incomplètes" } },
        { geometry: { coordinates: [200, 0] }, properties: { label: "Hors monde" } },
        { geometry: { coordinates: [1, 2] }, properties: { score: 1 } }, // sans libellé
        REAL_RESPONSE.features[0],
      ],
    });
    expect(parsed.map((s) => s.label)).toEqual(["10 Avenue de Frémeur 44000 Nantes"]);
  });

  it("traduit le type BAN en finesse, l'inconnu vers la plus large", () => {
    const of = (type: unknown) =>
      parseAddressSuggestions({
        features: [{ geometry: { coordinates: [1, 2] }, properties: { label: "L", type } }],
      })[0]!.precision;
    expect(of("housenumber")).toBe("adresse");
    expect(of("street")).toBe("voie");
    expect(of("locality")).toBe("lieu_dit");
    expect(of("municipality")).toBe("commune");
    expect(of("galaxie")).toBe("commune");
    expect(of(undefined)).toBe("commune");
  });
});

describe("splitHouseNumber", () => {
  it("sépare le BTQ du numéro", () => {
    expect(splitHouseNumber("10")).toEqual({ numero: "10", btq: "" });
    expect(splitHouseNumber("10 bis")).toEqual({ numero: "10", btq: "bis" });
    expect(splitHouseNumber("10bis")).toEqual({ numero: "10", btq: "bis" });
    expect(splitHouseNumber("2 TER")).toEqual({ numero: "2", btq: "TER" });
  });

  it("laisse tel quel ce qui ne commence pas par un nombre", () => {
    expect(splitHouseNumber("")).toEqual({ numero: "", btq: "" });
    expect(splitHouseNumber("lot 4")).toEqual({ numero: "lot 4", btq: "" });
  });
});

describe("splitStreetLine — la saisie libre, sans proposition retenue", () => {
  it("sépare numéro, BTQ et voie", () => {
    expect(splitStreetLine("10 bis Avenue de Frémeur")).toEqual({
      numero: "10", btq: "bis", voie: "Avenue de Frémeur",
    });
    expect(splitStreetLine("10 Avenue de Frémeur")).toEqual({
      numero: "10", btq: "", voie: "Avenue de Frémeur",
    });
    expect(splitStreetLine("2 A rue du Port")).toEqual({ numero: "2", btq: "A", voie: "rue du Port" });
  });

  it("ne prend pas un mot de voie pour un BTQ", () => {
    expect(splitStreetLine("10 Rue Neuve")).toEqual({ numero: "10", btq: "", voie: "Rue Neuve" });
  });

  it("laisse une voie sans numéro entière", () => {
    expect(splitStreetLine("Avenue de Frémeur")).toEqual({ numero: "", btq: "", voie: "Avenue de Frémeur" });
    expect(splitStreetLine("   ")).toEqual({ numero: "", btq: "", voie: "" });
  });

  it("fait l'aller-retour avec streetLine", () => {
    for (const line of ["10 bis Avenue de Frémeur", "10 Rue Neuve", "Avenue de Frémeur"]) {
      expect(streetLine(splitStreetLine(line))).toBe(line);
    }
  });
});

describe("toInterventionParts", () => {
  it("remplit numéro, BTQ, voie, code postal et ville", () => {
    expect(toInterventionParts(suggestion({ housenumber: "10 bis" }))).toEqual({
      numero: "10", btq: "bis", voie: "Avenue de Frémeur", code_postal: "44000", ville: "Nantes",
    });
  });

  it("reprend le libellé de voie quand la BAN ne rend pas de numéro", () => {
    const rue = suggestion({ precision: "voie", housenumber: "", street: "", name: "Avenue de Frémeur" });
    expect(toInterventionParts(rue)).toEqual({
      numero: "", btq: "", voie: "Avenue de Frémeur", code_postal: "44000", ville: "Nantes",
    });
  });

  it("ne remplit jamais les précisions d'accès — le géocodeur n'en sait rien", () => {
    const parts = toInterventionParts(suggestion());
    for (const absent of ["complement", "appartement", "batiment"]) {
      expect(parts).not.toHaveProperty(absent);
    }
  });
});

describe("toContactAddress", () => {
  it("remplit la ligne 1, le code postal et la ville", () => {
    expect(toContactAddress(suggestion())).toEqual({
      addressLine1: "10 Avenue de Frémeur", postalCode: "44000", city: "Nantes",
    });
  });

  it("ne duplique pas la ville en ligne 1 sur une commune seule", () => {
    const commune = suggestion({ precision: "commune", name: "Nantes", housenumber: "", street: "" });
    expect(toContactAddress(commune)).toEqual({ addressLine1: "", postalCode: "44000", city: "Nantes" });
  });

  it("ne touche ni au complément ni au pays", () => {
    const address = toContactAddress(suggestion());
    expect(address).not.toHaveProperty("addressLine2");
    expect(address).not.toHaveProperty("country");
  });
});

describe("suggestionContext", () => {
  it("montre le contexte départemental, à défaut la commune", () => {
    expect(suggestionContext(suggestion())).toBe("44, Loire-Atlantique, Pays de la Loire");
    expect(suggestionContext(suggestion({ context: "" }))).toBe("44000 Nantes");
    expect(suggestionContext(suggestion({ context: "", postcode: "", city: "" }))).toBe("");
  });
});
