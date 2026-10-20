import { describe, expect, it } from "vitest";
import { signCitizenToken, verifyCitizenToken } from "./citizenToken";

const SECRET = "s".repeat(40);
const TENANT = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const REQ = "11111111-1111-4111-8111-111111111111";
const NOW = 1_800_000_000;

describe("verifyCitizenToken", () => {
  it("ouvre une demande, ou les demandes d'une fiche avec l'adresse du compte", async () => {
    const guest = await signCitizenToken(SECRET, { v: 1, t: TENANT, sub: `request:${REQ}`, exp: NOW + 120 });
    expect(await verifyCitizenToken(SECRET, guest, TENANT, NOW)).toEqual({ kind: "request", id: REQ });
    const account = await signCitizenToken(SECRET, { v: 1, t: TENANT, sub: `contact:${REQ}`, e: "Jeanne@Example.fr", exp: NOW + 120 });
    expect(await verifyCitizenToken(SECRET, account, TENANT, NOW)).toEqual({ kind: "contact", id: REQ, email: "jeanne@example.fr" });
  });

  it("refuse un autre secret, une autre collectivité, un jeton expiré ou trop long", async () => {
    const t = (payload: Record<string, unknown>, secret = SECRET) => signCitizenToken(secret, payload);
    const base = { v: 1, t: TENANT, sub: `request:${REQ}`, exp: NOW + 120 };
    expect(await verifyCitizenToken(SECRET, await t(base, "x".repeat(40)), TENANT, NOW)).toBeNull();
    expect(await verifyCitizenToken(SECRET, await t(base), OTHER, NOW)).toBeNull();
    expect(await verifyCitizenToken(SECRET, await t({ ...base, exp: NOW }), TENANT, NOW)).toBeNull();
    expect(await verifyCitizenToken(SECRET, await t({ ...base, exp: NOW + 3600 }), TENANT, NOW)).toBeNull();
    expect(await verifyCitizenToken(SECRET, await t({ ...base, sub: "request:../../x" }), TENANT, NOW)).toBeNull();
    expect(await verifyCitizenToken(SECRET, await t({ ...base, sub: `admin:${REQ}` }), TENANT, NOW)).toBeNull();
  });

  it("refuse une charge modifiée", async () => {
    const token = await signCitizenToken(SECRET, { v: 1, t: TENANT, sub: `request:${REQ}`, exp: NOW + 120 });
    const forged = btoa(JSON.stringify({ v: 1, t: TENANT, sub: `contact:${REQ}`, exp: NOW + 120 })).replace(/=+$/, "");
    expect(await verifyCitizenToken(SECRET, `${forged}.${token.split(".")[1]}`, TENANT, NOW)).toBeNull();
    expect(await verifyCitizenToken(SECRET, null, TENANT, NOW)).toBeNull();
    expect(await verifyCitizenToken(SECRET, "pas-un-jeton", TENANT, NOW)).toBeNull();
  });
});
