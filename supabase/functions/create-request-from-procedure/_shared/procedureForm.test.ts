import { describe, expect, it } from "vitest";
import {
  parseLocationValue,
  allowsAnonymous,
  attachmentIsRequired,
  dataKey,
  parseFormSchema,
  parseRequesterConfig,
  sanitizeDeclared,
  selectableAudiences,
  validateFormSubmission,
  validateRequesterSubmission,
  type AttachmentField,
  type FormSchema,
} from "./procedureForm";

// Schéma représentatif : champ racine, section conditionnelle, choix, pièce.
const SCHEMA: FormSchema = parseFormSchema({
  version: 1,
  content: [
    { id: "f-nom", key: "nom_voie", label: "Voie", type: "text", required: true, maxLength: 10 },
    { id: "f-type", key: "type_probleme", label: "Type", type: "select", options: [
      { value: "nid", label: "Nid de poule" }, { value: "autre", label: "Autre" },
    ] },
    { id: "f-detail", key: "detail_autre", label: "Précisez", type: "text", required: true,
      visibleIf: { combinator: "and", rules: [{ fieldId: "f-type", operator: "equals", value: "autre" }] } },
    { id: "s-1", kind: "section", title: "Mesures",
      visibleIf: { combinator: "and", rules: [{ fieldId: "f-type", operator: "isNotEmpty" }] },
      fields: [
        { id: "f-nb", key: "profondeur", label: "Profondeur", type: "number" },
        { id: "f-date", key: "constat", label: "Constaté le", type: "date" },
      ] },
    { id: "f-photo", key: "photo", label: "Photo", type: "attachment", maxFiles: 2,
      acceptedFormats: ["jpg", "png"],
      requiredIf: { combinator: "and", rules: [{ fieldId: "f-type", operator: "equals", value: "nid" }] } },
  ],
});

describe("parseFormSchema", () => {
  it("accepte le schéma et borne maxFiles à 5", () => {
    expect(SCHEMA.content).toHaveLength(5);
    const parsed = parseFormSchema({ version: 1, content: [
      { id: "a", key: "", label: "PJ", type: "attachment", maxFiles: 99, acceptedFormats: [] },
    ] });
    expect((parsed.content[0] as AttachmentField).maxFiles).toBe(5);
  });

  it("retombe sur un schéma vide si un nœud est invalide (parité Socle)", () => {
    expect(parseFormSchema({ version: 1, content: [{ id: "x" }] }).content).toEqual([]);
    expect(parseFormSchema({ version: 2, content: [] }).content).toEqual([]);
    expect(parseFormSchema("n'importe quoi").content).toEqual([]);
    expect(parseFormSchema(null).content).toEqual([]);
  });

  it("tolère les propriétés inconnues (ignorées)", () => {
    const parsed = parseFormSchema({ version: 1, content: [
      { id: "a", key: "k", label: "L", type: "text", nouvelle_prop_socle: true },
    ] });
    expect(parsed.content).toHaveLength(1);
    expect(parsed.content[0]).not.toHaveProperty("nouvelle_prop_socle");
  });
});

describe("dataKey — clé machine, repli sur l'id si vide", () => {
  it("préfère key, replie sur id", () => {
    expect(dataKey({ id: "i1", key: "ma_cle", label: "", type: "text" })).toBe("ma_cle");
    expect(dataKey({ id: "i1", key: "  ", label: "", type: "text" })).toBe("i1");
  });
});

