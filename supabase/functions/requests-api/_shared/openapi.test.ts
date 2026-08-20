import { describe, expect, it } from "vitest";
import { buildOpenApi, CONTRACT_VERSION } from "./openapi";

describe("contrat OpenAPI v1", () => {
  const spec = buildOpenApi("https://exemple.supabase.co/functions/v1/requests-api");

  it("porte la version du contrat (politique additive en v1)", () => {
    expect(CONTRACT_VERSION).toMatch(/^1\.\d+\.\d+$/);
    expect(spec.info.version).toBe(CONTRACT_VERSION);
    expect(spec.openapi).toBe("3.1.0");
  });

  it("expose les routes du contrat", () => {
    const paths = Object.keys(spec.paths);
    expect(paths).toContain("/v1/requests");
    expect(paths).toContain("/v1/requests/{id}");
    expect(paths).toContain("/v1/requests/{id}/attachments");
    expect(paths).toContain("/v1/openapi.json");
  });

  it("documente l'idempotence et le conflit sur le POST", () => {
    const post = spec.paths["/v1/requests"].post;
    expect(post.responses).toHaveProperty("200");
    expect(post.responses).toHaveProperty("201");
    expect(post.responses).toHaveProperty("409");
  });

  it("interdit les propriétés inconnues dans l'enveloppe et les pièces", () => {
    expect(spec.components.schemas.IngestEnvelope.additionalProperties).toBe(false);
    expect(spec.components.schemas.AttachmentRef.additionalProperties).toBe(false);
    expect(spec.components.schemas.AttachmentRef.required).toContain("fetch_url");
  });
});
