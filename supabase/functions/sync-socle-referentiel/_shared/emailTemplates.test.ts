import { describe, expect, it } from "vitest";
import { emailTemplateMirrorRows, emailTemplatesWarning } from "./emailTemplates.ts";

const tenant = { organizationId: "11111111-1111-4111-8111-111111111111", socleOrgId: "22222222-2222-4222-8222-222222222222" };
const SVC = "33333333-3333-4333-8333-333333333333";
const CUSTOM = "44444444-4444-4444-8444-444444444444";

const system = {
  id: null, key: "accuse_reception", organization_id: tenant.socleOrgId, name: "Accusé de réception de la demande",
  description: null, subject: "Nous avons bien reçu votre demande", body: "{{usager.salutation}},",
  applications: ["iris"], organization_ids: null, is_system: true, is_customized: false,
  variables: ["usager.salutation"], updated_at: null,
};
const custom = {
  id: CUSTOM, key: null, organization_id: tenant.socleOrgId, name: "Document incomplet", description: "Repris",
  subject: "Des documents manquent ({{demande.reference}})", body: "Bonjour,", applications: ["iris", "clara"],
  organization_ids: [SVC, "pas-un-uuid"], is_system: false, is_customized: false, variables: [], updated_at: "2026-11-12T10:00:00Z",
};

describe("emailTemplateMirrorRows", () => {
  it("recopie un courriel système (partout) et un modèle créé (ses organismes)", () => {
    const rows = emailTemplateMirrorRows(tenant, [system, custom])!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: null, key: "accuse_reception", organization_ids: null, variables: ["usager.salutation"] });
    expect(rows[1]).toMatchObject({ id: CUSTOM, key: null, organization_ids: [SVC], description: "Repris" });
  });

  it("écarte ce qui n'est pas pour Iris, ni pour cette racine, ou malformé", () => {
    const rows = emailTemplateMirrorRows(tenant, [
      { ...custom, applications: ["clara"] },
      { ...custom, organization_id: "autre" },
      { ...custom, subject: "  " },
      { ...custom, id: null },
      null,
      "texte",
    ])!;
    expect(rows).toEqual([]);
  });

  it("un modèle créé sans organisme n'est proposé nulle part (liste vide, pas null)", () => {
    const rows = emailTemplateMirrorRows(tenant, [{ ...custom, organization_ids: null }])!;
    expect(rows[0].organization_ids).toEqual([]);
  });

  it("une réponse qui n'est pas une liste ⇒ null (le miroir reste en l'état)", () => {
    expect(emailTemplateMirrorRows(tenant, { error: "x" })).toBeNull();
  });

  it("avertissements lisibles", () => {
    expect(emailTemplatesWarning(tenant, 404)).toContain("1.45.0");
    expect(emailTemplatesWarning(tenant, 500)).toContain("miroir conservé");
  });
});