describe("validateFormSubmission — conditions et exigences", () => {
  it("exige les obligatoires visibles, ignore les invisibles", () => {
    // f-detail est invisible (type ≠ autre) : son absence ne bloque pas.
    const r = validateFormSubmission(SCHEMA, { "f-nom": "Lilas", "f-type": "autre_valeur_invalide" }, []);
    expect(r.errors["f-detail"]).toBeUndefined();
    expect(r.errors["f-type"]).toContain("options");
  });

  it("rend obligatoire un champ révélé par condition", () => {
    const r = validateFormSubmission(SCHEMA, { "f-nom": "Lilas", "f-type": "autre" }, []);
    expect(r.ok).toBe(false);
    expect(r.errors["f-detail"]).toBe("Champ obligatoire.");
  });

  it("normalise et indexe par clé machine, champs visibles uniquement", () => {
    const r = validateFormSubmission(SCHEMA, {
      "f-nom": "  Lilas  ", "f-type": "autre", "f-detail": "chaussée", "f-nb": "3,5", "f-date": "2026-08-20",
    }, []);
    expect(r.ok).toBe(true);
    expect(r.formData).toEqual({
      nom_voie: "Lilas", type_probleme: "autre", detail_autre: "chaussée",
      profondeur: 3.5, constat: "2026-08-20",
    });
  });

  it("refuse maxLength, date, email et téléphone invalides", () => {
    const schema = parseFormSchema({ version: 1, content: [
      { id: "e", key: "mail", label: "", type: "email" },
      { id: "t", key: "tel", label: "", type: "phone" },
    ] });
    expect(validateFormSubmission(SCHEMA, { "f-nom": "beaucoup trop long" }, []).errors["f-nom"])
      .toContain("10 caractères");
    expect(validateFormSubmission(schema, { e: "pas-un-mail" }, []).errors["e"]).toContain("e-mail");
    expect(validateFormSubmission(schema, { t: "abc" }, []).errors["t"]).toContain("téléphone");
  });

  it("pièces : requiredIf, cardinalité, formats, pièce orpheline", () => {
    const att = (n: number, ext = "jpg") => Array.from({ length: n }, (_, i) => ({
      form_field_key: "photo", file_name: `p${i}.${ext}`, storage_path: `org/req/p${i}.${ext}`,
    }));
    const base = { "f-nom": "Lilas", "f-type": "nid" };
    // requiredIf satisfaite (type=nid) → pièce obligatoire
    expect(validateFormSubmission(SCHEMA, base, []).errors["f-photo"]).toBe("Pièce justificative obligatoire.");
    // requiredIf non satisfaite → facultative
    expect(validateFormSubmission(SCHEMA, { "f-nom": "L" }, []).errors["f-photo"]).toBeUndefined();
    // cardinalité
    expect(validateFormSubmission(SCHEMA, base, att(3)).errors["f-photo"]).toContain("2 fichiers maximum");
    // format
    expect(validateFormSubmission(SCHEMA, base, att(1, "exe")).errors["f-photo"]).toContain("Format refusé");
    // ok
    expect(validateFormSubmission(SCHEMA, base, att(2)).ok).toBe(true);
    // orpheline (clé inconnue du formulaire)
    const orphan = validateFormSubmission(SCHEMA, { "f-nom": "L" },
      [{ form_field_key: "inconnue", file_name: "x.pdf", storage_path: "p" }]);
    expect(orphan.errors["_attachments"]).toContain("inconnue");
  });

  it("collision de clé machine : repli sur l'id, jamais d'écrasement", () => {
    const schema = parseFormSchema({ version: 1, content: [
      { id: "a", key: "meme_cle", label: "", type: "text" },
      { id: "b", key: "meme_cle", label: "", type: "text" },
    ] });
    const r = validateFormSubmission(schema, { a: "un", b: "deux" }, []);
    expect(r.formData).toEqual({ meme_cle: "un", b: "deux" });
  });
});

describe("requester_config — publics, anonymat, obligatoires", () => {
  const config = {
    citoyen: { enabled: true, fields: { nom_naissance: "obligatoire", prenoms: "visible", adresse: "masque" } },
    entreprise: { enabled: false, fields: { raison_sociale: "obligatoire" } },
  };

  it("selectableAudiences : activés, repli citoyen si aucun", () => {
    expect(selectableAudiences(parseRequesterConfig(config))).toEqual(["citoyen"]);
    expect(selectableAudiences(parseRequesterConfig(null))).toEqual(["citoyen"]);
    expect(selectableAudiences(parseRequesterConfig({
      entreprise: { enabled: true, fields: {} }, association: { enabled: true, fields: {} },
    }))).toEqual(["entreprise", "association"]);
  });

  it("allowsAnonymous : refusé dès qu'un public ACTIVÉ a un champ obligatoire", () => {
    expect(allowsAnonymous(config)).toBe(false);
    // le public désactivé avec obligatoire ne compte pas
    expect(allowsAnonymous({ entreprise: { enabled: false, fields: { siret: "obligatoire" } } })).toBe(true);
    expect(allowsAnonymous({ citoyen: { enabled: true, fields: { prenoms: "visible" } } })).toBe(true);
    expect(allowsAnonymous(null)).toBe(true);
    expect(allowsAnonymous(undefined)).toBe(true);
  });

  it("sanitizeDeclared : whitelist stricte, jamais d'internal_notes", () => {
    expect(sanitizeDeclared("citoyen", {
      nom_naissance: " Dupont ", prenoms: "", internal_notes: "fuite", raison_sociale: "hors public",
      date_naissance: "1990-01-01", inconnu: "x",
    })).toEqual({ nom_naissance: "Dupont" });  // date_naissance : hors contrat Socle, ignorée
  });

  it("validateRequesterSubmission : anonymat gouverné par la démarche", () => {
    expect(validateRequesterSubmission(config, { kind: "anonyme" })).toMatchObject({ ok: false });
    expect(validateRequesterSubmission(null, { kind: "anonyme" })).toEqual({ ok: true });
  });

  it("validateRequesterSubmission : obligatoires du public exigés sans rapprochement", () => {
    const missing = validateRequesterSubmission(config, {
      kind: "sans_rapprochement", audience: "citoyen", declared: { prenoms: "Marie" },
    });
    expect(missing).toMatchObject({ ok: false });
    if (!missing.ok) expect(missing.message).toContain("Nom de naissance");
    expect(validateRequesterSubmission(config, {
      kind: "sans_rapprochement", audience: "citoyen", declared: { nom_naissance: "Dupont" },
    })).toEqual({ ok: true });
    expect(validateRequesterSubmission(config, {
      kind: "sans_rapprochement", audience: "citoyen", declared: {},
    })).toMatchObject({ ok: false });
    // public non proposé
    expect(validateRequesterSubmission(config, {
      kind: "contact", audience: "entreprise", socle_contact_id: "00000000-0000-4000-8000-000000000000",
    })).toMatchObject({ ok: false });
    expect(validateRequesterSubmission(config, {
      kind: "contact", audience: "citoyen", socle_contact_id: "00000000-0000-4000-8000-000000000000",
    })).toEqual({ ok: true });
  });
});

