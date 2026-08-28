import { describe, expect, it } from "vitest";
import {
  blockingMessage,
  blockingRequirements,
  buildNonConformityEmail,
  complianceCounts,
  hasNonConforme,
  isKnownMotif,
  motifLabel,
  motifPhrase,
  NONCONFORMITY_MOTIFS,
  pieceFields,
  pieceRequirements,
  readyToResume,
  type QualifiableAttachment,
} from "./conformite";

// Snapshot de démarche minimal — même forme que celle du Socle (form_schema v1).
const snapshot = (content: unknown[]) => ({ form_schema: { version: 1, content } });

function file(over: Partial<QualifiableAttachment> & { id: string }): QualifiableAttachment {
  return {
    file_name: `${over.id}.pdf`,
    form_field_key: null,
    compliance: null,
    compliance_motif: null,
    compliance_note: null,
    ...over,
  };
}

const DOMICILE = {
  id: "f-dom",
  key: "justificatif_domicile",
  label: "Justificatif de domicile",
  type: "attachment",
  required: true,
};

const IDENTITE = {
  id: "f-id",
  key: "piece_identite",
  label: "Pièce d'identité",
  type: "attachment",
};

describe("catalogue des motifs", () => {
  it("expose cinq motifs, tous reconnus, avec libellé d'écran et forme de phrase", () => {
    expect(NONCONFORMITY_MOTIFS).toHaveLength(5);
    for (const motif of NONCONFORMITY_MOTIFS) {
      expect(isKnownMotif(motif.value)).toBe(true);
      expect(motifLabel(motif.value)).toBe(motif.label);
      expect(motifPhrase(motif.value)).toBe(motif.phrase);
      // La phrase s'enchâsse dans « … : le document n'est pas lisible. »
      expect(motif.phrase[0]).toBe(motif.phrase[0].toLowerCase());
    }
  });

  it("ne reconnaît rien d'autre, et rend une valeur inconnue telle quelle", () => {
    expect(isKnownMotif("trop_moche")).toBe(false);
    expect(motifLabel("trop_moche")).toBe("trop_moche");
    expect(motifLabel(null)).toBeNull();
    expect(motifPhrase(undefined)).toBeNull();
  });
});

describe("pieceFields", () => {
  it("retient les champs « pièce » et leur exigence statique", () => {
    const fields = pieceFields(snapshot([DOMICILE, IDENTITE]), {});
    expect(fields).toEqual([
      { key: "justificatif_domicile", label: "Justificatif de domicile", required: true },
      { key: "piece_identite", label: "Pièce d'identité", required: false },
    ]);
  });

  it("ignore les champs qui ne sont pas des pièces", () => {
    const fields = pieceFields(
      snapshot([{ id: "f1", key: "objet", label: "Objet", type: "text", required: true }, DOMICILE]),
      {},
    );
    expect(fields.map((f) => f.key)).toEqual(["justificatif_domicile"]);
  });

  it("rejoue requiredIf sur les valeurs stockées — absente, elle n'exige rien", () => {
    const conditionnel = {
      ...IDENTITE,
      requiredIf: { combinator: "and", rules: [{ fieldId: "f-type", operator: "equals", value: "pro" }] },
    };
    const content = [
      { id: "f-type", key: "type_demandeur", label: "Type", type: "radio", options: [] },
      conditionnel,
    ];
    // pieceFields ne rend que les champs « pièce » : le radio n'y figure pas.
    expect(pieceFields(snapshot(content), { type_demandeur: "particulier" })[0].required).toBe(false);
    expect(pieceFields(snapshot(content), { type_demandeur: "pro" })[0].required).toBe(true);
  });

  it("écarte un champ masqué par visibleIf — un champ invisible n'exige rien", () => {
    const masque = {
      ...DOMICILE,
      visibleIf: { combinator: "and", rules: [{ fieldId: "f-type", operator: "equals", value: "pro" }] },
    };
    const content = [
      { id: "f-type", key: "type_demandeur", label: "Type", type: "radio", options: [] },
      masque,
    ];
    expect(pieceFields(snapshot(content), { type_demandeur: "particulier" })).toEqual([]);
    expect(pieceFields(snapshot(content), { type_demandeur: "pro" })).toHaveLength(1);
  });

  it("écarte un champ dont la SECTION est masquée", () => {
    const content = [
      { id: "f-type", key: "type_demandeur", label: "Type", type: "radio", options: [] },
      {
        id: "sec",
        kind: "section",
        title: "Professionnels",
        visibleIf: { combinator: "and", rules: [{ fieldId: "f-type", operator: "equals", value: "pro" }] },
        fields: [DOMICILE],
      },
    ];
    expect(pieceFields(snapshot(content), { type_demandeur: "particulier" })).toEqual([]);
    expect(pieceFields(snapshot(content), { type_demandeur: "pro" })).toHaveLength(1);
  });

  it("retombe sur l'id quand le builder Socle a laissé la clé machine vide", () => {
    const sansCle = { ...DOMICILE, key: "" };
    expect(pieceFields(snapshot([sansCle]), {})[0].key).toBe("f-dom");
  });

  it("rend une liste vide sans schéma exploitable (snapshot dégradé)", () => {
    expect(pieceFields(null, {})).toEqual([]);
    expect(pieceFields({ form_schema: "cassé" }, {})).toEqual([]);
  });
});

