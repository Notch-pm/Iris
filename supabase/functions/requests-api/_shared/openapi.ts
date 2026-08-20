// Contrat public de l'API d'ingestion — l'OpenAPI est LA documentation de
// référence des endpoints (règle de gamme). Politique v1 : évolutions
// additives uniquement ; toute rupture passera par une v2.

export const CONTRACT_VERSION = "1.0.0";
export const API_BASE_PATH = "/v1";

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: {
          type: "string",
          enum: ["bad_request", "unauthorized", "forbidden", "not_found",
                 "method_not_allowed", "conflict", "internal_error"],
        },
        message: { type: "string", description: "Message en français." },
      },
    },
  },
} as const;

const attachmentRefSchema = {
  type: "object",
  required: ["file_name", "fetch_url"],
  additionalProperties: false,
  properties: {
    file_name: { type: "string", maxLength: 255 },
    fetch_url: {
      type: "string",
      description:
        "URL https SIGNÉE et temporaire d'où Iris copiera le fichier (worker asynchrone). " +
        "Jamais de contenu inline dans la requête.",
    },
    mime_type: { type: "string" },
    size_bytes: { type: "integer", minimum: 0 },
    checksum: { type: "string", description: "Empreinte du fichier (déduplication de copie)." },
  },
} as const;

const linkRefSchema = {
  type: "object",
  required: ["type", "id"],
  additionalProperties: false,
  properties: {
    type: { type: "string", description: "Type de ressource source (ex. courrier, ticket, dossier)." },
    id: { type: "string" },
    url: { type: "string" },
    label: { type: "string" },
  },
} as const;

const envelopeSchema = {
  type: "object",
  required: ["source_system", "external_id", "socle_root_organization_id", "subject"],
  additionalProperties: false,
  properties: {
    source_system: {
      type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$",
      description: "Code de la source ENREGISTRÉE — doit correspondre à l'intégration authentifiée.",
    },
    external_id: {
      type: "string", maxLength: 200,
      description: "Identifiant de la demande côté source. Unicité par (source_system, external_id).",
    },
    idempotency_key: {
      type: "string", maxLength: 200,
      description:
        "Clé d'idempotence de la soumission. Rejeu au contenu identique → 200 avec la demande " +
        "existante ; contenu divergent → 409.",
    },
    socle_root_organization_id: {
      type: "string", format: "uuid",
      description: "UUID Socle de l'organisation RACINE. Vérifié égal au périmètre de l'intégration — jamais pris pour argent comptant.",
    },
    socle_organization_id: { type: "string", format: "uuid", description: "Organisation destinataire éventuelle (UUID Socle du sous-arbre)." },
    socle_procedure_id: { type: "string", format: "uuid", description: "Démarche Socle éventuelle." },
    socle_contact_id: { type: "string", format: "uuid", description: "Contact Socle éventuel (usager rapproché)." },
    subject: { type: "string", maxLength: 500 },
    body: { type: "string" },
    requester: {
      type: "object",
      description:
        "Identité DÉCLARÉE du demandeur, conservée intégralement (pièce du dossier). " +
        "{ \"anonymous\": true } pour un dépôt anonyme assumé. Requis si socle_contact_id est absent.",
    },
    form_data: {
      type: "object",
      description: "Réponses au formulaire de la démarche (clé machine = key). Jamais validé à l'ingestion.",
    },
    attachments: { type: "array", maxItems: 50, items: attachmentRefSchema },
    context: {
      type: "object",
      additionalProperties: false,
      properties: {
        channel: { type: "string", description: "courrier, email, portail, guichet, telephone…" },
        received_at: { type: "string", format: "date-time", description: "Date de réception D'ORIGINE (≠ date d'ingestion)." },
        external_url: { type: "string", description: "Permalien vers la ressource d'origine." },
        metadata: { type: "object" },
      },
    },
    links: { type: "array", maxItems: 20, items: linkRefSchema },
  },
} as const;

const requestResourceSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    reference: { type: "string", example: "DEM-2026-000123" },
    status: {
      type: "string",
      enum: ["a_traiter", "en_instruction", "en_attente", "annulee",
             "resolue_positive", "resolue_negative", "archivee"],
      description: "Statuts FIXES — seules clés stables avec closure_motif. Les libellés d'affichage ne sont pas contractuels.",
    },
    version: { type: "integer", description: "Version monotone (idempotence des consommateurs d'événements)." },
    source: { type: "string" },
    external_id: { type: "string", nullable: true },
    socle_root_organization_id: { type: "string", format: "uuid" },
    socle_organization_id: { type: "string", format: "uuid", nullable: true },
    socle_procedure_id: { type: "string", format: "uuid", nullable: true },
    socle_contact_id: { type: "string", format: "uuid", nullable: true },
    subject: { type: "string" },
    priority: { type: "string", enum: ["basse", "normale", "haute", "urgente"] },
    closure_motif: {
      type: "string", nullable: true,
      enum: ["irrecevable", "abandon", "retrait_usager", "doublon", "reorientation"],
    },
    closure_text: { type: "string", nullable: true, description: "Texte de clôture destiné à l'USAGER (jamais une note interne)." },
    received_at: { type: "string", format: "date-time" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    closed_at: { type: "string", format: "date-time", nullable: true },
    url: { type: "string", nullable: true, description: "URL de consultation dans l'app Iris." },
  },
} as const;