describe("attachmentIsRequired", () => {
  const field: AttachmentField = {
    id: "p", key: "pj", label: "", type: "attachment", maxFiles: 1, acceptedFormats: [],
  };
  it("required statique, requiredIf conditionnelle, absente = facultative", () => {
    expect(attachmentIsRequired(field, {})).toBe(false);
    expect(attachmentIsRequired({ ...field, required: true }, {})).toBe(true);
    const cond = { combinator: "and" as const, rules: [{ fieldId: "x", operator: "equals" as const, value: "1" }] };
    expect(attachmentIsRequired({ ...field, requiredIf: cond }, { x: "1" })).toBe(true);
    expect(attachmentIsRequired({ ...field, requiredIf: cond }, { x: "2" })).toBe(false);
  });
});

describe("lieu d'intervention — champ `location` (Socle 1.29.0)", () => {
  const LIEU = { id: "f-ou", key: "intervention_lieu", label: "Où ?", type: "location", required: true };
  const AT = { address: "10 Avenue de Frémeur 44000 Nantes", lat: 47.223, lon: -1.573, precision: "adresse", adjusted: true };

  it("est lu par le moteur — un type inconnu, lui, vide toujours tout le schéma (parité Socle)", () => {
    const parsed = parseFormSchema({ version: 1, content: [LIEU, { ...LIEU, id: "f-x", key: "x", type: "type_inconnu" }] });
    expect(parsed.content).toEqual([]);
    const ok = parseFormSchema({ version: 1, content: [{ ...LIEU, radius: 300 }] });
    expect(ok.content).toEqual([{ id: "f-ou", key: "intervention_lieu", label: "Où ?", type: "location", required: true }]);
  });

  it("parseLocationValue : la forme du contrat, tolérante — couple de coordonnées, précision, chaîne nue", () => {
    expect(parseLocationValue({ ...AT, citycode: "44109" })).toEqual(AT);
    expect(parseLocationValue({ ...AT, lon: undefined })).toEqual({ ...AT, lat: null, lon: null, adjusted: false });
    expect(parseLocationValue({ ...AT, lat: 91 })).toMatchObject({ lat: null, lon: null, adjusted: false });
    expect(parseLocationValue({ ...AT, precision: "housenumber" })!.precision).toBeNull();
    expect(parseLocationValue({ ...AT, adjusted: "oui" })!.adjusted).toBe(false);
    // Une chaîne nue est élevée : un producteur dégradé ne fait pas perdre le texte.
    expect(parseLocationValue(" 12 rue Neuve ")).toEqual({ address: "12 rue Neuve", lat: null, lon: null, precision: null, adjusted: false });
    for (const raw of [null, undefined, "", "  ", 42, [], {}, { address: " " }, { lat: 1, lon: 2 }]) {
      expect(parseLocationValue(raw)).toBeNull();
    }
  });

  it("validateFormSubmission : obligatoire sans adresse = manquant ; sinon la valeur stockée est normalisée", () => {
    const schema = parseFormSchema({ version: 1, content: [LIEU] });
    for (const value of [undefined, "", {}, { address: "" }]) {
      expect(validateFormSubmission(schema, { "f-ou": value }, []).errors["f-ou"]).toBe("Champ obligatoire.");
    }
    // Un objet qui a quelque chose mais pas d'adresse : ce n'est pas un lieu.
    expect(validateFormSubmission(schema, { "f-ou": { lat: 1, lon: 2 } }, []).errors["f-ou"]).toBe("Adresse attendue.");
    const r = validateFormSubmission(schema, { "f-ou": { ...AT, extra: "x", lon: undefined } }, []);
    expect(r.ok).toBe(true);
    expect(r.formData).toEqual({ intervention_lieu: { ...AT, lat: null, lon: null, adjusted: false } });
    const free = validateFormSubmission(schema, { "f-ou": "12 rue Neuve" }, []);
    expect(free.formData).toEqual({ intervention_lieu: { address: "12 rue Neuve", lat: null, lon: null, precision: null, adjusted: false } });
  });

  it("une condition isEmpty / isNotEmpty sur un lieu regarde son adresse", () => {
    const schema = parseFormSchema({
      version: 1,
      content: [
        { ...LIEU, required: false },
        {
          id: "f-p", key: "precisions", label: "Précisions", type: "text", required: true,
          visibleIf: { combinator: "and", rules: [{ fieldId: "f-ou", operator: "isNotEmpty" }] },
        },
      ],
    });
    expect(validateFormSubmission(schema, { "f-ou": { address: "" } }, []).errors).toEqual({});
    expect(validateFormSubmission(schema, { "f-ou": AT }, []).errors).toEqual({ "f-p": "Champ obligatoire." });
  });
});
