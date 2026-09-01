import { describe, expect, it } from "vitest";
import { allowedTransitions } from "../statuts";
import {
  activityItems,
  attachmentExt,
  buildStages,
  dueView,
  excerpt,
  formAnswers,
  formSchemaVersion,
  formatBytes,
  headerSubtitle,
  humanizeKey,
  initials,
  linkReason,
  firstInstructionAt,
  requesterIdentity,
  requesterView,
  splitTransitions,
} from "./instruction";

const NOW = new Date(2026, 7, 22, 10, 0); // 22 août 2026, heure locale

describe("dueView", () => {
  it("est absente sans échéance ou avec une date invalide", () => {
    expect(dueView(null, NOW)).toBeNull();
    expect(dueView("pas une date", NOW)).toBeNull();
  });
  it("décrit les jours restants et le ton", () => {
    expect(dueView("2026-08-25T08:00:00Z", NOW)).toMatchObject({ label: "Échéance dans 3 jours", tone: "soon", days: 3 });
    expect(dueView("2026-09-05T08:00:00Z", NOW)).toMatchObject({ label: "Échéance dans 14 jours", tone: "normal" });
    expect(dueView("2026-08-23T23:00:00", NOW)).toMatchObject({ label: "Échéance demain", tone: "soon" });
    expect(dueView("2026-08-22T01:00:00", NOW)).toMatchObject({ label: "Échéance aujourd'hui", tone: "soon" });
  });
  it("signale le retard en jours calendaires", () => {
    expect(dueView("2026-08-21T23:59:00", NOW)).toMatchObject({ label: "En retard de 1 jour", tone: "late", days: -1 });
    expect(dueView("2026-08-10T00:00:00", NOW)).toMatchObject({ label: "En retard de 12 jours", tone: "late" });
  });
});

describe("headerSubtitle", () => {
  it("assemble usager, canal de dépôt, date et échéance", () => {
    const text = headerSubtitle({
      requesterName: "Marie Durand", channel: "guichet", source: "iris",
      receivedAt: "2026-08-21T10:00:00", dueAt: "2026-08-28T10:00:00",
    });
    expect(text).toBe("Marie Durand · déposée au guichet le 21 août 2026 · échéance le 28 août 2026");
  });
  it("mentionne la source quand la demande est ingérée sans canal", () => {
    const text = headerSubtitle({
      requesterName: "Dépôt anonyme", channel: null, source: "clara",
      receivedAt: "2026-08-21T10:00:00", dueAt: null,
    });
    expect(text).toBe("Dépôt anonyme · reçue de clara le 21 août 2026");
  });
  it("tolère un canal inconnu et omet une échéance invalide", () => {
    const text = headerSubtitle({
      requesterName: "X", channel: "pigeon", source: "iris", receivedAt: "2026-08-21T10:00:00", dueAt: "n/a",
    });
    expect(text).toBe("X · déposée via pigeon le 21 août 2026");
  });
  it("omet le nom tant que l'identité n'est pas arrêtée (relecture Socle en cours)", () => {
    // Afficher le nom du dépôt puis le remplacer par celui de la fiche ferait
    // clignoter le titre de la page : sans nom, le sous-titre reste stable.
    const text = headerSubtitle({
      requesterName: null, channel: "guichet", source: "iris",
      receivedAt: "2026-08-21T10:00:00", dueAt: null,
    });
    expect(text).toBe("déposée au guichet le 21 août 2026");
  });
});

