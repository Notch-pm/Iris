import { describe, expect, it } from "vitest";
import { isFetchableUrl, isPublicAddress } from "./urlGuard";

describe("isFetchableUrl", () => {
  it("accepte une page publique en https", () => {
    expect(isFetchableUrl("https://www.service-public.fr/particuliers/vosdroits/F1234")).toBe(true);
    expect(isFetchableUrl("https://www.arles.fr:443/demarches")).toBe(true);
  });

  it("refuse tout ce qui n'est pas https", () => {
    expect(isFetchableUrl("http://www.arles.fr")).toBe(false);
    expect(isFetchableUrl("ftp://www.arles.fr")).toBe(false);
    expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableUrl("javascript:alert(1)")).toBe(false);
  });

  it("refuse les adresses IP littérales, y compris leurs graphies détournées", () => {
    expect(isFetchableUrl("https://127.0.0.1/")).toBe(false);
    expect(isFetchableUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isFetchableUrl("https://2130706433/")).toBe(false);
    expect(isFetchableUrl("https://0x7f.0.0.1/")).toBe(false);
    expect(isFetchableUrl("https://[::1]/")).toBe(false);
  });

  it("refuse les noms du réseau local", () => {
    expect(isFetchableUrl("https://localhost/")).toBe(false);
    expect(isFetchableUrl("https://intranet/")).toBe(false);
    expect(isFetchableUrl("https://serveur.local/")).toBe(false);
    expect(isFetchableUrl("https://db.internal/")).toBe(false);
    expect(isFetchableUrl("https://api.localhost/")).toBe(false);
  });

  it("refuse les identifiants dans l'adresse et les ports exotiques", () => {
    expect(isFetchableUrl("https://user:pass@www.arles.fr/")).toBe(false);
    expect(isFetchableUrl("https://www.arles.fr:8443/")).toBe(false);
  });

  it("refuse l'illisible", () => {
    expect(isFetchableUrl("")).toBe(false);
    expect(isFetchableUrl("pas une adresse")).toBe(false);
  });
});

describe("isPublicAddress", () => {
  it("reconnaît une adresse publique", () => {
    expect(isPublicAddress("185.24.184.10")).toBe(true);
    expect(isPublicAddress("2a01:e0a:1::1")).toBe(true);
  });

  it("refuse la machine, le réseau privé, le lien local et les métadonnées", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("n'accepte pas une chaîne illisible", () => {
    expect(isPublicAddress("999.1.1.1")).toBe(false);
    expect(isPublicAddress("nom.fr")).toBe(false);
  });
});

describe("isPublicAddress — plages de documentation et de traduction", () => {
  it("refuse les réseaux de documentation, NAT64, 6to4 et le site local", () => {
    for (const ip of [
      "192.0.2.10", "198.51.100.7", "203.0.113.9",
      "64:ff9b::10.0.0.1", "64:ff9b::a00:1", "2002:a00:1::1", "fec0::1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});
