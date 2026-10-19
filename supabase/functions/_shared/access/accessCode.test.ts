import { describe, expect, it } from "vitest";
import {
  ACCESS_CODE_ALPHABET,
  accessCodeHash,
  accessEmailHash,
  newAccessCode,
  normalizeAccessCode,
  normalizeAccessEmail,
  normalizeTrackingUrl,
  pepperFrom,
} from "./accessCode";

const PEPPER = "p".repeat(40);

describe("newAccessCode", () => {
  it("tire 10 caractères de l'alphabet, groupés 4-4-2", () => {
    const code = newAccessCode();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
    for (const char of code.replace(/-/g, "")) expect(ACCESS_CODE_ALPHABET).toContain(char);
  });

  it("utilise tout l'alphabet sans biais (5 bits de poids faible)", () => {
    const fixed = (bytes: Uint8Array) => {
      bytes.set([0, 31, 32, 63, 255, 10, 18, 21, 27, 29]);
      return bytes;
    };
    expect(newAccessCode(fixed)).toBe("0Z0Z-ZAJN-VX");
  });

  it("ne tire jamais deux fois le même code en pratique", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => newAccessCode()));
    expect(codes.size).toBe(2000);
  });
});

describe("normalizeAccessCode", () => {
  it("pardonne la casse, les espaces, les tirets et les confusions O/0, I/1, L/1", () => {
    expect(normalizeAccessCode("abcd-efgh-jk")).toBe("ABCDEFGHJK");
    expect(normalizeAccessCode(" 0O1I L234 56 ")).toBe("0011123456");
  });

  it("refuse une longueur ou un caractère hors alphabet", () => {
    expect(normalizeAccessCode("ABCD-EFGH-J")).toBeNull();
    expect(normalizeAccessCode("ABCD-EFGH-JKM")).toBeNull();
    expect(normalizeAccessCode("ABCD-EFGH-JU")).toBeNull();
    expect(normalizeAccessCode(42)).toBeNull();
  });
});

describe("empreintes", () => {
  it("dépendent du poivre et du domaine", async () => {
    const a = await accessCodeHash(PEPPER, "ABCDEFGHJK");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await accessCodeHash(PEPPER, "ABCDEFGHJK")).toBe(a);
    expect(await accessCodeHash("q".repeat(40), "ABCDEFGHJK")).not.toBe(a);
    expect(await accessEmailHash(PEPPER, "ABCDEFGHJK")).not.toBe(a);
  });

  it("une adresse est comparée en minuscules, sans espaces autour", async () => {
    const email = normalizeAccessEmail("  Jeanne.Dupont@Example.FR ");
    expect(email).toBe("jeanne.dupont@example.fr");
    expect(normalizeAccessEmail("pas-une-adresse")).toBeNull();
  });
});

describe("pepperFrom", () => {
  it("refuse un poivre absent ou trop court", () => {
    expect(pepperFrom(undefined)).toBeNull();
    expect(pepperFrom("court")).toBeNull();
    expect(pepperFrom(PEPPER)).toBe(PEPPER);
  });
});

describe("normalizeTrackingUrl", () => {
  it("n'accepte qu'une page https sans identifiants", () => {
    expect(normalizeTrackingUrl("https://sceaux.edilumen.fr/suivi")).toBe("https://sceaux.edilumen.fr/suivi");
    expect(normalizeTrackingUrl("http://sceaux.edilumen.fr/suivi")).toBeNull();
    expect(normalizeTrackingUrl("https://a:b@sceaux.edilumen.fr/suivi")).toBeNull();
    expect(normalizeTrackingUrl("javascript:alert(1)")).toBeNull();
  });
});