describe("requesterIdentity", () => {
  it("lit une fiche Socle relue au dépôt (clés contacts-api)", () => {
    const id = requesterIdentity({
      declared: {
        civility: "Mme", first_name: "Marie", last_name: "Durand", birth_date: "1981-03-14",
        email: "marie@example.fr", mobile_phone: "06 41 22 87 03",
        address_line1: "12 rue des Lilas", postal_code: "44210", city: "Saint-Aubin",
      },
      socle_contact_id: "c1",
    }, "rapprochee");
    expect(id.anonymous).toBe(false);
    expect(id.known).toBe(true);
    expect(id.name).toBe("Marie Durand");
    expect(id.initials).toBe("MD");
    expect(id.subtitle).toBe("Né(e) le 14/03/1981 · Usager Socle rapproché");
    expect(id.rows).toEqual([
      { label: "Adresse", value: "12 rue des Lilas, 44210 Saint-Aubin" },
      { label: "Courriel", value: "marie@example.fr" },
      { label: "Téléphone", value: "06 41 22 87 03" },
    ]);
    expect(id.email).toBe("marie@example.fr");
  });
  it("lit une identité déclarée au guichet (clés des publics Iris)", () => {
    const id = requesterIdentity({
      declared: { nom_naissance: "Dupont", prenoms: "Jean", courriel: "j@d.fr", tel_fixe: "02 40 00 00 00", adresse: "1 place Royale, Nantes" },
      socle_contact_id: null,
    }, "non_rapprochee");
    expect(id.name).toBe("Jean Dupont");
    expect(id.subtitle).toBe("Identité déclarée, sans rapprochement");
    expect(id.rows.map((r) => r.label)).toEqual(["Adresse", "Courriel", "Téléphone"]);
    expect(id.phone).toBe("02 40 00 00 00");
  });
  it("présente une entreprise par sa raison sociale", () => {
    const id = requesterIdentity({ declared: { raison_sociale: "Boulangerie Martin", siret: "12345678900012" } }, "non_rapprochee");
    expect(id.name).toBe("Boulangerie Martin");
    expect(id.initials).toBe("BM");
    expect(id.rows).toEqual([{ label: "SIRET", value: "12345678900012" }]);
  });
  it("conserve en clair les clés inconnues d'un partenaire", () => {
    const id = requesterIdentity({ declared: { last_name: "Dupont", numero_abonne: "AB-42", consent: true } }, "non_rapprochee");
    expect(id.name).toBe("Dupont");
    expect(id.rows).toEqual([
      { label: "Numero abonne", value: "AB-42" },
      { label: "Consent", value: "true" },
    ]);
  });
  it("reconnaît le dépôt anonyme, explicite ou par statut", () => {
    expect(requesterIdentity({ declared: { anonymous: true } }, "non_rapprochee").anonymous).toBe(true);
    expect(requesterIdentity(null, "anonyme")).toMatchObject({ anonymous: true, name: "Dépôt anonyme", initials: "?" });
  });
  it("reste lisible sans aucune information", () => {
    const id = requesterIdentity({ declared: {} }, "non_rapprochee");
    expect(id.known).toBe(false);
    expect(id.name).toBe("Identité déclarée");
    expect(id.rows).toEqual([]);
  });
});

