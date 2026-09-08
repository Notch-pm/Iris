import { describe, expect, it } from "vitest";
import {
  belongsToRequest,
  finalPath,
  isStagingPath,
  requestPrefix,
  slugifyFileName,
  stagingPath,
} from "./names";

const ORG = "11111111-1111-1111-1111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const UP = "33333333-3333-4333-8333-333333333333";

describe("slugifyFileName", () => {
  it("neutralise accents, espaces et traversées de chemin", () => {
    expect(slugifyFileName("Pièce jointe n°1.pdf")).toBe("Piece-jointe-n-1.pdf");
    expect(slugifyFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(slugifyFileName("///")).toBe("fichier");
    expect(slugifyFileName("a".repeat(200) + ".pdf")).toHaveLength(100);
  });
});

describe("chemins du bucket", () => {
  it("la zone d'attente n'est jamais sous un UUID de demande", () => {
    const p = stagingPath(ORG, UP);
    expect(p).toBe(`${ORG}/_staging/${UP}`);
    expect(isStagingPath(p)).toBe(true);
    expect(isStagingPath(`${ORG}/${REQ}/${UP}-x.pdf`)).toBe(false);
    expect(isStagingPath(`${ORG}/_staging`)).toBe(false);
  });

  it("le chemin définitif est préfixé par la demande et porte l'identifiant de téléversement", () => {
    const p = finalPath(ORG, REQ, UP, "Relevé d'identité.pdf");
    expect(p).toBe(`${ORG}/${REQ}/${UP}-Releve-d-identite.pdf`);
    expect(p.startsWith(requestPrefix(ORG, REQ))).toBe(true);
    expect(belongsToRequest(p, ORG, REQ)).toBe(true);
    expect(belongsToRequest(p, ORG, UP)).toBe(false);
    expect(belongsToRequest(stagingPath(ORG, UP), ORG, REQ)).toBe(false);
  });
});
