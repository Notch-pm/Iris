import { describe, expect, it } from "vitest";
import { openApiSpecUrl, tokenToCssColor } from "./redocTheme";

describe("openApiSpecUrl", () => {
  it("pointe sur le contrat servi par l'edge function", () => {
    expect(openApiSpecUrl("https://abc.supabase.co")).toBe(
      "https://abc.supabase.co/functions/v1/requests-api/v1/openapi.json",
    );
  });

  it("tolère une barre finale", () => {
    expect(openApiSpecUrl("https://abc.supabase.co/")).toBe(
      "https://abc.supabase.co/functions/v1/requests-api/v1/openapi.json",
    );
  });
});

describe("tokenToCssColor", () => {
  it("rétablit les virgules attendues par Redoc", () => {
    expect(tokenToCssColor("153 90% 32%")).toBe("hsl(153, 90%, 32%)");
  });

  it("tolère les espaces du getPropertyValue", () => {
    expect(tokenToCssColor("  153   90%  32%  ")).toBe("hsl(153, 90%, 32%)");
  });

  it("retombe sur le vert du design system si le token manque", () => {
    expect(tokenToCssColor(null)).toBe("hsl(153, 90%, 32%)");
    expect(tokenToCssColor("")).toBe("hsl(153, 90%, 32%)");
    expect(tokenToCssColor("153")).toBe("hsl(153, 90%, 32%)");
  });
});
