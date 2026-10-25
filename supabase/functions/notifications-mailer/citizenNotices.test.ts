import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { accessEmailHash } from "../_shared/access/accessCode.ts";
import { verifyUnsubscribeToken } from "../_shared/citizenNotices/unsubscribe.ts";

const sent: { to: string; content: { subject: string; paragraphs: string[]; cta?: { url: string }; footnote?: string }; headers: Record<string, string> }[] = [];
let sendFails = false;
let live: { email: string | null } | undefined = { email: "alice@example.org" };
vi.mock("../_shared/email/transport.ts", () => ({
  sendBrandedEmail: async (_smtp: unknown, to: string, content: never, _brand: unknown, _att: unknown, headers: Record<string, string>) => {
    if (sendFails) throw new Error("relais muet");
    sent.push({ to, content, headers });
  },
}));
vi.mock("../_shared/email/socleUsager.ts", () => ({
  charteFor: async () => null,
  socleContactIdentity: async () => live,
}));

const { drainCitizenNotices } = await import("./citizenNotices.ts");
type Row = Record<string, unknown>;

const PEPPER = "p".repeat(40);
const SECRET = "s".repeat(48);
const SECRETS = { pepper: PEPPER, tokenSecret: SECRET };
const SMTP = { host: "smtp.test" } as never;
const REQUEST = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";

async function guestRow(over: Row = {}): Promise<Row> {
  return {
    notice_id: "n1", notice_org_id: "o1", organization_name: "Ville de Sceaux", socle_root_org_id: "root",
    request_id: REQUEST, reference: "DEM-2026-000061", status: "en_attente", source: "portail-citoyen",
    citizen_visible: true, closed_at: null, procedure_name: "Signaler un problème", socle_procedure_id: null,
    socle_scope_org_id: null, socle_contact_id: CONTACT,
    requester_snapshot: { declared: { email: "Invite@Example.org", first_name: "Inès", last_name: "Vite" } },
    identity_status: "rapproche", known_status: "en_instruction", receipt_status: "sent", enabled: true,
    guest_email_hash: await accessEmailHash(PEPPER, "invite@example.org"),
    guest_tracking_url: "https://demarches.sceaux.fr/suivi", guest_revoked_at: null, guest_notify_email: true,
    link_space_active: null, link_channel_prefs: null, link_account_email_hash: null, link_space_url: null,
    link_request_url_template: null, email_id: null, email_to: null, attempts: 1,
    ...over,
  };
}

