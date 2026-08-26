import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMTP_PORT,
  resolveSmtp,
  senderHeader,
  smtpFromEnv,
  smtpFromRow,
  useImplicitTls,
  type SmtpRow,
} from "./config";

const row: SmtpRow = {
  organization_id: "org-1",
  organization_name: "Ville de Test",
  host: "smtp.ville-test.fr",
  port: 587,
  username: "iris@ville-test.fr",
  password: "secret",
  from_email: "Ne-Pas-Repondre@Ville-Test.FR",
  from_name: "Ville de Test",
  use_tls: true,
};

const env = {
  IRIS_SMTP_HOST: "relais.notch.fr",
  IRIS_SMTP_PORT: "465",
  IRIS_SMTP_USERNAME: "iris",
  IRIS_SMTP_PASSWORD: "secret-plateforme",
  IRIS_SMTP_FROM_EMAIL: "iris@notch.fr",
  IRIS_SMTP_FROM_NAME: "Iris",
};

describe("smtpFromRow", () => {
  it("normalise l'adresse d'expédition en minuscules", () => {
    expect(smtpFromRow(row)?.fromEmail).toBe("ne-pas-repondre@ville-test.fr");
  });

  it("se marque comme configuration de tenant", () => {
    expect(smtpFromRow(row)?.source).toBe("tenant");
  });

  it("rend null si l'hôte ou l'expéditeur manque", () => {
    expect(smtpFromRow({ ...row, host: "   " })).toBeNull();
    expect(smtpFromRow({ ...row, from_email: null })).toBeNull();
    expect(smtpFromRow(null)).toBeNull();
    expect(smtpFromRow(undefined)).toBeNull();
  });

  it("vide l'identifiant et le mot de passe absents plutôt que de les laisser vides", () => {
    const c = smtpFromRow({ ...row, username: "  ", password: null });
    expect(c?.username).toBeNull();
    expect(c?.password).toBeNull();
  });

  it("retombe sur le port 587 si le port est absurde", () => {
    expect(smtpFromRow({ ...row, port: 0 })?.port).toBe(DEFAULT_SMTP_PORT);
    expect(smtpFromRow({ ...row, port: null })?.port).toBe(DEFAULT_SMTP_PORT);
    expect(smtpFromRow({ ...row, port: 99999 })?.port).toBe(DEFAULT_SMTP_PORT);
  });

  it("chiffre par défaut : use_tls absent ne dégrade pas vers du clair", () => {
    expect(smtpFromRow({ ...row, use_tls: null })?.useTls).toBe(true);
    expect(smtpFromRow({ ...row, use_tls: false })?.useTls).toBe(false);
  });
});

describe("smtpFromEnv", () => {
  it("lit les secrets d'edge function et se marque plateforme", () => {
    const c = smtpFromEnv(env);
    expect(c).toMatchObject({ host: "relais.notch.fr", port: 465, source: "plateforme" });
  });

  it("rend null si le relais n'est pas configuré", () => {
    expect(smtpFromEnv({})).toBeNull();
    expect(smtpFromEnv({ IRIS_SMTP_HOST: "relais.notch.fr" })).toBeNull();
  });

  it("accepte un IRIS_SMTP_USE_TLS textuel", () => {
    expect(smtpFromEnv({ ...env, IRIS_SMTP_USE_TLS: "false" })?.useTls).toBe(false);
    expect(smtpFromEnv({ ...env, IRIS_SMTP_USE_TLS: "true" })?.useTls).toBe(true);
  });
});

describe("resolveSmtp", () => {
  it("le tenant l'emporte sur le relais de plateforme", () => {
    expect(resolveSmtp(row, env)?.host).toBe("smtp.ville-test.fr");
  });

  it("retombe sur la plateforme quand le tenant n'a rien configuré", () => {
    expect(resolveSmtp(null, env)?.source).toBe("plateforme");
    expect(resolveSmtp({ organization_name: "Ville de Test" }, env)?.source).toBe("plateforme");
  });

  it("rend null quand rien n'est configuré nulle part", () => {
    expect(resolveSmtp(null, {})).toBeNull();
  });
});

describe("senderHeader", () => {
  it("compose nom et adresse", () => {
    expect(senderHeader(smtpFromRow(row)!)).toBe('"Ville de Test" <ne-pas-repondre@ville-test.fr>');
  });

  it("se réduit à l'adresse sans nom", () => {
    expect(senderHeader(smtpFromRow({ ...row, from_name: null })!)).toBe("ne-pas-repondre@ville-test.fr");
  });

  it("ne laisse pas un guillemet casser l'en-tête", () => {
    const header = senderHeader(smtpFromRow({ ...row, from_name: 'Ville "de" Test' })!);
    expect(header).toBe(`"Ville 'de' Test" <ne-pas-repondre@ville-test.fr>`);
  });
});

describe("useImplicitTls", () => {
  it("n'est vrai que sur le port 465 — sur 587 c'est STARTTLS", () => {
    expect(useImplicitTls(smtpFromRow({ ...row, port: 465 })!)).toBe(true);
    expect(useImplicitTls(smtpFromRow({ ...row, port: 587 })!)).toBe(false);
    expect(useImplicitTls(smtpFromRow({ ...row, port: 465, use_tls: false })!)).toBe(false);
  });
});
