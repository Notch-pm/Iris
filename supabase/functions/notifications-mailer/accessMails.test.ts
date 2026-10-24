import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { MASKED_ACCESS_CODE } from "../_shared/access/accessCode.ts";

const sent: { to: string; content: unknown }[] = [];
let sendFails = false;
vi.mock("../_shared/email/transport.ts", () => ({
  sendBrandedEmail: async (_smtp: unknown, to: string, content: unknown) => {
    if (sendFails) throw new Error("relais muet");
    sent.push({ to, content });
  },
}));
vi.mock("../_shared/email/socleUsager.ts", () => ({ charteFor: async () => null }));

const { drainAccessMails } = await import("./accessMails.ts");

const SMTP = { host: "smtp.test" } as never;
const ROW = {
  mail_id: "m1",
  request_id: "r1",
  organization_id: "o1",
  organization_name: "Ville de Sceaux",
  socle_scope_org_id: null,
  reference: "DEM-2026-000042",
  subject: "Acte de naissance",
  reason: "renvoi_usager",
  requested_by: null,
  to_email: "usager@example.org",
  access_code: "WXYZ-WXYZ-WX",
  tracking_url: "https://sceaux.edilumen.fr/suivi",
  email_id: null,
  email_subject: null,
  email_body: null,
  attempts: 1,
};

let calls: { name: string; params: Record<string, unknown> }[] = [];
function fakeSupabase(rows: unknown[], startResult: unknown = "e1"): SupabaseClient {
  return {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "claim_request_access_mails") return { data: rows, error: null };
      if (name === "start_request_access_mail_email") return { data: startResult, error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}
const called = (name: string) => calls.filter((c) => c.name === name);

beforeEach(() => {
  sent.length = 0;
  calls = [];
  sendFails = false;
});

describe("drainAccessMails", () => {
  it("ouvre l'échange avec le code MASQUÉ, envoie le CLAIR à l'adresse de la file, puis règle", async () => {
    const counters = await drainAccessMails(fakeSupabase([ROW]), async () => SMTP, 25);
    expect(counters).toEqual({ claimed: 1, sent: 1, skipped: 0, failed: 0 });
    const [start] = called("start_request_access_mail_email");
    expect(String(start.params.p_body)).toContain(MASKED_ACCESS_CODE);
    expect(String(start.params.p_body)).not.toContain("WXYZ-WXYZ-WX");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("usager@example.org");
    expect(JSON.stringify(sent[0].content)).toContain("WXYZ-WXYZ-WX");
    expect(JSON.stringify(sent[0].content)).not.toContain(MASKED_ACCESS_CODE);
    expect(called("settle_request_access_mail")[0].params).toMatchObject({ p_mail_id: "m1", p_ok: true });
  });

  it("une reprise renvoie le texte ENREGISTRÉ, sans rouvrir d'échange", async () => {
    const row = { ...ROW, email_id: "e0", email_subject: "Objet enregistré", email_body: `Code : ${MASKED_ACCESS_CODE}` };
    await drainAccessMails(fakeSupabase([row]), async () => SMTP, 25);
    expect(called("start_request_access_mail_email")).toEqual([]);
    expect(JSON.stringify(sent[0].content)).toContain("Code : WXYZ-WXYZ-WX");
  });

  it("sans relais d'envoi, ou sans clair (adresse ou code effacés) : abandon, rien ne part", async () => {
    let counters = await drainAccessMails(fakeSupabase([ROW]), async () => null, 25);
    expect(counters.skipped).toBe(1);
    counters = await drainAccessMails(fakeSupabase([{ ...ROW, to_email: null }, { ...ROW, mail_id: "m2", access_code: null }]), async () => SMTP, 25);
    expect(counters.skipped).toBe(2);
    expect(sent).toEqual([]);
    expect(called("skip_request_access_mail").map((c) => c.params.p_mail_id)).toEqual(["m1", "m1", "m2"]);
  });

  it("échange non ouvert : rien ne part, la file réessaiera", async () => {
    const counters = await drainAccessMails(fakeSupabase([ROW], null), async () => SMTP, 25);
    expect(counters.failed).toBe(1);
    expect(sent).toEqual([]);
    expect(called("settle_request_access_mail")[0].params).toMatchObject({ p_ok: false, p_error: "échange non enregistré" });
  });

  it("relais en échec : règlement en échec avec le motif, jamais l'adresse ni le code dans les journaux", async () => {
    sendFails = true;
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.join(" ")));
    const counters = await drainAccessMails(fakeSupabase([ROW]), async () => SMTP, 25);
    spy.mockRestore();
    expect(counters.failed).toBe(1);
    expect(called("settle_request_access_mail")[0].params).toMatchObject({ p_ok: false, p_error: "relais muet" });
    expect(errors.join("\n")).not.toMatch(/usager@example\.org|WXYZ-WXYZ-WX/);
  });
});