describe("pieceRequirements", () => {
  const snap = snapshot([DOMICILE, IDENTITE]);

  it("rattache chaque fichier à son champ et déduit l'état", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "conforme" }),
      file({ id: "b", form_field_key: "piece_identite" }),
    ]);
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ label: "Justificatif de domicile", required: true, state: "conforme" });
    expect(reqs[1]).toMatchObject({ label: "Pièce d'identité", required: false, state: "a_qualifier" });
  });

  it("une exigence obligatoire sans aucun fichier est « manquante »", () => {
    const reqs = pieceRequirements(snap, {}, []);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ key: "justificatif_domicile", state: "manquante", attachments: [] });
  });

  it("une exigence FACULTATIVE sans fichier ne s'affiche pas du tout", () => {
    const reqs = pieceRequirements(snapshot([IDENTITE]), {}, []);
    expect(reqs).toEqual([]);
  });

  it("plusieurs fichiers : un seul non conforme suffit à faire tomber l'exigence", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "conforme" }),
      file({ id: "b", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "illisible" }),
    ]);
    expect(reqs[0].state).toBe("non_conforme");
    expect(reqs[0].motifs).toEqual(["illisible"]);
  });

  it("plusieurs fichiers : un seul non qualifié suffit à laisser « à qualifier »", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "conforme" }),
      file({ id: "b", form_field_key: "justificatif_domicile" }),
    ]);
    expect(reqs[0].state).toBe("a_qualifier");
  });

  it("dédoublonne les motifs et les rend dans l'ordre du catalogue", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "non_a_jour" }),
      file({ id: "b", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "illisible" }),
      file({ id: "c", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "illisible" }),
    ]);
    expect(reqs[0].motifs).toEqual(["illisible", "non_a_jour"]);
  });

  it("ignore un motif inconnu plutôt que de l'afficher tel quel dans la liste", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "trop_moche" }),
    ]);
    expect(reqs[0].state).toBe("non_conforme");
    expect(reqs[0].motifs).toEqual([]);
  });

  it("écarte les pièces jointes à un e-mail SORTANT — ce ne sont pas les pièces de l'usager", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "conforme" }),
      file({ id: "envoi", email_id: "e1", file_name: "reponse.pdf" }),
    ]);
    expect(reqs).toHaveLength(1);
    expect(reqs.flatMap((r) => r.attachments).map((a) => a.id)).toEqual(["a"]);
  });

  it("range les pièces hors formulaire en fin de liste, jamais obligatoires", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "conforme" }),
      file({ id: "z", file_name: "photo-partenaire.jpg" }),
      file({ id: "y", form_field_key: "cle_inconnue_du_schema", file_name: "annexe.pdf" }),
    ]);
    expect(reqs.map((r) => r.label)).toEqual([
      "Justificatif de domicile",
      "photo-partenaire.jpg",
      "annexe.pdf",
    ]);
    expect(reqs.slice(1).every((r) => r.required === false && r.key === null)).toBe(true);
  });

  it("sans schéma exploitable, toutes les pièces restent qualifiables et rien ne bloque", () => {
    const reqs = pieceRequirements(null, {}, [file({ id: "a", file_name: "scan.pdf" })]);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ key: null, label: "scan.pdf", required: false });
    expect(blockingRequirements(reqs)).toEqual([]);
  });
});

