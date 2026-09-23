import { describe, expect, it } from "vitest";
import {
  charteFromSocle,
  contrastRatio,
  httpUrl,
  normalizeHex,
  prefersWhiteInk,
  readableInk,
  relativeLuminance,
  type SocleBrandingDto,
} from "./charte.ts";
import { EMAIL_COLORS } from "./template.ts";

/** Réponse type de `GET /v1/organizations/{id}/branding`. */
const dto = (over: Partial<SocleBrandingDto> = {}): SocleBrandingDto => ({
  organization_id: "44b8ebdb-2e7b-4cfa-b4c7-51896b5ff606",
  source_organization_id: "d5227d25-f327-493a-a9a2-278397531e33",
  inherited: true,
  configured: true,
  logo_url: null,
  logo_white_url: null,
  primary_color: null,
  secondary_color: null,
  ...over,
});

describe("normalizeHex", () => {
  it("ramène toute écriture valable à la forme longue minuscule", () => {
    expect(normalizeHex("#1F8A5B")).toBe("#1f8a5b");
    expect(normalizeHex("1f8a5b")).toBe("#1f8a5b");
    expect(normalizeHex("  #FFD166  ")).toBe("#ffd166");
  });

  it("refuse tout le reste", () => {
    expect(normalizeHex("#abc")).toBeNull(); // le Socle ne sert que du long
    expect(normalizeHex("rouge")).toBeNull();
    expect(normalizeHex("rgb(0,0,0)")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(42)).toBeNull();
  });
});

describe("httpUrl", () => {
  it("accepte http et https", () => {
    expect(httpUrl("https://accm.fr/logo.png")).toBe("https://accm.fr/logo.png");
    expect(httpUrl("  http://accm.fr/logo.svg  ")).toBe("http://accm.fr/logo.svg");
  });

  it("refuse tout autre schéma — un src reste un vecteur", () => {
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(httpUrl("/logo.png")).toBeNull();
    expect(httpUrl("   ")).toBeNull();
    expect(httpUrl(null)).toBeNull();
  });
});

describe("contraste", () => {
  it("calcule la luminance des extrêmes", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("rend le rapport maximal entre noir et blanc", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5); // symétrique
  });

  it("GARDE LE BLANC sur le vert du DS — le critère est « suffit-il », pas « est-il le meilleur »", () => {
    // Sur ce vert, l'encre sombre contraste PLUS que le blanc (≈4,5 contre ≈3,6).
    // Un critère de maximum repeindrait donc en sombre le bandeau de tous les
    // e-mails d'Iris, contre la prescription du DS Ariane.
    expect(contrastRatio(EMAIL_COLORS.ink, EMAIL_COLORS.primary))
      .toBeGreaterThan(contrastRatio(EMAIL_COLORS.onPrimary, EMAIL_COLORS.primary));
    expect(readableInk(EMAIL_COLORS.primary)).toBe(EMAIL_COLORS.onPrimary);
  });

  it("bascule en encre sombre là où le blanc ne tient plus", () => {
    expect(readableInk("#ffd166")).toBe(EMAIL_COLORS.ink); // jaune de charte
    expect(readableInk("#ffffff")).toBe(EMAIL_COLORS.ink);
    expect(prefersWhiteInk("#000000")).toBe(true);
    expect(prefersWhiteInk("#1f8a5b")).toBe(true);
    expect(prefersWhiteInk("#ffd166")).toBe(false);
  });
});

describe("charteFromSocle", () => {
  it("rend null quand la collectivité n'a pas rempli sa charte", () => {
    expect(charteFromSocle(dto({ configured: false }))).toBeNull();
    expect(charteFromSocle(dto())).toBeNull(); // configured: true mais tout vide
    expect(charteFromSocle(null)).toBeNull();
    expect(charteFromSocle(undefined)).toBeNull();
  });

  it("une couleur SEULE est une charte : les bordures la prennent", () => {
    const charte = charteFromSocle(dto({ primary_color: "#1f8a5b" }));
    expect(charte).toEqual({
      primary: "#1f8a5b", onPrimary: EMAIL_COLORS.onPrimary, logoUrl: null,
    });
  });

  it("un logo SEUL est une charte : les bordures restent vertes et le bandeau le porte", () => {
    const charte = charteFromSocle(dto({ logo_url: "https://accm.fr/logo.png" }));
    expect(charte).toEqual({
      primary: EMAIL_COLORS.primary,
      onPrimary: EMAIL_COLORS.onPrimary,
      logoUrl: "https://accm.fr/logo.png",
    });
  });

  it("sert toujours le logo COULEUR — le bandeau est blanc, quelle que soit la charte", () => {
    for (const primary_color of ["#1f8a5b", "#ffd166"]) {
      const charte = charteFromSocle(dto({
        primary_color,
        logo_url: "https://accm.fr/logo.png",
        logo_white_url: "https://accm.fr/logo-blanc.svg",
      }));
      expect(charte?.logoUrl).toBe("https://accm.fr/logo.png");
    }
  });

  it("n'envoie JAMAIS le logo blanc — sur le bandeau blanc il disparaîtrait", () => {
    // Blanc seulement : mieux vaut pas de logo qu'un logo invisible.
    const blancSeul = charteFromSocle(dto({
      primary_color: "#ffd166",
      logo_white_url: "https://accm.fr/logo-blanc.svg",
    }));
    expect(blancSeul).toEqual({
      primary: "#ffd166", onPrimary: EMAIL_COLORS.ink, logoUrl: null,
    });
    // Et sans couleur, un logo blanc seul n'est pas une charte.
    expect(charteFromSocle(dto({ logo_white_url: "https://accm.fr/logo-blanc.svg" }))).toBeNull();
  });

  it("ignore une couleur illisible et une URL de logo qui n'est pas du http(s)", () => {
    expect(charteFromSocle(dto({ primary_color: "bleu", logo_url: "javascript:alert(1)" })))
      .toBeNull();

    // Couleur invalide + logo valable : les bordures restent vertes, le logo passe.
    const charte = charteFromSocle(dto({ primary_color: "#zzzzzz", logo_url: "https://accm.fr/l.png" }));
    expect(charte).toEqual({
      primary: EMAIL_COLORS.primary,
      onPrimary: EMAIL_COLORS.onPrimary,
      logoUrl: "https://accm.fr/l.png",
    });
  });

  it("cas réel du référentiel : un logo couleur et AUCUNE couleur déclarée", () => {
    // C'est la situation d'ACCM au 2026-08-30, et celle dont toutes ses
    // sous-organisations héritent. Les bordures restent vertes, et le logo
    // couleur — dessiné pour du papier — se pose sur le bandeau blanc.
    const charte = charteFromSocle(dto({
      logo_url: "https://upload.wikimedia.org/wikipedia/commons/accm.png",
    }));
    expect(charte).toEqual({
      primary: EMAIL_COLORS.primary,
      onPrimary: EMAIL_COLORS.onPrimary,
      logoUrl: "https://upload.wikimedia.org/wikipedia/commons/accm.png",
    });
  });

  it("tolère un contrat servi en majuscules ou avec des champs en trop", () => {
    const charte = charteFromSocle({
      ...dto({ primary_color: "#1F8A5B" }),
      // Champ inconnu : les contrats de la gamme sont faits pour être étendus.
      brand_font: "Marianne",
    } as SocleBrandingDto);
    expect(charte?.primary).toBe("#1f8a5b");
  });
});
