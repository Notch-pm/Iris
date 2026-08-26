import { describe, expect, it } from "vitest";

import { DEFAULT_SMTP_PORT, smtpMirrorArgs, smtpWarning, type SocleSmtpDto } from "./smtp.ts";
import type { TenantRef } from "./mapping.ts";

const TENANT: TenantRef = {
  organizationId: "11111111-1111-1111-1111-111111111111",
  socleOrgId: "22222222-2222-2222-2222-222222222222",
};

const DTO: SocleSmtpDto = {
  organization_id: TENANT.socleOrgId,
  configured: true,
  host: " smtp.accm.fr ",
  port: 465,
  username: " notifications@accm.fr ",
  password: "  mot de passe  ",
  from_email: " Ne-Pas-Repondre@ACCM.fr ",
  from_name: " ACCM ",
  use_tls: true,
  updated_at: "2026-08-20T10:00:00Z",
};

describe("smtpMirrorArgs — recopie de la déclaration du Socle", () => {
  it("transpose la configuration en arguments de la RPC de service", () => {
    expect(smtpMirrorArgs(TENANT, DTO)).toEqual({
      p_org_id: TENANT.organizationId,
      p_socle_org_id: TENANT.socleOrgId,
      p_host: "smtp.accm.fr",
      p_port: 465,
      p_username: "notifications@accm.fr",
      p_password: "  mot de passe  ",
      p_from_email: "ne-pas-repondre@accm.fr",
      p_from_name: "ACCM",
      p_use_tls: true,
      p_socle_updated_at: "2026-08-20T10:00:00Z",
    });
  });

  it("ne touche pas au mot de passe : une espace peut en faire partie", () => {
    expect(smtpMirrorArgs(TENANT, DTO)?.p_password).toBe("  mot de passe  ");
    expect(smtpMirrorArgs(TENANT, { ...DTO, password: "" })?.p_password).toBeNull();
    expect(smtpMirrorArgs(TENANT, { ...DTO, password: null })?.p_password).toBeNull();
  });

  it("aucun relais déclaré ⇒ null (le miroir sera effacé)", () => {
    expect(smtpMirrorArgs(TENANT, null)).toBeNull();
    expect(smtpMirrorArgs(TENANT, undefined)).toBeNull();
    expect(smtpMirrorArgs(TENANT, { configured: false })).toBeNull();
    // `configured` absent : on ne devine pas, on refuse.
    expect(smtpMirrorArgs(TENANT, { host: "smtp.accm.fr", from_email: "a@b.fr" })).toBeNull();
  });

  it("déclaration incohérente ⇒ null plutôt qu'un relais bancal", () => {
    expect(smtpMirrorArgs(TENANT, { ...DTO, host: "   " })).toBeNull();
    expect(smtpMirrorArgs(TENANT, { ...DTO, host: null })).toBeNull();
    expect(smtpMirrorArgs(TENANT, { ...DTO, from_email: "pas-une-adresse" })).toBeNull();
    expect(smtpMirrorArgs(TENANT, { ...DTO, from_email: "" })).toBeNull();
  });

  it("valeurs par défaut prudentes : port 587, TLS actif sauf refus explicite", () => {
    expect(smtpMirrorArgs(TENANT, { ...DTO, port: null })?.p_port).toBe(DEFAULT_SMTP_PORT);
    expect(smtpMirrorArgs(TENANT, { ...DTO, port: 0 })?.p_port).toBe(DEFAULT_SMTP_PORT);
    expect(smtpMirrorArgs(TENANT, { ...DTO, port: 70000 })?.p_port).toBe(DEFAULT_SMTP_PORT);
    expect(smtpMirrorArgs(TENANT, { ...DTO, use_tls: null })?.p_use_tls).toBe(true);
    expect(smtpMirrorArgs(TENANT, { ...DTO, use_tls: false })?.p_use_tls).toBe(false);
  });

  it("champs facultatifs vides ⇒ null (relais sans authentification, sans nom)", () => {
    const args = smtpMirrorArgs(TENANT, { ...DTO, username: "  ", from_name: "", updated_at: null });
    expect(args?.p_username).toBeNull();
    expect(args?.p_from_name).toBeNull();
    expect(args?.p_socle_updated_at).toBeNull();
  });
});

describe("smtpWarning — un avertissement qui dit quoi faire", () => {
  it("403 : le scope « smtp » manque à la clé Socle", () => {
    expect(smtpWarning(TENANT, 403)).toContain("scope « smtp »");
  });

  it("404 : hors périmètre, ou API Socle antérieure à la route", () => {
    expect(smtpWarning(TENANT, 404)).toContain("hors périmètre");
  });

  it("autre statut : reste explicite, et le miroir n'est pas touché", () => {
    expect(smtpWarning(TENANT, 500)).toContain("réponse 500");
    expect(smtpWarning(TENANT, 500)).toContain("miroir inchangé");
  });

  it("ne divulgue jamais l'identifiant Socle du tenant dans le journal", () => {
    expect(smtpWarning(TENANT, 403)).not.toContain(TENANT.socleOrgId);
  });
});
