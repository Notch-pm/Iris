import { describe, expect, it } from "vitest";
import type { FormSchema } from "@fn/create-request-from-procedure/_shared/procedureForm";
import type { SocleProcedureRow } from "@/features/socle/useSocleCatalog";
import { DRAFT_VERSION, type CreationDraft } from "../draft";
import {
  CHIPS_VISIBLE,
  draftBanner,
  firstAttachmentField,
  photoBlockState,
  procedureChips,
  readinessLine,
  sectionNumbers,
} from "./mobileCreation";

const NO_PUBLICATION = { portalVisible: true, publicationStart: null, publicationEnd: null };

function proc(id: string, name: string): SocleProcedureRow {
  return { socle_id: id, name, category_name: null, type: "externe", publication: NO_PUBLICATION };
}

const SCHEMA_NO_ATTACHMENT: FormSchema = {
  version: 1,
  content: [
    { id: "f1", key: "objet", label: "Objet", type: "text" },
  ],
};

const SCHEMA_ROOT_ATTACHMENT: FormSchema = {
  version: 1,
  content: [
    { id: "f1", key: "objet", label: "Objet", type: "text" },
    {
      id: "a1", key: "photo", label: "Photo du désordre", type: "attachment",
      maxFiles: 3, acceptedFormats: ["jpg", "png", "pdf"],
    },
  ],
};

const SCHEMA_SECTION_ATTACHMENT: FormSchema = {
  version: 1,
  content: [
    {
      id: "s1", kind: "section", title: "Pièces", fields: [
        {
          id: "a1", key: "photo", label: "Photo du désordre", type: "attachment",
          maxFiles: 1, acceptedFormats: [],
        },
        {
          id: "a2", key: "autre", label: "Autre pièce", type: "attachment",
          maxFiles: 1, acceptedFormats: [],
        },
      ],
    },
  ],
};

describe("firstAttachmentField", () => {
  it("rend null quand la démarche n'a aucun champ pièce", () => {
    expect(firstAttachmentField(SCHEMA_NO_ATTACHMENT)).toBeNull();
  });

  it("trouve un champ pièce posé à la racine", () => {
    const entry = firstAttachmentField(SCHEMA_ROOT_ATTACHMENT);
    expect(entry?.field.id).toBe("a1");
    expect(entry?.field.maxFiles).toBe(3);
    expect(entry?.section).toBeNull();
  });

  it("rend le PREMIER champ pièce quand une section en porte plusieurs", () => {
    const entry = firstAttachmentField(SCHEMA_SECTION_ATTACHMENT);
    expect(entry?.field.id).toBe("a1");
    expect(entry?.section?.id).toBe("s1");
  });
});

describe("photoBlockState", () => {
  it("null quand la démarche n'a pas de pièce — le bloc ne s'affiche pas", () => {
    expect(photoBlockState(SCHEMA_NO_ATTACHMENT, {})).toBeNull();
  });

  it("compte 0 fichier tant que rien n'a été déposé", () => {
    const state = photoBlockState(SCHEMA_ROOT_ATTACHMENT, {});
    expect(state?.count).toBe(0);
    expect(state?.field.field.id).toBe("a1");
  });

  it("reflète les fichiers déjà présents dans l'état PARTAGÉ avec ProcedureFormFields", () => {
    const files = { a1: [new File(["x"], "photo1.jpg"), new File(["y"], "photo2.jpg")] };
    const state = photoBlockState(SCHEMA_ROOT_ATTACHMENT, files);
    expect(state?.count).toBe(2);
  });

  it("ignore les fichiers d'un AUTRE champ", () => {
    const files = { autre_champ: [new File(["x"], "x.jpg")] };
    const state = photoBlockState(SCHEMA_ROOT_ATTACHMENT, files);
    expect(state?.count).toBe(0);
  });
});

