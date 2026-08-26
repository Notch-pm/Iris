import { describe, expect, it } from "vitest";
import { buildOpenApi, CONTRACT_VERSION, publicBaseUrl } from "./openapi";
import { validateEnvelope } from "./validation";

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

  it("v1.1 : démarche obligatoire, form_field_key sur les pièces", () => {
    expect(spec.components.schemas.IngestEnvelope.required).toContain("socle_procedure_id");
    expect(Object.keys(spec.components.schemas.AttachmentRef.properties)).toContain("form_field_key");
  });

  it("est présentable en page de documentation (groupes, contact, exemples)", () => {
    expect(spec.tags.map((t) => t.name)).toEqual(["Demandes", "Pièces jointes", "Contrat"]);
    expect(spec.paths["/v1/requests"].post.tags).toContain("Demandes");
    expect(spec.paths["/v1/requests/{id}/attachments"].post.tags).toContain("Pièces jointes");
    expect(spec.info.description).toContain("## Authentification et périmètre");
  });

  it("les exemples documentés sont réellement acceptés par la validation", () => {
    const examples = spec.paths["/v1/requests"].post.requestBody.content["application/json"].examples;
    expect(Object.keys(examples)).toEqual(["courrier", "portail_declare", "anonyme"]);
    for (const [name, example] of Object.entries(examples)) {
      const result = validateEnvelope(example.value);
      expect(result.ok, `${name} : ${result.ok ? "" : result.message}`).toBe(true);
    }
  });
});

describe("URL publique du contrat", () => {
  const seen = new URL("http://tqcoqlneybtbrrcvpkpk.supabase.co/requests-api/v1/openapi.json");

  it("suit les en-têtes de la passerelle plutôt que l'origine vue en interne", () => {
    expect(publicBaseUrl("https", "tqcoqlneybtbrrcvpkpk.supabase.co", seen)).toBe(
      "https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/requests-api",
    );
  });

  it("ne retient que la première valeur d'un en-tête chaîné", () => {
    expect(publicBaseUrl("https, http", "public.exemple.fr, interne", seen)).toBe(
      "https://public.exemple.fr/functions/v1/requests-api",
    );
  });

  it("retombe sur l'URL vue si la passerelle ne transmet rien", () => {
    expect(publicBaseUrl(null, null, seen)).toBe(
      "http://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/requests-api",
    );
  });
});