describe("requesterView — la fiche Socle d'aujourd'hui, le dépôt à côté", () => {
  // Le dépôt d'une demande rapprochée : whitelist de contactIdentitySnapshot.
  const DEPOT = {
    declared: { display_name: "Marie Durand", first_name: "Marie", usage_name: "Durand", city: "Nantes" },
    socle_contact_id: "c-1",
  };
  // La même fiche AUJOURD'HUI : un courriel ajouté, la ville corrigée.
  const FICHE = {
    id: "c-1",
    display_name: "Marie Durand",
    first_name: "Marie",
    usage_name: "Durand",
    email: "marie.durand@example.fr",
    city: "Rezé",
  };

  it("retombe sur le dépôt sans fiche relue", () => {
    const view = requesterView(DEPOT, "rapprochee", null);
    expect(view.live).toBe(false);
    expect(view.changes).toEqual([]);
    expect(view.identity).toEqual(view.deposited);
    expect(view.identity.email).toBeNull();
  });

  it("affiche la fiche relue, y compris une adresse ajoutée APRÈS le dépôt", () => {
    const view = requesterView(DEPOT, "rapprochee", FICHE);
    expect(view.live).toBe(true);
    expect(view.identity.email).toBe("marie.durand@example.fr");
    // Le dépôt reste intact : c'est la pièce du dossier.
    expect(view.deposited.email).toBeNull();
  });

  it("liste les écarts, un champ apparu ayant `before: null`", () => {
    const view = requesterView(DEPOT, "rapprochee", FICHE);
    expect(view.changes).toEqual([
      { label: "Adresse", before: "Nantes", after: "Rezé" },
      { label: "Courriel", before: null, after: "marie.durand@example.fr" },
    ]);
  });

  it("signale aussi un champ VIDÉ depuis le dépôt (`after: null`) et un nom changé", () => {
    const depot = { declared: { display_name: "Marie Dupont", email: "ancien@example.fr" } };
    const view = requesterView(depot, "rapprochee", { id: "c-1", display_name: "Marie Durand" });
    expect(view.changes).toEqual([
      { label: "Nom", before: "Marie Dupont", after: "Marie Durand" },
      { label: "Courriel", before: "ancien@example.fr", after: null },
    ]);
  });

  it("ne signale rien quand la fiche n'a pas bougé", () => {
    const view = requesterView(
      { declared: { display_name: "Marie Durand", email: "m@example.fr" } },
      "rapprochee",
      { id: "c-1", display_name: "Marie Durand", email: "m@example.fr" },
    );
    expect(view.live).toBe(true);
    expect(view.changes).toEqual([]);
  });

  it("ne relit jamais par-dessus un dépôt anonyme", () => {
    const view = requesterView(null, "anonyme", FICHE);
    expect(view.live).toBe(false);
    expect(view.identity.anonymous).toBe(true);
  });

  it("ignore une réponse Socle inexploitable plutôt que d'effacer le dépôt", () => {
    for (const junk of [undefined, {}, { id: "c-1" }, { display_name: "X" }, "boom"]) {
      const view = requesterView(DEPOT, "rapprochee", junk);
      expect(view.live).toBe(false);
      expect(view.identity.name).toBe("Marie Durand");
    }
  });
});

describe("requesterIdentity — les champs BRUTS (variables des modèles d'e-mail)", () => {
  it("expose la civilité, que rien ne lisait jusqu'ici", () => {
    // `civility` figurait dans KNOWN_IDENTITY_KEYS — donc exclue des lignes
    // « clés inconnues » — sans qu'aucun pick() ne la lise : elle se perdait.
    const id = requesterIdentity({ declared: { civility: "Mme", last_name: "Durand" } }, "rapprochee");
    expect(id.civility).toBe("Mme");
  });

  it("traduit les valeurs du contrat en français", () => {
    expect(requesterIdentity({ declared: { civility: "madame" } }, "rapprochee").civility).toBe("Madame");
    expect(requesterIdentity({ declared: { civilite: "monsieur" } }, "non_rapprochee").civility).toBe("Monsieur");
  });

  it("sépare prénom et nom, quelles que soient les clés d'origine", () => {
    const socle = requesterIdentity({ declared: { first_name: "Marie", usage_name: "Durand" } }, "rapprochee");
    expect([socle.firstName, socle.lastName]).toEqual(["Marie", "Durand"]);
    const guichet = requesterIdentity({ declared: { prenoms: "Jean", nom_naissance: "Dupont" } }, "non_rapprochee");
    expect([guichet.firstName, guichet.lastName]).toEqual(["Jean", "Dupont"]);
  });

  it("ne déduit ni prénom ni nom d'un display_name Socle", () => {
    const id = requesterIdentity({ declared: { display_name: "Marie Durand" } }, "rapprochee");
    expect(id.name).toBe("Marie Durand");
    expect(id.firstName).toBeNull();
    expect(id.lastName).toBeNull();
  });

  it("expose la raison sociale même sans nom de personne (aucune ligne ne la portait)", () => {
    const id = requesterIdentity({ declared: { raison_sociale: "Boulangerie Durand" } }, "non_rapprochee");
    expect(id.rows).toEqual([]);
    expect(id.legalName).toBe("Boulangerie Durand");
  });

  it("expose l'adresse recomposée comme l'adresse libre", () => {
    const compose = requesterIdentity({
      declared: { address_line1: "12 rue des Lilas", postal_code: "44210", city: "Saint-Aubin" },
    }, "rapprochee");
    expect(compose.address).toBe("12 rue des Lilas, 44210 Saint-Aubin");
    const libre = requesterIdentity({ declared: { adresse: "1 place Royale, Nantes" } }, "non_rapprochee");
    expect(libre.address).toBe("1 place Royale, Nantes");
  });

  it("ne rend AUCUN champ brut pour un dépôt anonyme", () => {
    const id = requesterIdentity(null, "anonyme");
    expect([id.civility, id.firstName, id.lastName, id.legalName, id.address])
      .toEqual([null, null, null, null, null]);
  });
});