describe("procedureChips", () => {
  const rows = [
    proc("1", "Recensement"),
    proc("2", "Acte de mariage"),
    proc("3", "Élagage"),
    proc("4", "Déclaration de travaux"),
    proc("5", "Encombrants"),
    proc("6", "Fuite d'eau"),
    proc("7", "Graffiti"),
    proc("8", "Horaires d'ouverture"),
    proc("9", "Illumination de Noël"),
  ];

  it("trie par nom (FR, accents/casse ignorés)", () => {
    const { visible } = procedureChips(rows, "");
    expect(visible.map((r) => r.name)).toEqual([
      "Acte de mariage", "Déclaration de travaux", "Élagage", "Encombrants",
      "Fuite d'eau", "Graffiti", "Horaires d'ouverture", "Illumination de Noël",
    ]);
  });

  it("tronque à CHIPS_VISIBLE sans recherche, et compte le reste", () => {
    const { visible, hiddenCount } = procedureChips(rows, "");
    expect(visible).toHaveLength(CHIPS_VISIBLE);
    expect(hiddenCount).toBe(rows.length - CHIPS_VISIBLE);
  });

  it("ne tronque pas quand tout tient (≤ CHIPS_VISIBLE)", () => {
    const few = rows.slice(0, 3);
    const { visible, hiddenCount } = procedureChips(few, "");
    expect(visible).toHaveLength(3);
    expect(hiddenCount).toBe(0);
  });

  it("filtre par recherche, accents et casse ignorés, sans troncature", () => {
    const { visible, hiddenCount } = procedureChips(rows, "elagage");
    expect(visible.map((r) => r.name)).toEqual(["Élagage"]);
    expect(hiddenCount).toBe(0);
  });

  it("une recherche vide ou blanche retombe sur la troncature normale", () => {
    expect(procedureChips(rows, "   ").visible).toHaveLength(CHIPS_VISIBLE);
  });

  it("aucune correspondance rend une liste vide, pas une erreur", () => {
    expect(procedureChips(rows, "zzz").visible).toEqual([]);
  });
});

describe("sectionNumbers", () => {
  it("numérote les quatre sections quand la photo est présente", () => {
    expect(sectionNumbers(true)).toEqual({
      photo: "1 · Photo de la situation",
      demarche: "2 · Démarche",
      usager: "3 · Usager",
      details: "4 · Précisions",
    });
  });

  it("renumérote SANS TROU quand la photo est absente", () => {
    const numbers = sectionNumbers(false);
    expect(numbers.photo).toBeUndefined();
    expect(numbers).toEqual({
      demarche: "1 · Démarche",
      usager: "2 · Usager",
      details: "3 · Précisions",
    });
  });
});

describe("readinessLine", () => {
  it("invite à choisir une démarche en premier", () => {
    expect(readinessLine({ hasProcedure: false, hasRequester: false, missing: 4 }))
      .toBe("Choisissez une démarche");
  });

  it("invite à désigner l'usager une fois la démarche choisie", () => {
    expect(readinessLine({ hasProcedure: true, hasRequester: false, missing: 0 }))
      .toBe("Désignez l'usager");
  });

  it("compte les champs obligatoires manquants, au singulier", () => {
    expect(readinessLine({ hasProcedure: true, hasRequester: true, missing: 1 }))
      .toBe("1 champ obligatoire restant");
  });

  it("compte les champs obligatoires manquants, au pluriel", () => {
    expect(readinessLine({ hasProcedure: true, hasRequester: true, missing: 2 }))
      .toBe("2 champs obligatoires restants");
  });

  it("annonce la demande prête quand plus rien ne manque", () => {
    expect(readinessLine({ hasProcedure: true, hasRequester: true, missing: 0 }))
      .toBe("Prête à être créée");
  });
});

describe("draftBanner", () => {
  const draft: CreationDraft = {
    v: DRAFT_VERSION,
    savedAt: "2026-09-10T14:32:00",
    draftId: "8b1b2b1e-1b1e-4b1e-8b1e-1b1e1b1e1b1e",
    step: 3,
    procedureId: "216fe968-f077-47b4-bd3e-8f856749ea13",
    destinationId: "",
    requester: null,
    subject: "",
    body: "",
    priority: "normale",
    values: {},
    linked: [],
    dupDismissed: false,
  };

  it("nomme la démarche connue du cache", () => {
    expect(draftBanner(draft, "Acte de mariage"))
      .toBe("Brouillon du 10/09/2026 14:32 — Acte de mariage");
  });

  it("retombe sur un libellé explicite quand la démarche n'est pas (encore) au cache", () => {
    expect(draftBanner(draft, null))
      .toBe("Brouillon du 10/09/2026 14:32 — démarche à recharger");
  });
});
