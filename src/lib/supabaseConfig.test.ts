import { describe, expect, it } from "vitest";
import { readSupabaseConfig } from "./supabaseConfig";

describe("readSupabaseConfig", () => {
  const valid = {
    VITE_SUPABASE_URL: "https://exemple.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_exemple",
  };

  it("retourne la configuration quand les deux variables sont présentes", () => {
    expect(readSupabaseConfig(valid)).toEqual({
      url: "https://exemple.supabase.co",
      publishableKey: "sb_publishable_exemple",
    });
  });

  it("échoue explicitement si l'URL manque", () => {
    expect(() =>
      readSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: valid.VITE_SUPABASE_PUBLISHABLE_KEY }),
    ).toThrow(/VITE_SUPABASE_URL/);
  });

  it("échoue explicitement si la clé publiable manque", () => {
    expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL })).toThrow(
      /VITE_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it("traite une chaîne vide comme une valeur manquante", () => {
    expect(() => readSupabaseConfig({ ...valid, VITE_SUPABASE_URL: "" })).toThrow(
      /VITE_SUPABASE_URL/,
    );
  });

  it("rejette une valeur non textuelle (env mal formé)", () => {
    expect(() => readSupabaseConfig({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: true })).toThrow(
      /VITE_SUPABASE_PUBLISHABLE_KEY/,
    );
  });
});