let calls: { name: string; params: Record<string, unknown> }[] = [];
let messages: Record<string, unknown>[] = [];
function fakeSupabase(rows: Row[]): SupabaseClient {
  return {
    from: () => ({ select: () => ({ in: async () => ({ data: messages, error: null }) }) }),
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "claim_citizen_notices") return { data: rows, error: null };
      if (name === "start_citizen_notice_email") return { data: "e1", error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}
const drain = (rows: Row[], smtp: unknown = SMTP, secrets = SECRETS) =>
  drainCitizenNotices(fakeSupabase(rows), async () => smtp as never, 25, secrets, () => new Date("2026-10-25T10:00:00Z"));
const call = (name: string) => calls.find((c) => c.name === name)?.params;

beforeEach(() => {
  sent.length = 0;
  calls = [];
  messages = [];
  sendFails = false;
  live = { email: "alice@example.org" };
});

describe("drainCitizenNotices", () => {
  it("invité en attente : avis à l'adresse déclarée, lien de suivi, désinscription vérifiable, statut connu avancé", async () => {
    const counters = await drain([await guestRow()]);
    expect(counters).toMatchObject({ claimed: 1, sent: 1 });
    expect(sent[0].to).toBe("invite@example.org");
    expect(sent[0].content.subject).toBe("Votre demande DEM-2026-000061 attend votre réponse");
    expect(sent[0].content.cta?.url).toBe("https://demarches.sceaux.fr/suivi");
    const unsubscribe = new URL(sent[0].headers["List-Unsubscribe"].slice(1, -1));
    expect(unsubscribe.origin + unsubscribe.pathname).toBe("https://demarches.sceaux.fr/notifications/desinscription");
    expect(sent[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(await verifyUnsubscribeToken(SECRET, unsubscribe.searchParams.get("jeton"))).toEqual({
      requestId: REQUEST, channel: "email", target: { kind: "invite" },
    });
    expect(call("start_citizen_notice_email")).toMatchObject({ p_id: "n1", p_to_email: "invite@example.org" });
    expect(call("settle_citizen_notice")).toMatchObject({ p_ok: true, p_event: "attente_information", p_target: "invite", p_known_status: "en_attente" });
  });

  it("ni l'objet saisi, ni le nom de l'usager ne sortent", async () => {
    await drain([await guestRow()]);
    const text = JSON.stringify(sent[0].content) + JSON.stringify(call("start_citizen_notice_email"));
    expect(text).not.toContain("Inès");
    expect(text).not.toContain("Vite");
  });

  it("compte : fiche du jour égale au compte ⇒ lien vers l'espace, cible compte", async () => {
    const row = await guestRow({
      link_space_active: true, link_channel_prefs: { email: true },
      link_account_email_hash: await accessEmailHash(PEPPER, "alice@example.org"),
      link_space_url: "https://demarches.sceaux.fr/mes-demandes",
    });
    await drain([row]);
    expect(sent[0]).toMatchObject({ to: "alice@example.org" });
    expect(sent[0].content.cta?.url).toBe("https://demarches.sceaux.fr/mes-demandes");
    expect(call("settle_citizen_notice")).toMatchObject({ p_target: "compte" });
  });

  it("interrupteur éteint, accusé en attente, événement non retenu, sans relais", async () => {
    await drain([await guestRow({ enabled: false })]);
    expect(call("skip_citizen_notice")).toMatchObject({ p_reason: "interrupteur" });

    calls = [];
    expect((await drain([await guestRow({ receipt_status: "pending" })])).deferred).toBe(1);
    expect(call("defer_citizen_notice")).toEqual({ p_id: "n1" });

    calls = [];
    await drain([await guestRow({ status: "a_traiter", known_status: "en_instruction" })]);
    expect(call("skip_citizen_notice")).toMatchObject({ p_reason: "evenement_non_retenu", p_event: "renvoi_qualification" });

    calls = [];
    await drain([await guestRow({ status: "en_instruction", known_status: "en_instruction" })]);
    expect(call("skip_citizen_notice")).toMatchObject({ p_reason: "aucun_changement" });

    calls = [];
    await drain([await guestRow()], null);
    expect(call("skip_citizen_notice")).toMatchObject({ p_reason: "pas_de_relais" });
    expect(sent).toEqual([]);
  });

  it("la résolution est couverte par l'avis de clôture", async () => {
    await drain([await guestRow({ status: "resolue_positive" })]);
    expect(call("skip_citizen_notice")).toMatchObject({ p_reason: "couvert_par_avis_cloture" });
  });

  it("préférence de l'invité coupée : non envoyé, raison écrite", async () => {
    await drain([await guestRow({ guest_notify_email: false })]);
    expect(call("skip_citizen_notice")).toMatchObject({ p_reason: "preference", p_event: "attente_information" });
    expect(sent).toEqual([]);
  });

  it("référentiel muet sur un compte : échec temporaire, pas de renoncement", async () => {
    live = undefined;
    const row = await guestRow({ link_space_active: true, link_account_email_hash: "0".repeat(64), link_space_url: "https://x.fr" });
    expect((await drain([row])).failed).toBe(1);
    expect(call("settle_citizen_notice")).toMatchObject({ p_ok: false, p_error: "référentiel injoignable" });
  });

  it("sans secret des jetons : aucun envoi sans désinscription", async () => {
    expect((await drain([await guestRow()], SMTP, { pepper: PEPPER, tokenSecret: undefined })).failed).toBe(1);
    expect(sent).toEqual([]);
  });

  it("relais en panne : échec réglé avec temporisation ; une reprise réutilise l'échange tracé", async () => {
    sendFails = true;
    await drain([await guestRow()]);
    expect(call("settle_citizen_notice")).toMatchObject({ p_ok: false, p_error: "relais muet" });

    sendFails = false;
    calls = [];
    await drain([await guestRow({ email_id: "e1", email_to: "invite@example.org" })]);
    expect(call("start_citizen_notice_email")).toBeUndefined();
    expect(sent[0].to).toBe("invite@example.org");
  });
});

describe("M2 : avis d'un message publié dans l'espace", () => {
  const MESSAGE = {
    id: "m1", to_email: "invite@example.org", sent_at: "2026-10-25T09:55:00Z",
    body: "Bonjour Madame,\n\nPouvez-vous nous transmettre un justificatif de domicile de moins de trois mois afin que nous puissions poursuivre l'instruction de votre demande ?",
  };

  it("message seul : extrait, lien, à l'adresse figée ; le statut connu ne bouge pas", async () => {
    messages = [MESSAGE];
    await drain([await guestRow({ status: "en_instruction", known_status: "en_instruction", message_email_ids: ["m1"] })]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("invite@example.org");
    expect(sent[0].content.subject).toBe("Nouveau message concernant votre demande DEM-2026-000061");
    const text = sent[0].content.paragraphs.join("\n");
    expect(text).toContain("« Pouvez-vous nous transmettre");
    expect(text).not.toContain("Bonjour Madame");
    expect(text).not.toContain("poursuivre l'instruction de votre demande ?");
    expect(call("settle_citizen_notice")).toMatchObject({ p_ok: true, p_event: "nouveau_message", p_known_status: null });
  });

  it("message et statut dans la même fenêtre : UN courriel qui annonce les deux", async () => {
    messages = [MESSAGE];
    await drain([await guestRow({ message_email_ids: ["m1"] })]);
    expect(sent).toHaveLength(1);
    expect(sent[0].content.paragraphs.join("\n")).toContain("a aussi changé de statut : En attente de votre réponse");
    expect(call("settle_citizen_notice")).toMatchObject({ p_event: "attente_information", p_known_status: "en_attente" });
  });

  it("non désactivable : préférence coupée ou interrupteur éteint depuis, l'avis du message part quand même", async () => {
    messages = [MESSAGE];
    await drain([await guestRow({ guest_notify_email: false, enabled: false, message_email_ids: ["m1"] })]);
    expect(sent).toHaveLength(1);
    expect(sent[0].content.paragraphs.join("\n")).not.toContain("changé de statut");
  });

  it("accès coupé dans la fenêtre : le dernier lien connu sert (risque accepté)", async () => {
    messages = [MESSAGE];
    await drain([await guestRow({ guest_revoked_at: "2026-10-25T09:58:00Z", status: "en_instruction", known_status: "en_instruction", message_email_ids: ["m1"] })]);
    expect(sent[0].content.cta?.url).toBe("https://demarches.sceaux.fr/suivi");
  });
});
