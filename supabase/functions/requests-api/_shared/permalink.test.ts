import { describe, expect, it } from "vitest";
import {
  isPublicPermalink,
  keepPublicPermalink,
  PERMALINK_ANOMALY,
  sanitizePermalinks,
} from "./permalink";
import type { IngestEnvelope } from "./validation";

const BASE: IngestEnvelope = {
  source_system: "clara",
  external_id: "c1df2fe6-3e40-4e2f-9c44-50a984f42fe6",
  socle_root_organization_id: "d5227d25-f327-493a-a9a2-278397531e33",
  socle_procedure_id: "216fe968-f077-47b4-bd3e-8f856749ea13",
  subject: "Nid-de-poule rue des Lilas",
};

describe("isPublicPermalink", () => {
  it("accepte un permalien de partenaire ordinaire", () => {
    expect(isPublicPermalink("https://clara.edilumen.fr/courrier/abc")).toBe(true);
    expect(isPublicPermalink("http://clara.exemple.fr/courriers/2026-00412?tab=actions")).toBe(true);
    expect(isPublicPermalink("https://clara.notch.pm/courrier/a6965594")).toBe(true);
  });

  it("accepte une IP publique et un port explicite", () => {
    expect(isPublicPermalink("https://clara.edilumen.fr:8443/courrier/abc")).toBe(true);
    expect(isPublicPermalink("http://93.184.216.34/courrier/abc")).toBe(true);
  });

  it("écarte la boucle locale — le cas vécu du 2026-09-10", () => {
    expect(isPublicPermalink("http://localhost:8080/courrier/6695a993")).toBe(false);
    expect(isPublicPermalink("http://LOCALHOST/courrier/abc")).toBe(false);
    expect(isPublicPermalink("http://127.0.0.1:5173/courrier/abc")).toBe(false);
    expect(isPublicPermalink("http://127.1.2.3/x")).toBe(false);
    expect(isPublicPermalink("http://[::1]:8080/courrier/abc")).toBe(false);
  });

  it("écarte les plages privées et lien-local", () => {
    expect(isPublicPermalink("http://10.0.0.5/courrier/abc")).toBe(false);
    expect(isPublicPermalink("http://172.16.0.1/x")).toBe(false);
    expect(isPublicPermalink("http://172.31.255.254/x")).toBe(false);
    expect(isPublicPermalink("http://192.168.1.20/x")).toBe(false);
    expect(isPublicPermalink("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPublicPermalink("http://0.0.0.0/x")).toBe(false);
    expect(isPublicPermalink("http://[fd12:3456::1]/x")).toBe(false);
    expect(isPublicPermalink("http://[fe80::1]/x")).toBe(false);
  });

  it("laisse passer les IPv4 publiques voisines des plages privées", () => {
    expect(isPublicPermalink("http://172.15.0.1/x")).toBe(true);
    expect(isPublicPermalink("http://172.32.0.1/x")).toBe(true);
    expect(isPublicPermalink("http://192.169.0.1/x")).toBe(true);
    expect(isPublicPermalink("http://11.0.0.1/x")).toBe(true);
  });

  it("écarte les TLD réservés et l'hôte nu", () => {
    expect(isPublicPermalink("http://clara.local/courrier/abc")).toBe(false);
    expect(isPublicPermalink("http://clara.internal/x")).toBe(false);
    expect(isPublicPermalink("http://serveur.home.arpa/x")).toBe(false);
    expect(isPublicPermalink("http://app.localhost:3000/x")).toBe(false);
    expect(isPublicPermalink("http://clara/courrier/abc")).toBe(false);
  });

  it("écarte ce qui n'est pas une URL http(s)", () => {
    expect(isPublicPermalink("javascript:alert(1)")).toBe(false);
    expect(isPublicPermalink("file:///C:/courrier.pdf")).toBe(false);
    expect(isPublicPermalink("ftp://clara.edilumen.fr/x")).toBe(false);
    expect(isPublicPermalink("clara.edilumen.fr/courrier/abc")).toBe(false);
    expect(isPublicPermalink("")).toBe(false);
  });

  it("ignore un point final de nom pleinement qualifié", () => {
    expect(isPublicPermalink("https://clara.edilumen.fr./courrier/abc")).toBe(true);
    expect(isPublicPermalink("http://localhost./x")).toBe(false);
  });
});

describe("keepPublicPermalink", () => {
  it("rend l'URL inchangée quand elle est publique — jamais réécrite", () => {
    const url = "https://clara.edilumen.fr/courrier/abc?tab=actions";
    expect(keepPublicPermalink(url)).toBe(url);
  });

  it("rend null pour un permalien local, vide ou absent", () => {
    expect(keepPublicPermalink("http://localhost:8080/courrier/abc")).toBeNull();
    expect(keepPublicPermalink("")).toBeNull();
    expect(keepPublicPermalink(null)).toBeNull();
    expect(keepPublicPermalink(undefined)).toBeNull();
  });
});

describe("sanitizePermalinks", () => {
  it("laisse passer une enveloppe saine sans rien signaler", () => {
    const r = sanitizePermalinks({
      ...BASE,
      context: { external_url: "https://clara.edilumen.fr/courrier/abc" },
      links: [{ type: "courrier", id: "abc", url: "https://clara.edilumen.fr/courrier/abc", label: "Courrier d'origine" }],
    });
    expect(r.externalUrl).toBe("https://clara.edilumen.fr/courrier/abc");
    expect(r.links[0].url).toBe("https://clara.edilumen.fr/courrier/abc");
    expect(r.dropped).toBe(false);
  });

  it("écarte le permalien d'origine local et le signale", () => {
    const r = sanitizePermalinks({
      ...BASE,
      context: { channel: "courrier", external_url: "http://localhost:8080/courrier/6695a993" },
    });
    expect(r.externalUrl).toBeNull();
    expect(r.dropped).toBe(true);
  });

  it("écarte l'URL d'un lien mais garde le lien lui-même", () => {
    const r = sanitizePermalinks({
      ...BASE,
      links: [{ type: "courrier", id: "6695a993", url: "http://localhost:8080/courrier/6695a993", label: "Courrier" }],
    });
    expect(r.links).toEqual([{ type: "courrier", id: "6695a993", label: "Courrier" }]);
    expect(r.dropped).toBe(true);
  });

  it("ne signale rien quand aucun permalien n'est transmis", () => {
    expect(sanitizePermalinks(BASE)).toEqual({ externalUrl: null, links: [], dropped: false });
    expect(sanitizePermalinks({ ...BASE, links: [{ type: "courrier", id: "abc" }] }).dropped).toBe(false);
  });

  it("ne touche à rien d'autre dans l'enveloppe", () => {
    const env: IngestEnvelope = {
      ...BASE,
      context: { channel: "courrier", received_at: "2026-09-10T13:09:20Z", external_url: "http://localhost:8080/x" },
    };
    const copie = structuredClone(env);
    sanitizePermalinks(env);
    expect(env).toEqual(copie);
  });
});

describe("PERMALINK_ANOMALY", () => {
  it("porte le code attendu par la fiche de demande", () => {
    expect(PERMALINK_ANOMALY).toBe("permalien_non_public");
  });
});
