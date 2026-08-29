import { describe, expect, it } from "vitest";
import {
  buildRequestContext,
  contextAnswers,
  IDENTITY_COLUMNS,
  REQUEST_CONTEXT_COLUMNS,
  STATUS_LABELS,
  type RequestRow,
} from "./context";
import { STATUS_LABELS as ECRAN_STATUS_LABELS } from "@/features/requests/statuts";

const snapshot = {
  id: "p-1",
  form_schema: {
    version: 1,
    content: [
      {
        id: "f-type", key: "type_demandeur", label: "Type de demandeur", type: "radio",
        options: [{ value: "pro", label: "Professionnel" }, { value: "part", label: "Particulier" }],
      },
      { id: "f-siret", key: "siret_entreprise", label: "SIRET", type: "text",
        visibleIf: { combinator: "and", rules: [{ fieldId: "f-type", operator: "equals", value: "pro" }] } },
      { id: "f-voie", key: "intervention_voie", label: "Voie", type: "text" },
      { id: "f-pj", key: "justificatif", label: "Justificatif", type: "attachment", required: true },
      { id: "f-jours", key: "jours", label: "Jours de passage", type: "checkboxes",
        options: [{ value: "lun", label: "Lundi" }, { value: "mar", label: "Mardi" }] },
    ],
  },
};

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
  reference: "DEM-2026-000028",
  subject: "Nid-de-poule rue des Lilas",
  body: "Signalé au guichet.",
  status: "en_instruction",
  priority: "haute",
  channel: "guichet",
  received_at: "2026-08-26T09:12:00Z",
  due_at: "2026-09-09T00:00:00Z",
  closure_motif: null,
  closure_text: null,
  socle_procedure_label: "Demande d'intervention voirie",
  socle_category_label: "Voirie",
  socle_organization_label: "Services techniques",
  form_data: { type_demandeur: "part", intervention_voie: "rue des Lilas", jours: ["lun", "mar"] },
  procedure_snapshot: snapshot,
  anomalies: [],
  ...over,
});

// ⚠️ LE test de ce module. La promesse « sans identité » se tient à cette
// ligne : les colonnes ne sont pas demandées, donc jamais chargées.
describe("REQUEST_CONTEXT_COLUMNS", () => {
  it("ne demande AUCUNE colonne d'identité", () => {
    for (const banned of IDENTITY_COLUMNS) {
      expect(REQUEST_CONTEXT_COLUMNS).not.toContain(banned);
    }
  });

  it("demande bien ce dont l'assistant a besoin", () => {
    for (const needed of ["subject", "status", "form_data", "procedure_snapshot", "due_at"]) {
      expect(REQUEST_CONTEXT_COLUMNS).toContain(needed);
    }
  });
});

// L'assistant ne doit pas nommer un statut autrement que l'écran que l'agent a
// sous les yeux. Le jumeau est vérifié, pas supposé.
describe("jumeau des libellés de statut", () => {
  it("dit exactement la même chose que src/features/requests/statuts.ts", () => {
    expect(STATUS_LABELS).toEqual(ECRAN_STATUS_LABELS);
  });
});

describe("contextAnswers", () => {
  it("rejoue les conditions : un champ masqué n'a pas de réponse", () => {
    const answers = contextAnswers(snapshot, { type_demandeur: "part", siret_entreprise: "123" });
    expect(answers.map((a) => a.label)).not.toContain("SIRET");
  });

  it("montre le champ quand la condition est vraie", () => {
    const answers = contextAnswers(snapshot, { type_demandeur: "pro", siret_entreprise: "123" });
    expect(answers.find((a) => a.label === "SIRET")?.value).toBe("123");
  });

  it("écarte les pièces jointes — elles ne sont pas du contexte textuel", () => {
    const answers = contextAnswers(snapshot, { justificatif: ["fichier.pdf"] });
    expect(answers.map((a) => a.label)).not.toContain("Justificatif");
  });

  // Le CODE d'une option ne dit rien au modèle. On donne le libellé, comme
  // l'écran le fait pour l'agent.
  it("traduit les codes d'option en libellés, y compris en sélection multiple", () => {
    expect(contextAnswers(snapshot, { jours: ["lun", "mar"] })
      .find((a) => a.label === "Jours de passage")?.value).toBe("Lundi, Mardi");
    expect(contextAnswers(snapshot, { type_demandeur: "part" })
      .find((a) => a.label === "Type de demandeur")?.value).toBe("Particulier");
  });

  it("conserve en clair les clés que le schéma ne connaît pas (payload partenaire)", () => {
    const answers = contextAnswers(snapshot, { type_demandeur: "part", champ_partenaire: "valeur" });
    expect(answers.find((a) => a.label === "champ_partenaire")?.value).toBe("valeur");
  });

  it("sans schéma exploitable, retombe sur les clés brutes", () => {
    const answers = contextAnswers(null, { une_cle: "une valeur", vide: "" });
    expect(answers).toEqual([{ label: "une_cle", value: "une valeur" }]);
  });
});

describe("buildRequestContext", () => {
  it("compose le dossier sans jamais nommer l'usager", () => {
    const ctx = buildRequestContext(row(), []);
    expect(ctx.reference).toBe("DEM-2026-000028");
    expect(ctx.procedure).toBe("Demande d'intervention voirie");
    expect(ctx.status).toBe("En cours d'instruction");
    expect(ctx.priority).toBe("Haute");
    expect(ctx.receivedAt).toBe("2026-08-26");
    expect(ctx.dueAt).toBe("2026-09-09");
    expect(JSON.stringify(ctx)).not.toMatch(/requester|contact_id/i);
  });

  it("retire l'identité glissée dans une réponse libre et le signale", () => {
    const ctx = buildRequestContext(
      row({
        form_data: {
          type_demandeur: "part",
          email: "marie@ville.fr",
          intervention_voie: "rue des Lilas",
        },
      }),
      [],
    );
    expect(JSON.stringify(ctx.answers)).not.toContain("marie@ville.fr");
    expect(ctx.removedIdentityKeys).toEqual(["email"]);
    // ...et le lieu d'intervention, lui, reste.
    expect(ctx.answers.find((a) => a.label === "Voie")?.value).toBe("rue des Lilas");
  });

  it("masque un courriel écrit dans la description", () => {
    const ctx = buildRequestContext(row({ body: "Rappeler à marie@ville.fr" }), []);
    expect(ctx.description).toBe("Rappeler à [courriel retiré]");
  });

  it("traduit le journal et IGNORE les types inconnus", () => {
    const ctx = buildRequestContext(row(), [
      { event_type: "status_changed", created_at: "2026-08-27T10:00:00Z" },
      { event_type: "un_type_futur", created_at: "2026-08-27T11:00:00Z" },
    ]);
    expect(ctx.history).toEqual(["2026-08-27 — Changement de statut"]);
  });

  it("compose le motif et le texte de clôture quand ils existent", () => {
    const ctx = buildRequestContext(
      row({ closure_motif: "hors_competence", closure_text: "Voir le département." }),
      [],
    );
    expect(ctx.closure).toBe("hors_competence — Voir le département.");
  });

  it("laisse une demande close répondre — aucun refus ici", () => {
    const ctx = buildRequestContext(row({ status: "resolue_positive" }), []);
    expect(ctx.status).toBe("Résolue positivement");
  });

  it("remonte les anomalies", () => {
    const ctx = buildRequestContext(row({ anomalies: ["usager_a_creer_dans_socle"] }), []);
    expect(ctx.anomalies).toEqual(["usager_a_creer_dans_socle"]);
  });
});
