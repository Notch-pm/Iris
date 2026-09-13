// Contrat public de l'API d'ingestion — l'OpenAPI est LA documentation de
// référence des endpoints (règle de gamme). Politique : évolutions additives
// au sein d'une version majeure ; la 2.0.0 (2026-09) a retiré le mode
// « URL signée » des pièces, jamais livré, au profit du dépôt direct
// (`POST /v1/uploads`). Les routes restent sous `/v1`.

export const CONTRACT_VERSION = "2.2.0";
/** Taille maximale d'un fichier déposé par un partenaire (documentée, pas seulement appliquée). */
export const MAX_UPLOAD_BYTES_DEFAULT = 25 * 1_048_576;
export const API_BASE_PATH = "/v1";
const API_MOUNT_PATH = "/functions/v1/requests-api";

/**
 * URL publique de l'API telle que la voit un intégrateur. La passerelle
 * Supabase termine le TLS en amont : l'origine vue par la function est en
 * `http://`. On la reconstruit depuis les en-têtes transmis (motif Socle),
 * sinon le contrat publierait un serveur en clair.
 */
export function publicBaseUrl(
  forwardedProto: string | null,
  forwardedHost: string | null,
  seen: URL,
): string {
  const first = (v: string) => v.split(",")[0].trim();
  const proto = forwardedProto ? first(forwardedProto) : seen.protocol.replace(/:$/, "");
  const host = forwardedHost ? first(forwardedHost) : seen.host;
  return `${proto}://${host}${API_MOUNT_PATH}`;
}

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
                 "method_not_allowed", "conflict", "payload_too_large",
                 "unsupported_media_type", "unprocessable", "too_many_requests",
                 "bad_gateway", "internal_error"],
        },
        message: { type: "string", description: "Message en français." },
      },
    },
  },
} as const;

const attachmentRefSchema = {
  type: "object",
  required: ["upload_id"],
  additionalProperties: false,
  properties: {
    upload_id: {
      type: "string", format: "uuid",
      description:
        "Identifiant rendu par `POST /v1/uploads`. Le fichier, son nom, son type et son " +
        "empreinte sont ceux vérifiés par Iris à la réception — l'enveloppe ne les redit pas. " +
        "Un `upload_id` inconnu, expiré, d'une autre clé ou déjà rattaché → 400.",
    },
    form_field_key: {
      type: "string", maxLength: 120,
      description:
        "Clé machine (`key`) du champ « pièce justificative » du form_schema Socle auquel " +
        "la pièce répond. Omise = pièce hors formulaire.",
    },
  },
} as const;

const uploadReceiptSchema = {
  type: "object",
  required: ["upload_id", "file_name", "mime_type", "size_bytes", "checksum", "expires_at"],
  properties: {
    upload_id: { type: "string", format: "uuid" },
    file_name: { type: "string" },
    mime_type: { type: "string", description: "Type DÉTECTÉ par Iris (signature binaire), pas celui annoncé." },
    size_bytes: { type: "integer", minimum: 1 },
    checksum: { type: "string", description: "sha256 hexadécimal du fichier reçu." },
    expires_at: {
      type: "string", format: "date-time",
      description: "Au-delà, un fichier non rattaché à une demande est purgé et l'upload_id refusé.",
    },
  },
} as const;

const linkRefSchema = {
  type: "object",
  required: ["type", "id"],
  additionalProperties: false,
  properties: {
    type: { type: "string", description: "Type de ressource source (ex. courrier, ticket, dossier)." },
    id: { type: "string" },
    url: {
      type: "string",
      description:
        "Permalien PUBLIC vers la ressource. Une adresse qui ne résout que sur votre réseau "
        + "(localhost, IP privée, TLD .local/.internal, hôte sans point) est IGNORÉE : le lien "
        + "est conservé sans URL et la demande porte l'anomalie `permalien_non_public`.",
    },
    label: { type: "string" },
  },
} as const;