describe("pièces remplacées (« la plus récente fait foi »)", () => {
  const snap = snapshot([DOMICILE, IDENTITE]);

  it("la remplacée sort du calcul, la nouvelle décide seule", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "vieille", form_field_key: "justificatif_domicile", compliance: "non_conforme",
             compliance_motif: "illisible", superseded_by: "neuve" }),
      file({ id: "neuve", form_field_key: "justificatif_domicile", compliance: "conforme" }),
    ]);
    expect(reqs[0].state).toBe("conforme");
    expect(reqs[0].attachments.map((a) => a.id)).toEqual(["neuve"]);
    expect(reqs[0].superseded.map((a) => a.id)).toEqual(["vieille"]);
    // …et la résolution positive s'ouvre : c'est TOUT l'intérêt du remplacement.
    expect(blockingRequirements(reqs)).toEqual([]);
    expect(hasNonConforme(reqs)).toBe(false);
  });

  it("une remplacée non encore qualifiée laisse l'exigence à qualifier, pas conforme", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "vieille", form_field_key: "justificatif_domicile", compliance: "conforme", superseded_by: "neuve" }),
      file({ id: "neuve", form_field_key: "justificatif_domicile" }),
    ]);
    expect(reqs[0].state).toBe("a_qualifier");
    expect(blockingRequirements(reqs)).toHaveLength(1);
  });

  it("toutes les pièces remplacées et aucune active : l'exigence obligatoire redevient manquante", () => {
    const reqs = pieceRequirements(snapshot([DOMICILE]), {}, [
      file({ id: "vieille", form_field_key: "justificatif_domicile", compliance: "conforme", superseded_by: "disparue" }),
    ]);
    expect(reqs[0].state).toBe("manquante");
    expect(reqs[0].superseded.map((a) => a.id)).toEqual(["vieille"]);
  });

  it("garde la mémoire d'une exigence FACULTATIVE dont tout a été remplacé", () => {
    const reqs = pieceRequirements(snapshot([IDENTITE]), {}, [
      file({ id: "v", form_field_key: "piece_identite", superseded_by: "n" }),
      file({ id: "n", form_field_key: "piece_identite", compliance: "conforme" }),
    ]);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].superseded.map((a) => a.id)).toEqual(["v"]);
  });

  it("hors formulaire : la chaîne des remplacements remonte jusqu'à la plus ancienne", () => {
    const reqs = pieceRequirements(null, {}, [
      file({ id: "v1", file_name: "scan-1.pdf", superseded_by: "v2" }),
      file({ id: "v2", file_name: "scan-2.pdf", superseded_by: "v3" }),
      file({ id: "v3", file_name: "scan-3.pdf", compliance: "conforme" }),
    ]);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].label).toBe("scan-3.pdf");
    expect(reqs[0].superseded.map((a) => a.id)).toEqual(["v2", "v1"]);
  });

  it("une remplacée orpheline (remplaçant absent des données) ne s'évapore pas", () => {
    const reqs = pieceRequirements(null, {}, [
      file({ id: "seule", file_name: "vieux.pdf", superseded_by: "jamais-charge" }),
    ]);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].attachments).toEqual([]);
    expect(reqs[0].superseded.map((a) => a.id)).toEqual(["seule"]);
  });

  it("le courriel de signalement ne cite jamais une pièce remplacée", () => {
    const reqs = pieceRequirements(snapshot([DOMICILE]), {}, [
      file({ id: "vieille", file_name: "flou.pdf", form_field_key: "justificatif_domicile",
             compliance: "non_conforme", compliance_motif: "illisible", superseded_by: "neuve" }),
      file({ id: "neuve", file_name: "net.pdf", form_field_key: "justificatif_domicile",
             compliance: "non_conforme", compliance_motif: "non_a_jour" }),
    ]);
    const body = buildNonConformityEmail({
      reference: "DEM-2026-000042", subject: "Objet", requirements: reqs,
      recipient: { fullName: "Marie Durand" }, tenantName: "Ville",
    }).body;
    expect(body).toContain("(net.pdf) : la pièce n'est pas à jour.");
    expect(body).not.toContain("flou.pdf");
  });
});

