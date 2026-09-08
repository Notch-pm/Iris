import { describe, expect, it } from "vitest";
import {
  closureOutcome, emptyDocuments, findTemplate, groupTemplates, isMergeable, kindOfTemplate,
  parseProcedureDocuments, unmergeableReason, visibleTemplates,
} from "./templates";

/** Le bloc tel que le brief Socle du 2026-09-01 le montre. */
const RAW = {
  restrict_visibility: true,
  items: [
    {
      id: "6f1c", name: "Notice explicative", description: null,
      type: "interne", group: "document", file_name: "notice.docx", visibility: "toujours",
    },
    {
      id: "a92b", name: "Lettre d'acceptation", description: null,
      type: "courrier", group: "courrier", file_name: "acceptation.docx", visibility: "positive",
    },
    {
      id: "c47d", name: "Lettre de refus", description: null,
      type: "courrier", group: "courrier", file_name: "refus.docx", visibility: "negative",
    },
  ],
};

describe("lecture du contrat", () => {
  it("lit les items dans l'ordre du paramétrage", () => {
    const docs = parseProcedureDocuments(RAW);
    expect(docs.restrict_visibility).toBe(true);
    expect(docs.items.map((i) => i.name)).toEqual([
      "Notice explicative", "Lettre d'acceptation", "Lettre de refus",
    ]);
  });

  it("une démarche jamais passée par l'étape Communication ne propose rien", () => {
    expect(parseProcedureDocuments({ restrict_visibility: false, items: [] })).toEqual(emptyDocuments());
    expect(parseProcedureDocuments(null)).toEqual(emptyDocuments());
    expect(parseProcedureDocuments(undefined)).toEqual(emptyDocuments());
  });

  it("écarte un item incomplet plutôt que d'échouer", () => {
    const docs = parseProcedureDocuments({
      restrict_visibility: true,
      items: [
        { id: "", name: "Sans id", type: "interne" },
        { id: "x", name: "", type: "interne" },
        { id: "y", name: "Type inconnu", type: "affiche" },
        { id: "z", name: "Bon", type: "externe", group: "document", file_name: "a.docx" },
      ],
    });
    expect(docs.items.map((i) => i.id)).toEqual(["z"]);
  });

  it("un champ inconnu du Socle est ignoré, pas recopié", () => {
    const docs = parseProcedureDocuments({
      restrict_visibility: true,
      items: [{ id: "x", name: "N", type: "interne", file_path: "secret/chemin.docx" }],
    });
    expect(Object.hasOwn(docs.items[0], "file_path")).toBe(false);
  });

  it("un groupe absent se déduit du type", () => {
    const docs = parseProcedureDocuments({
      restrict_visibility: false,
      items: [
        { id: "a", name: "A", type: "courrier" },
        { id: "b", name: "B", type: "interne" },
      ],
    });
    expect(docs.items.map((i) => i.group)).toEqual(["courrier", "document"]);
  });

  it("une visibilité inconnue vaut « toujours » — jamais un masquage silencieux", () => {
    const docs = parseProcedureDocuments({
      restrict_visibility: true,
      items: [{ id: "a", name: "A", type: "interne", visibility: "un_jour_peut_etre" }],
    });
    expect(docs.items[0].visibility).toBe("toujours");
  });
});

describe("règle d'affichage", () => {
  const docs = parseProcedureDocuments(RAW);

  it("demande non close : seuls les « toujours »", () => {
    expect(visibleTemplates(docs, null).map((i) => i.id)).toEqual(["6f1c"]);
  });

  it("close positivement : « toujours » + « positive »", () => {
    expect(visibleTemplates(docs, "positive").map((i) => i.id)).toEqual(["6f1c", "a92b"]);
  });

  it("close négativement : « toujours » + « negative »", () => {
    expect(visibleTemplates(docs, "negative").map((i) => i.id)).toEqual(["6f1c", "c47d"]);
  });

  it("⚠️ restriction désactivée : TOUT s'affiche, conditions comprises", () => {
    // Le piège du contrat : les conditions SURVIVENT à la désactivation.
    const sansRestriction = parseProcedureDocuments({ ...RAW, restrict_visibility: false });
    expect(visibleTemplates(sansRestriction, null).map((i) => i.id))
      .toEqual(["6f1c", "a92b", "c47d"]);
  });
});

describe("traduction des statuts Iris", () => {
  it("seules les deux résolutions sont un sort", () => {
    expect(closureOutcome("resolue_positive")).toBe("positive");
    expect(closureOutcome("resolue_negative")).toBe("negative");
    expect(closureOutcome("en_instruction")).toBeNull();
    // Annulée est finale, mais n'est ni positive ni négative.
    expect(closureOutcome("annulee")).toBeNull();
    expect(closureOutcome("archivee")).toBeNull();
  });
});

describe("écran et fusion", () => {
  const docs = parseProcedureDocuments(RAW);

  it("deux sections, dans l'ordre du paramétrage", () => {
    const groups = groupTemplates(docs.items);
    expect(groups.documents.map((i) => i.id)).toEqual(["6f1c"]);
    expect(groups.courriers.map((i) => i.id)).toEqual(["a92b", "c47d"]);
  });

  it("le type du catalogue décide de la nature Iris", () => {
    expect(kindOfTemplate("interne")).toBe("instruction_interne");
    expect(kindOfTemplate("externe")).toBe("instruction_externe");
    expect(kindOfTemplate("courrier")).toBe("courrier");
  });

  it("retrouve un modèle par identifiant, et rien d'autre", () => {
    expect(findTemplate(docs, "a92b")?.name).toBe("Lettre d'acceptation");
    expect(findTemplate(docs, "inconnu")).toBeNull();
  });

  it("seul le .docx est fusionnable, et le refus est explicite", () => {
    expect(isMergeable("acceptation.docx")).toBe(true);
    expect(isMergeable("ACCEPTATION.DOCX")).toBe(true);
    expect(isMergeable("vieux.doc")).toBe(false);
    expect(isMergeable("libre.odt")).toBe(false);
    expect(unmergeableReason("libre.odt")).toContain(".odt");
    expect(unmergeableReason("libre.odt")).toContain(".docx");
  });
});
