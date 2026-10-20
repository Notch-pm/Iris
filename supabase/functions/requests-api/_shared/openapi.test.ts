import { describe, expect, it } from "vitest";
import { buildOpenApi, CONTRACT_VERSION, publicBaseUrl } from "./openapi";
import { validateEnvelope } from "./validation";

describe("contrat OpenAPI 2.x", () => {
  const spec = buildOpenApi("https://exemple.supabase.co/functions/v1/requests-api");

  it("porte la version du contrat (2.x : le mode URL signée est retiré, les routes restent /v1)", () => {
    expect(CONTRACT_VERSION).toMatch(/^2\.\d+\.\d+$/);
    expect(spec.info.version).toBe(CONTRACT_VERSION);
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.description).toContain("2.0.0");
    expect(spec.info.description).not.toContain("État de livraison");
    expect(spec.info.description).not.toContain("worker de copie");
  });

  it("expose les routes du contrat", () => {
    const paths = Object.keys(spec.paths);
    expect(paths).toContain("/v1/uploads");
    expect(paths).toContain("/v1/requests");
    expect(paths).toContain("/v1/requests/{id}");
    expect(paths).toContain("/v1/requests/{id}/attachments");
    expect(paths).toContain("/v1/openapi.json");
  });

  it("le dépôt de fichier est multipart, documenté avec ses refus", () => {
    const upload = spec.paths["/v1/uploads"].post;
    expect(Object.keys(upload.requestBody.content)).toEqual(["multipart/form-data"]);
    for (const status of ["201", "413", "415", "422", "429"]) {
      expect(upload.responses).toHaveProperty(status);
    }
    expect(spec.components.schemas.Error.properties.error.properties.code.enum)
      .toEqual(expect.arrayContaining(["payload_too_large", "unsupported_media_type", "too_many_requests"]));
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
    expect(spec.components.schemas.AttachmentRef.required).toEqual(["upload_id"]);
    expect(Object.keys(spec.components.schemas.AttachmentRef.properties)).not.toContain("fetch_url");
  });

  it("démarche obligatoire, form_field_key sur les pièces", () => {
    expect(spec.components.schemas.IngestEnvelope.required).toContain("socle_procedure_id");
    expect(Object.keys(spec.components.schemas.AttachmentRef.properties)).toContain("form_field_key");
  });

  it("est présentable en page de documentation (groupes, contact, exemples)", () => {
    expect(spec.tags.map((t) => t.name)).toEqual(["Demandes", "Pièces jointes", "Usager", "Contrat"]);
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

describe("contrat 2.6.0 — accès invité de l'usager", () => {
  const spec = buildOpenApi("https://iris.example/functions/v1/requests-api");

  it("publie les routes usager sous le tag Usager", () => {
    for (const path of ["/v1/citizen/access", "/v1/citizen/requests/{id}", "/v1/citizen/requests/{id}/attachments/{attachment_id}"]) {
      const route = (spec.paths as Record<string, Record<string, { tags: string[] }>>)[path];
      expect(route, path).toBeDefined();
      expect(Object.values(route)[0].tags).toEqual(["Usager"]);
    }
  });

  it("la vue usager ne porte ni motif de clôture ni agents", () => {
    const fields = Object.keys(spec.components.schemas.CitizenRequest.properties);
    expect(fields).not.toContain("closure_motif");
    expect(fields).not.toContain("assigned_to");
    expect(fields).not.toContain("url");
  });

  it("l'enveloppe accepte guest_access", () => {
    expect(Object.keys(spec.components.schemas.IngestEnvelope.properties)).toContain("guest_access");
  });
});

describe("contrat 2.7.0 — « Mes demandes » et jeton court", () => {
  const spec = buildOpenApi("https://iris.example/functions/v1/requests-api");
  it("publie la liste d'une fiche et le jeton sur les lectures usager", () => {
    const paths = spec.paths as Record<string, Record<string, { parameters?: { $ref?: string }[] }>>;
    expect(paths["/v1/citizen/contacts/{id}/requests"]).toBeDefined();
    for (const path of ["/v1/citizen/contacts/{id}/requests", "/v1/citizen/requests/{id}", "/v1/citizen/requests/{id}/attachments/{attachment_id}"]) {
      expect(paths[path].get.parameters?.some((p) => p.$ref === "#/components/parameters/CitizenToken"), path).toBe(true);
    }
    expect(Object.keys(spec.components.schemas.CitizenRequestSummary.properties)).not.toContain("closure_text");
  });
});