describe("ce que la garde serveur en déduit", () => {
  const snap = snapshot([DOMICILE, IDENTITE]);

  it("bloque sur une obligatoire non conforme, à qualifier ou manquante", () => {
    for (const files of [
      [],
      [file({ id: "a", form_field_key: "justificatif_domicile" })],
      [file({ id: "a", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "illisible" })],
    ]) {
      expect(blockingRequirements(pieceRequirements(snap, {}, files))).toHaveLength(1);
    }
  });

  it("ne bloque jamais sur une pièce FACULTATIVE, même non conforme", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "conforme" }),
      file({ id: "b", form_field_key: "piece_identite", compliance: "non_conforme", compliance_motif: "illisible" }),
    ]);
    expect(blockingRequirements(reqs)).toEqual([]);
    expect(blockingMessage(reqs)).toBeNull();
    // …mais la demande reste en attente : une pièce non conforme est une pièce non conforme.
    expect(hasNonConforme(reqs)).toBe(true);
    expect(readyToResume(reqs)).toBe(false);
  });

  it("ouvre la résolution quand tout ce qui est obligatoire est conforme", () => {
    const reqs = pieceRequirements(snap, {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "conforme" }),
    ]);
    expect(blockingMessage(reqs)).toBeNull();
    expect(readyToResume(reqs)).toBe(true);
  });

  it("compte et énumère les causes du blocage", () => {
    const content = [DOMICILE, { ...IDENTITE, required: true }, { ...DOMICILE, id: "f-3", key: "rib", label: "RIB", required: true }];
    const reqs = pieceRequirements(snapshot(content), {}, [
      file({ id: "a", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "illisible" }),
      file({ id: "b", form_field_key: "piece_identite" }),
    ]);
    expect(complianceCounts(reqs)).toEqual({
      total: 3, conforme: 0, nonConforme: 1, aQualifier: 1, manquante: 1,
    });
    expect(blockingMessage(reqs)).toBe(
      "3 pièces obligatoires (1 à qualifier, 1 non conforme, 1 manquante) :"
        + " la résolution positive reste fermée tant qu'elles ne sont pas conformes.",
    );
  });

  it("accorde le singulier quand une seule pièce bloque", () => {
    expect(blockingMessage(pieceRequirements(snapshot([DOMICILE]), {}, []))).toBe(
      "1 pièce obligatoire (1 manquante) :"
        + " la résolution positive reste fermée tant qu'elles ne sont pas conformes.",
    );
  });
});

