import { describe, expect, it } from "vitest";
import {
  buildProfileRows,
  draftForDuplicate,
  draftFromProfileRow,
  draftFromTemplate,
  emptyDraft,
  matrixSummary,
  PROFILE_TEMPLATES,
  type ProfileAssignmentRow,
  type ProfileOrgRow,
  type ProfileProcedureRow,
  type ProfileTableRow,
} from "./profileRows";

const MAIRIE = "22222222-2222-2222-2222-222222222222";
const D1 = "55555555-5555-5555-5555-555555555555";

const PROFILE: ProfileTableRow = {
  id: "p1",
  name: "Voirie-instruction",
  description: "Instruction Voirie",
  is_admin: false,
  is_intervenant: false,
  knowledge_base_access: false,
  status: "active",
  version: 2,
  default_view: false,
  default_create: false,
  default_process: false,
  default_close: false,
};

describe("buildProfileRows", () => {
  it("fusionne les trois tables filles par profile_id", () => {
    const orgs: ProfileOrgRow[] = [{ profile_id: "p1", socle_org_id: MAIRIE }];
    const procedures: ProfileProcedureRow[] = [
      { profile_id: "p1", socle_procedure_id: D1, right_view: true, right_create: false, right_process: true, right_close: false },
    ];
    const assignments: ProfileAssignmentRow[] = [
      { profile_id: "p1", user_id: "u1" },
      { profile_id: "p1", user_id: "u2" },
    ];
    const rows = buildProfileRows([PROFILE], orgs, procedures, assignments);
    expect(rows).toEqual([
      {
        id: "p1",
        name: "Voirie-instruction",
        description: "Instruction Voirie",
        isAdmin: false,
        isIntervenant: false,
        knowledgeBase: false,
        status: "active",
        version: 2,
        organizationIds: [MAIRIE],
        procedures: { [D1]: ["consultation", "instruction"] },
        defaultRights: [],
        assignedUserIds: ["u1", "u2"],
      },
    ]);
  });

  it("un profil sans lignes filles obtient des collections vides, jamais undefined", () => {
    const rows = buildProfileRows([PROFILE], [], [], []);
    expect(rows[0].organizationIds).toEqual([]);
    expect(rows[0].procedures).toEqual({});
    expect(rows[0].assignedUserIds).toEqual([]);
  });

  it("status inconnu ou manquant retombe sur 'active' sauf 'inactive' explicite", () => {
    const rows = buildProfileRows([{ ...PROFILE, status: "inactive" }], [], [], []);
    expect(rows[0].status).toBe("inactive");
  });
});

describe("draftFromProfileRow / draftForDuplicate", () => {
  const row = buildProfileRows(
    [PROFILE],
    [{ profile_id: "p1", socle_org_id: MAIRIE }],
    [{ profile_id: "p1", socle_procedure_id: D1, right_view: true, right_create: true, right_process: false, right_close: false }],
    [],
  )[0];

  it("draftFromProfileRow reflète le profil sans identité ni version", () => {
    expect(draftFromProfileRow(row)).toEqual({
      name: "Voirie-instruction",
      description: "Instruction Voirie",
      isAdmin: false,
      isIntervenant: false,
      knowledgeBase: false,
      defaultRights: [],
      organizationIds: [MAIRIE],
      procedures: { [D1]: ["consultation", "creation"] },
    });
  });

  it("draftForDuplicate ajoute '(copie)' sans toucher au reste", () => {
    const dup = draftForDuplicate(row);
    expect(dup.name).toBe("Voirie-instruction (copie)");
    expect(dup.organizationIds).toEqual(row.organizationIds);
  });
});

describe("emptyDraft / draftFromTemplate — RM-51", () => {
  it("emptyDraft n'accorde rien et ne porte aucune organisation", () => {
    expect(emptyDraft()).toEqual({
      name: "", description: "", isAdmin: false, isIntervenant: false, knowledgeBase: false,
      defaultRights: [], organizationIds: [], procedures: {},
    });
  });

  it("chaque modèle pré-remplit le nom (éditable) et les droits par défaut, jamais le périmètre ni la matrice", () => {
    for (const template of PROFILE_TEMPLATES) {
      const draft = draftFromTemplate(template.id);
      expect(draft.name).toBe(template.label);
      expect(draft.organizationIds).toEqual([]);
      expect(draft.procedures).toEqual({});
      // Le modèle « Intervenant » est le seul à n'accorder AUCUN droit : c'est
      // l'attribut qui le définit, pas la matrice.
      // Les modèles d'AGENT ouvrent la base de connaissances ; « Intervenant »
      // ne voit que ce qu'on lui confie.
      if (template.intervenant) {
        expect(draft.isIntervenant).toBe(true);
        expect(draft.knowledgeBase).toBe(false);
        expect(draft.defaultRights).toEqual([]);
      } else {
        expect(draft.isIntervenant).toBe(false);
        expect(draft.knowledgeBase).toBe(true);
        expect(draft.defaultRights.length).toBeGreaterThan(0);
      }
    }
  });

  it("un identifiant de modèle inconnu retombe sur un brouillon vide", () => {
    expect(draftFromTemplate("inconnu")).toEqual(emptyDraft());
  });
});

describe("matrixSummary", () => {
  it("décrit le préréglage du défaut puis le nombre de démarches personnalisées", () => {
    const row = buildProfileRows([PROFILE], [], [{ profile_id: "p1", socle_procedure_id: D1, right_view: true, right_create: false, right_process: false, right_close: false }], [])[0];
    expect(matrixSummary(row)).toBe("Défaut : Aucun · 1 démarche personnalisée");
  });

  it("affiche 'Détaillé' quand le défaut ne correspond à aucun préréglage", () => {
    const row = buildProfileRows([{ ...PROFILE, default_view: true, default_create: true, default_close: true, default_process: false }], [], [], [])[0];
    expect(matrixSummary(row)).toBe("Défaut : Détaillé · aucune démarche personnalisée");
  });
});