export function buildOpenApi(baseUrl: string) {
  const bearer = [{ integrationKey: [] as string[] }];
  const err = (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "Iris — API d'ingestion des demandes",
      version: CONTRACT_VERSION,
      description:
        "API serveur-à-serveur, générique et multi-source : toute application autorisée de la " +
        "gamme (Clara, portail citoyen…) ou partenaire tiers dépose des demandes via la même " +
        "enveloppe. Authentification par clé d'intégration (Bearer), périmètre lié à la clé. " +
        "Politique v1 : évolutions additives uniquement ; tolérez les champs de réponse inconnus.",
    },
    servers: [{ url: baseUrl }],
    security: bearer,
    components: {
      securitySchemes: {
        integrationKey: {
          type: "http", scheme: "bearer",
          description:
            "Clé d'intégration Iris (irs_…), liée à une source enregistrée pour UN tenant. " +
            "Secret serveur uniquement — jamais dans un navigateur.",
        },
      },
      schemas: {
        Error: errorSchema,
        IngestEnvelope: envelopeSchema,
        AttachmentRef: attachmentRefSchema,
        LinkRef: linkRefSchema,
        Request: requestResourceSchema,
      },
    },
    paths: {
      "/v1/requests": {
        post: {
          summary: "Déposer une demande (idempotent)",
          description:
            "Scope requests:write. Unicité par (source_system, external_id), complétée par " +
            "idempotency_key. Rejeu au contenu identique → 200 { created: false } ; contenu " +
            "divergent pour le même external_id ou la même clé → 409 conflict.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/IngestEnvelope" } } },
          },
          responses: {
            "201": {
              description: "Demande créée.",
              content: { "application/json": { schema: {
                type: "object",
                properties: {
                  created: { type: "boolean", enum: [true] },
                  request: { $ref: "#/components/schemas/Request" },
                  attachments_pending: { type: "integer" },
                },
              } } },
            },
            "200": {
              description: "Rejeu idempotent : la demande existante est retournée.",
              content: { "application/json": { schema: {
                type: "object",
                properties: {
                  created: { type: "boolean", enum: [false] },
                  request: { $ref: "#/components/schemas/Request" },
                },
              } } },
            },
            "400": err("Enveloppe invalide (clé inconnue, champ manquant, format)."),
            "401": err("Clé absente, inconnue, révoquée ou expirée."),
            "403": err("Scope manquant, intégration suspendue, source_system ou racine hors du périmètre de la clé."),
            "409": err("Contenu divergent pour un external_id ou une idempotency_key déjà utilisés."),
          },
        },
        get: {
          summary: "Lister ses demandes (réconciliation)",
          description: "Scope requests:read. Une intégration ne voit QUE les demandes de sa source, dans son tenant.",
          parameters: [
            { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
          ],
          responses: {
            "200": {
              description: "Demandes triées par updated_at croissant.",
              content: { "application/json": { schema: {
                type: "object",
                properties: { requests: { type: "array", items: { $ref: "#/components/schemas/Request" } } },
              } } },
            },
            "400": err("Paramètre invalide."),
            "401": err("Authentification requise."),
            "403": err("Scope requests:read requis."),
          },
        },
      },
      "/v1/requests/{id}": {
        get: {
          summary: "Relire une demande",
          description: "Scope requests:read. 404 si la demande n'appartient pas à la source authentifiée (l'existence n'est jamais révélée).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": { description: "La demande.", content: { "application/json": { schema: {
              type: "object", properties: { request: { $ref: "#/components/schemas/Request" } },
            } } } },
            "404": err("Hors périmètre ou inexistante."),
          },
        },
      },
      "/v1/requests/{id}/attachments": {
        post: {
          summary: "Ajouter des pièces par référence signée",
          description:
            "Scope requests:write. Endpoint dédié aux pièces : références { file_name, fetch_url } " +
            "uniquement — jamais de contenu inline. La copie est asynchrone (copy_status: pending).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: {
              type: "object",
              required: ["attachments"],
              additionalProperties: false,
              properties: { attachments: { type: "array", minItems: 1, maxItems: 50, items: { $ref: "#/components/schemas/AttachmentRef" } } },
            } } },
          },
          responses: {
            "201": { description: "Pièces enregistrées.", content: { "application/json": { schema: {
              type: "object", properties: { registered: { type: "integer" } },
            } } } },
            "400": err("Références invalides."),
            "404": err("Demande hors périmètre ou inexistante."),
          },
        },
      },
      "/v1/openapi.json": {
        get: {
          summary: "Ce contrat",
          security: [],
          responses: { "200": { description: "Document OpenAPI 3.1." } },
        },
      },
    },
  };
}