describe("buildNonConformityEmail", () => {
  const base = {
    reference: "DEM-2026-000042",
    subject: "Demande de subvention",
    recipient: { civility: "Madame", fullName: "Marie Durand" },
    tenantName: "Ville de Saint-Aubin",
  };

  const oneBad = pieceRequirements(snapshot([DOMICILE]), {}, [
    file({
      id: "a",
      file_name: "justificatif.pdf",
      form_field_key: "justificatif_domicile",
      compliance: "non_conforme",
      compliance_motif: "illisible",
      compliance_note: "La deuxième page est floue.",
    }),
  ]);

  it("rédige un courriel complet, au singulier, avec motif et précision", () => {
    const mail = buildNonConformityEmail({ ...base, requirements: oneBad });
    expect(mail.subject).toBe("Votre demande DEM-2026-000042 : pièce à transmettre à nouveau");
    expect(mail.body).toBe(
      [
        "Madame Marie Durand,",
        "",
        "Nous avons examiné les pièces jointes à votre demande « Demande de subvention » (référence DEM-2026-000042).",
        "",
        "L'une d'elles ne peut pas être retenue en l'état :",
        "",
        "- Justificatif de domicile (justificatif.pdf) : le document n'est pas lisible.",
        "  Précision : La deuxième page est floue.",
        "",
        "Nous vous remercions de nous transmettre à nouveau cette pièce afin que l'instruction"
          + " de votre demande puisse se poursuivre. Votre demande est placée en attente de ces éléments.",
        "",
        "Cordialement,",
        "Ville de Saint-Aubin",
      ].join("\n"),
    );
  });

  it("passe au pluriel dès la deuxième pièce", () => {
    const content = [DOMICILE, { ...IDENTITE, required: true }];
    const reqs = pieceRequirements(snapshot(content), {}, [
      file({ id: "a", file_name: "j.pdf", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "illisible" }),
      file({ id: "b", file_name: "c.png", form_field_key: "piece_identite", compliance: "non_conforme", compliance_motif: "non_a_jour" }),
    ]);
    const mail = buildNonConformityEmail({ ...base, requirements: reqs });
    expect(mail.subject).toContain("pièces à transmettre");
    expect(mail.body).toContain("Plusieurs d'entre elles ne peuvent pas être retenues en l'état :");
    expect(mail.body).toContain("- Justificatif de domicile (j.pdf) : le document n'est pas lisible.");
    expect(mail.body).toContain("- Pièce d'identité (c.png) : la pièce n'est pas à jour.");
    expect(mail.body).toContain("nous transmettre à nouveau ces pièces");
  });

  it("ne cite QUE les pièces non conformes — jamais les manquantes ni les conformes", () => {
    const content = [DOMICILE, { ...IDENTITE, required: true }, { ...DOMICILE, id: "f-3", key: "rib", label: "RIB", required: true }];
    const reqs = pieceRequirements(snapshot(content), {}, [
      file({ id: "a", file_name: "j.pdf", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "illisible" }),
      file({ id: "b", file_name: "c.png", form_field_key: "piece_identite", compliance: "conforme" }),
    ]);
    const body = buildNonConformityEmail({ ...base, requirements: reqs }).body;
    expect(body).toContain("Justificatif de domicile");
    expect(body).not.toContain("Pièce d'identité");
    expect(body).not.toContain("RIB");
  });

  it("énumère les motifs d'un champ à plusieurs fichiers, et chaque précision une seule fois", () => {
    const reqs = pieceRequirements(snapshot([DOMICILE]), {}, [
      file({ id: "a", file_name: "p1.pdf", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "illisible", compliance_note: "Scan trop sombre." }),
      file({ id: "b", file_name: "p2.pdf", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "non_a_jour", compliance_note: "Scan trop sombre." }),
    ]);
    const body = buildNonConformityEmail({ ...base, requirements: reqs }).body;
    expect(body).toContain("- Justificatif de domicile (p1.pdf, p2.pdf) : le document n'est pas lisible ; la pièce n'est pas à jour.");
    expect(body.match(/Précision : Scan trop sombre\./g)).toHaveLength(1);
  });

  it("omet ce qui manque au lieu de le remplacer par un mot d'écran de gestion", () => {
    const mail = buildNonConformityEmail({
      ...base,
      subject: null,
      recipient: { civility: null, fullName: null },
      requirements: oneBad,
    });
    expect(mail.body.startsWith("Madame, Monsieur,\n")).toBe(true);
    expect(mail.body).toContain("à votre demande (référence DEM-2026-000042).");
    expect(mail.body).not.toContain("null");
    expect(mail.body).not.toContain("undefined");
    expect(mail.body).not.toContain("« »");
  });

  it("se contente du nom quand la civilité manque, et l'inverse", () => {
    const sansCivilite = buildNonConformityEmail({
      ...base, recipient: { fullName: "Boulangerie Durand" }, requirements: oneBad,
    });
    expect(sansCivilite.body.startsWith("Boulangerie Durand,")).toBe(true);
    const sansNom = buildNonConformityEmail({
      ...base, recipient: { civility: "Monsieur" }, requirements: oneBad,
    });
    expect(sansNom.body.startsWith("Monsieur,")).toBe(true);
  });

  it("tient sans motif renseigné (motif inconnu du catalogue)", () => {
    const reqs = pieceRequirements(snapshot([DOMICILE]), {}, [
      file({ id: "a", file_name: "j.pdf", form_field_key: "justificatif_domicile", compliance: "non_conforme", compliance_motif: "trop_moche" }),
    ]);
    expect(buildNonConformityEmail({ ...base, requirements: reqs }).body)
      .toContain("- Justificatif de domicile (j.pdf).");
  });
});