describe("firstInstructionAt", () => {
  it("retient le PREMIER passage en instruction, pas le dernier", () => {
    expect(firstInstructionAt([
      { event_type: "status_changed", payload: { to: "en_instruction" }, created_at: "2026-08-22T08:00:00Z" },
      { event_type: "status_changed", payload: { to: "resolue_positive" }, created_at: "2026-08-25T08:00:00Z" },
      { event_type: "status_changed", payload: { to: "en_instruction" }, created_at: "2026-08-30T08:00:00Z" },
    ])).toBe("2026-08-22T08:00:00Z");
  });

  it("compte une demande CRÉÉE directement en instruction", () => {
    expect(firstInstructionAt([
      { event_type: "created", payload: { status: "en_instruction" }, created_at: "2026-08-21T09:00:00Z" },
    ])).toBe("2026-08-21T09:00:00Z");
  });

  it("rend null tant que l'étape n'a pas été atteinte", () => {
    expect(firstInstructionAt([
      { event_type: "created", payload: { status: "a_traiter" }, created_at: "2026-08-21T09:00:00Z" },
    ])).toBeNull();
    expect(firstInstructionAt([])).toBeNull();
  });
});

describe("initials / humanizeKey / excerpt", () => {
  it("prend les deux premières initiales", () => {
    expect(initials("Karim Belkacem")).toBe("KB");
    expect(initials("  marie   durand  ")).toBe("MD");
    expect(initials("")).toBe("?");
  });
  it("humanise une clé machine", () => {
    expect(humanizeKey("date_depart")).toBe("Date depart");
    expect(humanizeKey("dateRetour")).toBe("Date retour");
  });
  it("tronque un texte long", () => {
    expect(excerpt("a".repeat(100), 20)).toHaveLength(20);
    expect(excerpt("court  texte\n ici")).toBe("court texte ici");
  });
});

const SNAPSHOT = {
  id: "p1", name: "Opération tranquillité vacances",
  form_schema: {
    version: 1,
    content: [
      { id: "f1", key: "date_depart", label: "Date de départ", type: "date" },
      { id: "f2", key: "animaux", label: "Animaux présents", type: "boolean" },
      {
        id: "f3", key: "animaux_detail", label: "Précisions animaux", type: "textarea",
        visibleIf: { combinator: "and", rules: [{ fieldId: "f2", operator: "equals", value: "true" }] },
      },
      { id: "f4", key: "frequence", label: "Fréquence", type: "select", options: [{ value: "q", label: "Quotidienne" }] },
      { id: "f5", key: "", label: "Justificatif", type: "attachment", maxFiles: 1 },
    ],
  },
};

