import { describe, expect, it } from "vitest";
import { parseListQuery, READ_TENANT_SCOPE } from "./list-query";

const CONTACT = "3C0E3978-DFBD-4C17-A67B-4B8B7D232C97";
const q = (s: string) => new URLSearchParams(s);

describe("parseListQuery", () => {
  it("garde les valeurs par défaut de la réconciliation", () => {
    expect(parseListQuery(q(""), ["requests:read"])).toEqual({
      ok: true,
      value: { limit: 100, updatedSince: null, socleContactId: null, allSources: false },
    });
  });

  it("refuse une limite hors bornes et une date illisible", () => {
    expect(parseListQuery(q("limit=0"), ["requests:read"]).ok).toBe(false);
    expect(parseListQuery(q("limit=501"), ["requests:read"]).ok).toBe(false);
    expect(parseListQuery(q("updated_since=hier"), ["requests:read"]).ok).toBe(false);
  });

  it("refuse un usager qui n'est pas un UUID", () => {
    const r = parseListQuery(q("socle_contact_id=42"), ["requests:read", READ_TENANT_SCOPE]);
    expect(r).toMatchObject({ ok: false });
  });

  it("sans le scope, un usager nommé reste limité à la source de la clé", () => {
    const r = parseListQuery(q(`socle_contact_id=${CONTACT}`), ["requests:read"]);
    expect(r).toMatchObject({ ok: true, value: { socleContactId: CONTACT.toLowerCase(), allSources: false } });
  });

  it("avec le scope ET un usager nommé, toutes les sources du tenant", () => {
    const r = parseListQuery(q(`socle_contact_id=${CONTACT}`), ["requests:read", READ_TENANT_SCOPE]);
    expect(r).toMatchObject({ ok: true, value: { allSources: true } });
  });

  it("avec le scope mais sans usager, rien ne s'élargit (pas d'aspiration du tenant)", () => {
    const r = parseListQuery(q("limit=500"), ["requests:read", READ_TENANT_SCOPE]);
    expect(r).toMatchObject({ ok: true, value: { allSources: false } });
  });
});
