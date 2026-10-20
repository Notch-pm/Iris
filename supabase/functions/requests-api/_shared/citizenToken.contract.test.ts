import { describe, expect, it } from "vitest";
import { CITIZEN_TOKEN_MAX_SECONDS, signCitizenToken, verifyCitizenToken } from "./citizenToken";

/**
 * TEST DE CONTRAT avec le portail Nora : les jetons ci-dessous ont été SIGNÉS
 * PAR NORA (`signCitizenToken` de `supabase/functions/_shared/iris/citizenToken.ts`,
 * dépôt Nora, test `citizenToken.test.ts` « vecteur de référence partagé avec
 * Iris »). Le même secret, le même instant, le même sujet → le même jeton, à
 * l'octet près. Si l'un des deux dépôts change de format, ce test ou son
 * jumeau échoue.
 */
const SECRET = "i".repeat(48);
const TENANT = "8f1e0d3a-0000-4000-8000-0000000000a1";
const CONTACT = "cccccccc-0000-4000-8000-000000000001";
const REQUEST = "dddddddd-0000-4000-8000-000000000002";
const NOW = 1_800_000_000;

const NORA_CONTACT_TOKEN =
  "eyJ2IjoxLCJ0IjoiOGYxZTBkM2EtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMGExIiwic3ViIjoiY29udGFjdDpjY2NjY2NjYy0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJleHAiOjE4MDAwMDAxMjAsImUiOiJjYW1pbGxlQGV4YW1wbGUub3JnIn0.aFRIySbti6iw_uB9Yrrf1sA3HlX_ToEPV3G1oDl8pLQ";
const NORA_REQUEST_TOKEN =
  "eyJ2IjoxLCJ0IjoiOGYxZTBkM2EtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMGExIiwic3ViIjoicmVxdWVzdDpkZGRkZGRkZC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIiLCJleHAiOjE4MDAwMDAxMjB9.KGp11Lc5zFg0v8gTISBJWqb8-8c0dQCq3mScWx-o3H0";

describe("jeton signé par Nora, vérifié par Iris", () => {
  it("fiche : sujet, collectivité et adresse (en minuscules) reconnus", async () => {
    expect(await verifyCitizenToken(SECRET, NORA_CONTACT_TOKEN, TENANT, NOW)).toEqual({ kind: "contact", id: CONTACT, email: "camille@example.org" });
  });

  it("invité : sujet reconnu, sans adresse", async () => {
    expect(await verifyCitizenToken(SECRET, NORA_REQUEST_TOKEN, TENANT, NOW)).toEqual({ kind: "request", id: REQUEST, version: null });
  });

  it("refusé : autre collectivité, autre secret, expiré, ou signé trop long (au-delà de 3 minutes)", async () => {
    expect(await verifyCitizenToken(SECRET, NORA_CONTACT_TOKEN, "8f1e0d3a-0000-4000-8000-0000000000b2", NOW)).toBeNull();
    expect(await verifyCitizenToken("j".repeat(48), NORA_CONTACT_TOKEN, TENANT, NOW)).toBeNull();
    expect(await verifyCitizenToken(SECRET, NORA_CONTACT_TOKEN, TENANT, NOW + 120)).toBeNull(); // exp atteint
    expect(await verifyCitizenToken(SECRET, NORA_CONTACT_TOKEN, TENANT, NOW - CITIZEN_TOKEN_MAX_SECONDS)).toBeNull(); // exp trop lointain pour ce « maintenant »
    expect(await verifyCitizenToken(SECRET, NORA_CONTACT_TOKEN, TENANT, NOW - 60)).toEqual({ kind: "contact", id: CONTACT, email: "camille@example.org" });
  });

  it("la signature d'Iris reproduit celle de Nora, octet pour octet (même ordre de clés)", async () => {
    expect(
      await signCitizenToken(SECRET, { v: 1, t: TENANT, sub: `contact:${CONTACT}`, exp: NOW + 120, e: "camille@example.org" }),
    ).toBe(NORA_CONTACT_TOKEN);
    expect(await signCitizenToken(SECRET, { v: 1, t: TENANT, sub: `request:${REQUEST}`, exp: NOW + 120 })).toBe(NORA_REQUEST_TOKEN);
  });

  it("une charge altérée (autre sujet) avec la signature d'origine est refusée", async () => {
    const [, mac] = NORA_CONTACT_TOKEN.split(".");
    const forgedBody = btoa(JSON.stringify({ v: 1, t: TENANT, sub: "contact:bbbbbbbb-0000-4000-8000-0000000000b1", exp: NOW + 120 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyCitizenToken(SECRET, `${forgedBody}.${mac}`, TENANT, NOW)).toBeNull();
  });
});