describe("formAnswers", () => {
  it("étiquette les réponses avec le snapshot et rejoue la visibilité", () => {
    const rows = formAnswers(SNAPSHOT, { date_depart: "2026-08-28", animaux: true, animaux_detail: "un chat", frequence: "q" });
    expect(rows).toEqual([
      { key: "date_depart", label: "Date de départ", value: "28/08/2026", full: false },
      { key: "animaux", label: "Animaux présents", value: "Oui", full: false },
      { key: "animaux_detail", label: "Précisions animaux", value: "un chat", full: true },
      { key: "frequence", label: "Fréquence", value: "Quotidienne", full: false },
    ]);
  });
  it("masque un champ conditionnel non déclenché et affiche « — » pour un vide", () => {
    const rows = formAnswers(SNAPSHOT, { animaux: false });
    expect(rows.map((r) => r.key)).toEqual(["date_depart", "animaux", "frequence"]);
    expect(rows[0]!.value).toBe("—");
  });
  it("ajoute en clair les clés hors schéma et fonctionne sans snapshot", () => {
    const rows = formAnswers(SNAPSHOT, { date_depart: "2026-08-28", champ_partenaire: ["a", "b"] });
    expect(rows.at(-1)).toEqual({ key: "champ_partenaire", label: "Champ partenaire", value: "a, b", full: false });
    expect(formAnswers(null, { x: 1, y: "" })).toEqual([{ key: "x", label: "X", value: "1", full: false }]);
  });
  it("nomme la qualification d'une pièce, motif compris", () => {
    const events = [
      { id: "e1", event_type: "piece_qualifiee", created_by: "u1", created_at: "2026-08-28T09:00:00Z",
        payload: { file_name: "justif.pdf", compliance: "non_conforme", motif: "illisible" } },
      { id: "e2", event_type: "piece_qualifiee", created_by: "u1", created_at: "2026-08-28T08:00:00Z",
        payload: { file_name: "cni.pdf", compliance: "conforme" } },
    ];
    const nameOf = () => "Camille Martin";
    const withCatalog = activityItems({
      events, notes: [], nameOf, motifLabel: (c) => (c === "illisible" ? "Le document n'est pas lisible" : null),
    });
    expect(withCatalog[0]).toMatchObject({
      label: "Pièce déclarée non conforme",
      detail: "justif.pdf · Camille Martin · Le document n'est pas lisible",
    });
    expect(withCatalog[1]).toMatchObject({
      label: "Pièce déclarée conforme",
      detail: "cni.pdf · Camille Martin",
    });
    // Sans catalogue injecté, le code brut reste lisible plutôt que disparaître.
    expect(activityItems({ events, notes: [], nameOf })[0].detail)
      .toBe("justif.pdf · Camille Martin · illisible");
  });

  it("nomme l'ajout d'une pièce, et le distingue d'un remplacement", () => {
    const nameOf = () => "Camille Martin";
    const items = activityItems({
      events: [
        { id: "e1", event_type: "piece_ajoutee", created_by: "u1", created_at: "2026-08-28T10:00:00Z",
          payload: { file_name: "net.pdf", remplacees: 2 } },
        { id: "e2", event_type: "piece_ajoutee", created_by: "u1", created_at: "2026-08-28T09:00:00Z",
          payload: { file_name: "rib.pdf", remplacees: 0 } },
      ],
      notes: [], nameOf,
    });
    expect(items[0]).toMatchObject({
      label: "Pièce remplacée", detail: "net.pdf · Camille Martin · 2 pièces remplacées",
    });
    expect(items[1]).toMatchObject({ label: "Pièce ajoutée", detail: "rib.pdf · Camille Martin" });
  });

  it("nomme la modification des réponses, sans jamais citer les valeurs", () => {
    const items = activityItems({
      events: [{ id: "e1", event_type: "form_data_updated", created_by: "u1",
                 created_at: "2026-08-28T10:00:00Z",
                 payload: { keys: ["date_naissance", "prenom"], count: 2 } }],
      notes: [], nameOf: () => "Camille Martin",
    });
    expect(items[0]).toMatchObject({
      label: "Réponses du formulaire modifiées", detail: "Camille Martin · 2 réponses",
    });
    expect(items[0].detail).not.toContain("date_naissance");
  });

  it("nomme un transfert d'organisme, et dit s'il a emporté l'affectation", () => {
    const nameOf = () => "Camille Martin";
    const items = activityItems({
      events: [
        { id: "e1", event_type: "transferred", created_by: "u1", created_at: "2026-09-01T10:00:00Z",
          payload: { from_label: "Voirie", to_label: "CCAS", unassigned: true } },
        { id: "e2", event_type: "transferred", created_by: "u1", created_at: "2026-09-01T09:00:00Z",
          payload: { from_label: null, to_label: "Voirie", unassigned: false } },
      ],
      notes: [], nameOf,
    });
    expect(items[0]).toMatchObject({
      label: "Demande transférée",
      detail: "Voirie → CCAS · par Camille Martin · affectation retirée",
    });
    expect(items[1]).toMatchObject({ label: "Demande transférée", detail: "Voirie · par Camille Martin" });
  });

  it("expose la version du formulaire", () => {
    expect(formSchemaVersion(SNAPSHOT)).toBe(1);
    expect(formSchemaVersion(null)).toBeNull();
  });
});