const envelopeSchema = {
  type: "object",
  required: ["source_system", "external_id", "socle_root_organization_id",
             "socle_procedure_id", "subject"],
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
    socle_procedure_id: {
      type: "string", format: "uuid",
      description:
        "OBLIGATOIRE — toute demande est fondée sur une démarche Socle ACTIVE du tenant " +
        "(introuvable, obsolète ou hors périmètre → 400). Le snapshot de la démarche est " +
        "construit CÔTÉ SERVEUR depuis Socle : un émetteur ne peut jamais l'imposer.",
    },
    socle_contact_id: {
      type: "string",
      format: "uuid",
      description:
        "Contact Socle, si vous le connaissez déjà. Sinon, laissez-le vide et décrivez " +
        "l'usager dans `requester` : Iris s'occupe du référentiel (voir ci-dessous).",
    },
    subject: { type: "string", maxLength: 500 },
    body: { type: "string" },
    requester: {
      type: "object",
      // Paragraphes joints plutôt que des `\n` dans des littéraux : la
      // description est longue, et c'est la seule forme qui reste relisible.
      description: [
        "Identité du demandeur. Requis si `socle_contact_id` est absent. " +
        "{ \"anonymous\": true } pour un dépôt anonyme assumé.",

        "**Depuis la 1.2.0, Iris tient le référentiel à jour pour vous.** Sans " +
        "`socle_contact_id`, l'identité est d'abord RAPPROCHÉE d'une fiche usager du Socle ; " +
        "à défaut, une fiche est CRÉÉE. La demande porte alors " +
        "`identity_status: \"rapprochee\"` et le `socle_contact_id` obtenu.",

        "La réutilisation d'une fiche existante exige un **identifiant fort** " +
        "(`email`, un téléphone, ou `siret`) : un nom identique ne suffit jamais, " +
        "parce qu'aucun agent n'arbitre les homonymes à l'ingestion. Envoyez donc un " +
        "identifiant fort chaque fois que vous en avez un — c'est ce qui évite les doublons.",

        "Clés reconnues (plusieurs écritures acceptées) : `last_name`/`nom_naissance`/`nom`, " +
        "`usage_name`/`nom_usuel`, `first_name`/`prenoms`, `display_name`, `civility`, " +
        "`birth_date`, `legal_name`/`raison_sociale`, `siret`, `email`/`courriel`, " +
        "`mobile_phone`/`tel_portable`, `landline_phone`/`tel_fixe`, `address_line1`/`adresse`, " +
        "`postal_code`, `city`. Les clés inconnues sont conservées telles quelles dans le " +
        "dossier, sans être envoyées au référentiel.",

        "Si le Socle est injoignable, **la demande est acceptée quand même** : elle reste en " +
        "`identity_status: \"non_rapprochee\"` et porte l'anomalie `usager_a_creer_dans_socle`.",
      ].join("\n\n"),
    },
    form_data: {
      type: "object",
      description: "Réponses au formulaire de la démarche (clé machine = key). Jamais validé à l'ingestion.",
    },
    consents: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "granted"],
        properties: {
          kind: {
            type: "string",
            enum: ["traitement", "partage"],
            description:
              "`traitement` — utilisation des informations pour instruire la demande ; "
              + "`partage` — partage aux services de la collectivité.",
          },
          granted: { type: "boolean" },
        },
      },
      description: [
        "**Consentements RGPD recueillis auprès de l'usager**, posés systématiquement quelle que "
        + "soit la démarche (ils ne font pas partie de `form_data`).",

        "N'envoyez **que** `kind` et `granted` : la phrase exacte consignée est recomposée côté "
        + "Iris depuis le nom de l'organisme principal. Un `statement` fourni est refusé.",

        "Le type `traitement`, s'il est fourni, doit être `granted: true` — un dépôt ne se valide "
        + "pas sans lui. Un type du catalogue omis vaut **refus** : l'absence de case cochée n'est "
        + "jamais un consentement.",

        "**Facultatif** (évolution additive du contrat 2.x) : une enveloppe sans `consents` est "
        + "acceptée, et la demande porte l'anomalie `consentement_absent` — l'agent voit que la "
        + "question n'a pas été posée, plutôt que de le supposer. Quand l'usager est rapproché "
        + "d'une fiche, les consentements sont aussi consignés **au référentiel Socle**, à votre "
        + "nom d'émetteur ; l'échec de cette écriture ne refuse jamais la demande (anomalie "
        + "`consentement_non_transmis_au_socle`).",
      ].join("\n\n"),
    },
    attachments: { type: "array", maxItems: 50, items: attachmentRefSchema },
    context: {
      type: "object",
      additionalProperties: false,
      properties: {
        channel: { type: "string", description: "courrier, email, portail, guichet, telephone…" },
        received_at: { type: "string", format: "date-time", description: "Date de réception D'ORIGINE (≠ date d'ingestion)." },
        external_url: {
          type: "string",
          description:
            "Permalien PUBLIC vers la ressource d'origine. Même règle que `links[].url` : une "
            + "adresse qui ne résout que sur votre réseau est ignorée (anomalie "
            + "`permalien_non_public`) — elle désignerait la machine de l'agent qui la clique.",
        },
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
      description: [
        "API **serveur-à-serveur**, générique et multi-source : toute application autorisée de",
        "la gamme (Clara, portail citoyen…) ou partenaire tiers dépose ses demandes par la",
        "**même enveloppe**. Il n'existe aucune logique spécifique à un émetteur : une",
        "application est une *source enregistrée*, rien de plus.",
        "",
        "Iris est **propriétaire exclusif des demandes**. Une fois déposée, la demande est",
        "instruite dans Iris ; l'émetteur en suit l'état, il ne la pilote pas.",
        "",
        "## Authentification et périmètre",
        "Chaque appel porte une **clé d'intégration** dans `Authorization: Bearer irs_…`.",
        "Elle est **délivrée par un administrateur plateforme Iris**, porte des **scopes**",
        "(`requests:write`, `requests:read`) et une **expiration obligatoire** ; plusieurs clés",
        "peuvent coexister pour une même source (rotation sans coupure).",
        "",
        "La clé est un **secret serveur** : jamais dans un navigateur, un bundle, une variable",
        "`VITE_*` ni un dépôt.",
        "",
        "**Le périmètre est porté par la clé, jamais par vos en-têtes ou votre payload.** La clé",
        "est liée à une source, elle-même liée à UN tenant : le `source_system` et le",
        "`socle_root_organization_id` que vous déclarez sont **vérifiés contre la clé** (403 en",
        "cas d'écart). Une intégration ne lit que **ses propres** demandes.",
        "",
        "## Toute demande est fondée sur une démarche",
        "`socle_procedure_id` est **obligatoire** : Iris ne gère aucune demande libre. La",
        "démarche doit être **active et appartenir au tenant de votre clé** (sinon `400`). Le",
        "**snapshot de la démarche est construit côté serveur** depuis le Socle — vous ne pouvez",
        "pas l'imposer. Si le Socle est injoignable au dépôt, la demande n'est **pas** refusée :",
        "snapshot minimal et anomalie `referentiel_indisponible` levée à la qualification.",
        "",
        "## Idempotence et conflits",
        "L'unicité est portée par le couple `(source_system, external_id)`, complétée par",
        "`idempotency_key`. Rejeu au **contenu identique** → `200` avec la demande existante",
        "(le rejeu sur timeout réseau est le cas nominal, pas une erreur) ; **contenu divergent**",
        "→ `409`, rien n'est écrasé. L'empreinte de contenu ignore `idempotency_key` et les",
        "`upload_id` des pièces : c'est le **contenu** des fichiers (nom, type, taille, sha256,",
        "clé de champ) qui compte — un rejeu avec de nouveaux téléversements des mêmes fichiers",
        "est un rejeu identique.",
        "",
        "## Pièces jointes — en deux temps",
        "1. **Déposez chaque fichier** sur `POST /v1/uploads` (`multipart/form-data`, champ",
        "`file`, 25 Mo maximum). Iris vérifie le **contenu réel** (signature binaire contre une",
        "liste fermée : PDF, JPEG, PNG, WebP, HEIC, GIF, Word .docx, Excel .xlsx, OpenDocument",
        ".odt/.ods — jamais de SVG, d'HTML, d'archive ni de document à macros), exige une",
        "extension cohérente, calcule le sha256, et rend un `upload_id` valable **24 heures**.",
        "2. **Référencez-les** dans l'enveloppe (`attachments: [{ upload_id, form_field_key }]`)",
        "ou après coup sur `POST /v1/requests/{id}/attachments`. Le rattachement est",
        "**synchrone** : à la réponse, les pièces sont dans le dossier.",
        "",
        "Le contenu de fichier **n'entre jamais** dans une enveloppe JSON, et Iris ne va",
        "**jamais chercher** un fichier chez vous : le mode `fetch_url` du contrat 1.x, jamais",
        "livré, a été retiré en 2.0.0. Un fichier déposé et jamais référencé est purgé sans",
        "conséquence.",
        "",
        "## Suivre ses demandes",
        "`GET /v1/requests?updated_since=` (tri `updated_at` croissant) pour la réconciliation",
        "périodique. Le champ `version` est **monotone** : n'appliquez une mise à jour chez vous",
        "que si `version` dépasse celle déjà connue — cela absorbe rejeux et désordre.",
        "",
        "## Erreurs",
        "Toute erreur renvoie `{ \"error\": { \"code\": \"...\", \"message\": \"...\" } }`, messages en",
        "français : `400` (enveloppe invalide), `401` (clé absente/inconnue/révoquée/expirée),",
        "`403` (scope manquant, source suspendue, périmètre), `404` (inexistante **ou hors",
        "périmètre** — l'existence n'est jamais révélée), `405`, `409` (conflit), `413` (fichier",
        "trop gros), `415` (format refusé), `422` (extension incohérente), `429` (trop de",
        "dépôts de fichiers : 60 par minute et par clé), `500`, `502` (stockage indisponible).",
        "",
        "## Politique de version",
        "Au sein d'une version majeure : **évolutions additives uniquement**. Tolérez les champs",
        "de réponse inconnus et ne codez que sur les clés documentées. **2.0.0 (2026-09)** : le",
        "mode « URL signée » des pièces (`fetch_url`, `copy_status: pending`) est retiré — il",
        "n'avait jamais été mis en service. Les routes restent sous `/v1`.",
      ].join("\n"),
      contact: { name: "Équipe Iris" },
    },
    servers: [{ url: baseUrl, description: "Point d'entrée de l'API" }],
    security: bearer,
    tags: [
      {
        name: "Demandes",
        description:
          "Dépôt d'une demande et suivi de son cycle de vie. Le statut appartient à une liste " +
          "fermée de 7 valeurs — les libellés d'affichage, eux, ne sont pas contractuels.",
      },
      {
        name: "Pièces jointes",
        description:
          "Dépôt des fichiers (multipart, vérifiés par Iris), puis rattachement par upload_id " +
          "dans l'enveloppe ou après coup. Jamais de contenu inline dans une enveloppe JSON.",
      },
      { name: "Contrat", description: "Le présent document, servi publiquement." },
    ],
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
        UploadReceipt: uploadReceiptSchema,
        LinkRef: linkRefSchema,
        Request: requestResourceSchema,
      },
    },
    paths: {
      "/v1/uploads": {
        post: {
          tags: ["Pièces jointes"],
          summary: "Déposer un fichier (avant de le rattacher)",
          description:
            "Scope requests:write. Un fichier par appel, `multipart/form-data`, champ `file` " +
            "(25 Mo maximum, 60 dépôts par minute et par clé). Iris vérifie le CONTENU réel — " +
            "signature binaire contre la liste fermée des formats acceptés, extension cohérente — " +
            "calcule le sha256 et rend un `upload_id` valable 24 heures. Le type MIME rendu est " +
            "celui détecté, jamais celui annoncé. Un fichier jamais rattaché est purgé.",
          requestBody: {
            required: true,
            content: { "multipart/form-data": { schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: { type: "string", format: "binary", description: "Le fichier, avec son nom d'origine (extension requise)." },
              },
            } } },
          },
          responses: {
            "201": { description: "Fichier reçu et vérifié.", content: { "application/json": { schema: {
              type: "object", properties: { upload: { $ref: "#/components/schemas/UploadReceipt" } },
            } } } },
            "400": err("Envoi non multipart, fichier absent ou vide, nom invalide."),
            "401": err("Authentification requise."),
            "403": err("Scope requests:write requis."),
            "413": err("Fichier au-delà de 25 Mo."),
            "415": err("Format refusé (hors liste, ou document Office à macros)."),
            "422": err("Extension du nom incohérente avec le contenu détecté."),
            "429": err("Plus de 60 dépôts dans la minute pour cette clé."),
            "502": err("Stockage indisponible — réessayez."),
          },
        },
      },
      "/v1/requests": {
        post: {
          tags: ["Demandes"],
          summary: "Déposer une demande (idempotent)",
          description:
            "Scope requests:write. Unicité par (source_system, external_id), complétée par " +
            "idempotency_key. Rejeu au contenu identique → 200 { created: false } ; contenu " +
            "divergent pour le même external_id ou la même clé → 409 conflict.",
          requestBody: {
            required: true,
            content: { "application/json": {
              schema: { $ref: "#/components/schemas/IngestEnvelope" },
              examples: {
                courrier: {
                  summary: "Action externe issue d'un courrier (usager rapproché au Socle)",
                  value: {
                    source_system: "clara",
                    external_id: "9c0f8f6e-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
                    idempotency_key: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                    socle_root_organization_id: "d5227d25-f327-493a-a9a2-278397531e33",
                    socle_procedure_id: "216fe968-f077-47b4-bd3e-8f856749ea13",
                    socle_contact_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
                    subject: "Nid-de-poule rue des Lilas",
                    body: "Signalé par courrier reçu le 18 août.",
                    form_data: { urgence: "haute" },
                    context: {
                      channel: "courrier",
                      received_at: "2026-08-18T08:00:00Z",
                      external_url: "https://clara.exemple.fr/courriers/2026-00412",
                    },
                    links: [{
                      type: "courrier",
                      id: "2026-00412",
                      url: "https://clara.exemple.fr/courriers/2026-00412",
                    }],
                  },
                },
                portail_declare: {
                  summary: "Dépôt d'un portail citoyen (identité déclarée, non rapprochée)",
                  value: {
                    source_system: "portail-citoyen",
                    external_id: "dossier-42",
                    socle_root_organization_id: "d5227d25-f327-493a-a9a2-278397531e33",
                    socle_procedure_id: "216fe968-f077-47b4-bd3e-8f856749ea13",
                    subject: "Demande d'élagage",
                    requester: { last_name: "Dupont", first_name: "Marie", email: "marie@exemple.fr" },
                    context: { channel: "portail", received_at: "2026-08-19T08:00:00Z" },
                  },
                },
                anonyme: {
                  summary: "Dépôt anonyme assumé",
                  value: {
                    source_system: "portail-citoyen",
                    external_id: "dossier-43",
                    socle_root_organization_id: "d5227d25-f327-493a-a9a2-278397531e33",
                    socle_procedure_id: "216fe968-f077-47b4-bd3e-8f856749ea13",
                    subject: "Dépôt sauvage signalé chemin du Moulin",
                    requester: { anonymous: true },
                  },
                },
              },
            } },
          },
          responses: {
            "201": {
              description: "Demande créée.",
              content: { "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    created: { type: "boolean", enum: [true] },
                    request: { $ref: "#/components/schemas/Request" },
                    attachments_registered: {
                      type: "integer",
                      description: "Pièces rattachées au dossier — synchrone, à la réponse elles y sont.",
                    },
                  },
                },
                example: {
                  created: true,
                  request: {
                    id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
                    reference: "DEM-2026-000123",
                    status: "a_traiter",
                    version: 1,
                    source: "clara",
                    external_id: "9c0f8f6e-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
                    subject: "Nid-de-poule rue des Lilas",
                    priority: "normale",
                    received_at: "2026-08-18T08:00:00Z",
                    url: "https://iris.exemple.fr/demandes/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
                  },
                  attachments_registered: 0,
                },
              } },
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
            "400": err("Enveloppe invalide (clé inconnue, champ manquant, format), ou upload_id inconnu / expiré / déjà rattaché."),
            "401": err("Clé absente, inconnue, révoquée ou expirée."),
            "403": err("Scope manquant, intégration suspendue, source_system ou racine hors du périmètre de la clé."),
            "409": err("Contenu divergent pour un external_id ou une idempotency_key déjà utilisés."),
            "502": err("Stockage indisponible pendant le rattachement des pièces — la demande est créée, rejouez à l'identique : les pièces manquantes seront rattachées."),
          },
        },
        get: {
          tags: ["Demandes"],
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
          tags: ["Demandes"],
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
          tags: ["Pièces jointes"],
          summary: "Rattacher des pièces déjà déposées",
          description:
            "Scope requests:write. Références { upload_id, form_field_key? } de fichiers déposés " +
            "sur POST /v1/uploads — jamais de contenu inline. Rattachement synchrone.",
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
            "201": { description: "Pièces rattachées au dossier.", content: { "application/json": { schema: {
              type: "object", properties: { registered: { type: "integer" } },
            } } } },
            "400": err("Références invalides, ou upload_id inconnu / expiré / déjà rattaché."),
            "404": err("Demande hors périmètre ou inexistante."),
            "502": err("Stockage indisponible — rien n'est rattaché, réessayez."),
          },
        },
      },
      "/v1/openapi.json": {
        get: {
          tags: ["Contrat"],
          summary: "Ce contrat",
          security: [],
          responses: { "200": { description: "Document OpenAPI 3.1." } },
        },
      },
    },
  };
}