describe("buildStages", () => {
  const created = "2026-08-21T09:42:00";
  it("marque l'étape courante d'une demande nouvelle", () => {
    const stages = buildStages({ status: "a_traiter", closureMotif: null, createdAt: created, events: [] });
    expect(stages.map((s) => s.state)).toEqual(["current", "todo", "todo", "todo", "todo"]);
    expect(stages[0]!.hint).toBe("depuis le 21 août");
  });
  it("date les étapes passées d'après le journal", () => {
    const stages = buildStages({
      status: "en_instruction", closureMotif: null, createdAt: created,
      events: [{ event_type: "status_changed", payload: { from: "a_traiter", to: "en_instruction" }, created_at: "2026-08-22T09:28:00" }],
    });
    expect(stages[0]).toMatchObject({ state: "done", hint: "le 21 août" });
    expect(stages[1]).toMatchObject({ state: "current", hint: "depuis le 22 août" });
    expect(stages[2]!.state).toBe("todo");
  });
  it("signale l'attente sautée et décrit la clôture", () => {
    const stages = buildStages({
      status: "resolue_negative", closureMotif: "irrecevable", createdAt: created,
      events: [
        { event_type: "status_changed", payload: { from: "a_traiter", to: "en_instruction" }, created_at: "2026-08-22T09:28:00" },
        { event_type: "status_changed", payload: { from: "en_instruction", to: "resolue_negative", motif: "irrecevable" }, created_at: "2026-08-23T11:00:00" },
      ],
    });
    expect(stages[2]).toMatchObject({ state: "skipped", hint: "sans mise en attente" });
    expect(stages[3]).toMatchObject({ state: "current", hint: "Résolue négativement — Irrecevable, le 23 août" });
    expect(stages[4]!.state).toBe("todo");
  });
  it("remet en « à venir » une étape déjà passée quand la demande est renvoyée à qualifier", () => {
    const stages = buildStages({
      status: "a_traiter", closureMotif: null, createdAt: created,
      events: [
        { event_type: "status_changed", payload: { from: "a_traiter", to: "en_instruction" }, created_at: "2026-08-22T09:28:00" },
        { event_type: "status_changed", payload: { from: "en_instruction", to: "a_traiter" }, created_at: "2026-08-22T10:00:00" },
      ],
    });
    expect(stages[0]).toMatchObject({ state: "current", hint: "depuis le 22 août" });
    expect(stages[1]!.state).toBe("todo");
  });
});

describe("splitTransitions", () => {
  it("met la transition « vers l'avant » en principal et le reste au menu", () => {
    const a = splitTransitions("a_traiter", allowedTransitions("a_traiter", "agent"));
    expect(a.primary?.to).toBe("en_instruction");
    expect(a.secondary.map((s) => s.to)).toEqual(["resolue_negative", "annulee"]);

    const b = splitTransitions("en_instruction", allowedTransitions("en_instruction", "agent"));
    expect(b.primary?.to).toBe("resolue_positive");
    expect(b.secondary).toHaveLength(4);

    const c = splitTransitions("en_attente", allowedTransitions("en_attente", "agent"));
    expect(c.primary?.to).toBe("en_instruction");
  });
  it("réserve l'archivage à l'administrateur et laisse le désarchivage au menu", () => {
    expect(splitTransitions("resolue_positive", allowedTransitions("resolue_positive", "agent")).primary).toBeNull();
    const admin = splitTransitions("resolue_positive", allowedTransitions("resolue_positive", "administrateur"));
    expect(admin.primary?.to).toBe("archivee");
    expect(admin.secondary.map((s) => s.to)).toEqual(["en_instruction"]);
    const archived = splitTransitions("archivee", allowedTransitions("archivee", "administrateur"));
    expect(archived.primary).toBeNull();
    expect(archived.secondary).toHaveLength(3);
  });
});

describe("activityItems", () => {
  const nameOf = (id: string | null) => (id === "u1" ? "Karim Belkacem" : id === "u2" ? "Claire Lemoine" : "Système / intégration");
  it("fusionne événements et notes, du plus récent au plus ancien", () => {
    const items = activityItems({
      events: [
        { id: "e1", event_type: "created", payload: { source: "iris", status: "a_traiter" }, created_at: "2026-08-21T11:42:00", created_by: "u2" },
        { id: "e2", event_type: "assigned", payload: { from: null, to: "u1" }, created_at: "2026-08-21T12:06:00", created_by: "u2" },
        { id: "e3", event_type: "status_changed", payload: { from: "a_traiter", to: "en_instruction", motif: null }, created_at: "2026-08-22T09:28:00", created_by: "u1" },
        { id: "e4", event_type: "request_created_from_procedure", payload: { attachments: 2 }, created_at: "2026-08-21T11:42:01", created_by: "u2" },
      ],
      notes: [{ id: "n1", author_id: "u1", body: "Vérifié avec la brigade de nuit.", created_at: "2026-08-22T09:30:00" }],
      nameOf,
    });
    expect(items.map((i) => i.id)).toEqual(["note-n1", "evt-e3", "evt-e2", "evt-e4", "evt-e1"]);
    expect(items[0]).toMatchObject({ label: "Note interne ajoutée", detail: "Karim Belkacem · Vérifié avec la brigade de nuit." });
    expect(items[1]).toMatchObject({ label: "Passage à « En cours d'instruction »", detail: "Karim Belkacem · depuis « À traiter »" });
    expect(items[2]).toMatchObject({ label: "Demande affectée", detail: "Karim Belkacem · par Claire Lemoine" });
    expect(items[3]).toMatchObject({ label: "Fondée sur une démarche Socle", detail: "2 pièces jointes · Claire Lemoine" });
    expect(items[4]).toMatchObject({ label: "Demande créée", detail: "Claire Lemoine · saisie dans Iris" });
  });
  it("décrit désaffectation, motif de clôture, ingestion et événements inconnus", () => {
    const items = activityItems({
      events: [
        { id: "e1", event_type: "created", payload: { source: "clara" }, created_at: "2026-08-21T11:42:00", created_by: null },
        { id: "e2", event_type: "assigned", payload: { from: "u1", to: null }, created_at: "2026-08-21T12:06:00", created_by: "u2" },
        { id: "e3", event_type: "status_changed", payload: { from: "a_traiter", to: "annulee", motif: "abandon" }, created_at: "2026-08-22T09:28:00", created_by: "u1" },
        { id: "e4", event_type: "purge_scheduled", payload: {}, created_at: "2026-08-23T09:28:00", created_by: null },
      ],
      notes: [],
      nameOf,
    });
    expect(items[3]).toMatchObject({ label: "Demande créée", detail: "Ingérée depuis clara · Système / intégration" });
    expect(items[2]).toMatchObject({ label: "Demande désaffectée", detail: "Karim Belkacem · par Claire Lemoine" });
    expect(items[1]!.detail).toContain("motif : Abandon (sans réponse de l'usager)");
    expect(items[0]).toMatchObject({ label: "Purge scheduled", detail: "Système / intégration" });
  });
});

describe("pièces et liens", () => {
  it("déduit la vignette d'extension", () => {
    expect(attachmentExt("cni-durand.pdf", null)).toBe("PDF");
    expect(attachmentExt("plan.quartier.PNG", "image/png")).toBe("PNG");
    expect(attachmentExt("sans-extension", "application/pdf")).toBe("PDF");
    expect(attachmentExt("archive.backup", "application/octet-stream")).toBe("DOC");
  });
  it("formate les tailles", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(245_760)).toBe("240 Ko");
    expect(formatBytes(1_258_291)).toBe("1,2 Mo");
  });
  it("explique le lien", () => {
    expect(linkReason({ link_type: "liee_a", external_type: null })).toBe("liée par un agent");
    expect(linkReason({ link_type: "externe", external_type: "clara_courrier" })).toBe("référence clara_courrier");
    expect(linkReason({ link_type: "autre_chose", external_type: null })).toBe("autre chose");
  });
});
