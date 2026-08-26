import { describe, expect, it } from "vitest";
import type { Tables } from "@/types/database.types";
import { TEMPLATE_VARIABLES, renderTemplate } from "@/features/templates/templates";
import { requesterIdentity, type StageEvent } from "./instruction";
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  hasDraftErrors,
  insertAtCaret,
  requestTemplateValues,
  totalBytes,
  validateEmailDraft,
} from "./courriel";

type Request = Tables<"requests">;

/** Une demande complète, telle que PostgREST la rend. */
function request(over: Partial<Request> = {}): Request {
  return {
    id: "req-1",
    organization_id: "org-1",
    reference: "DEM-2026-000042",
    subject: "Nid-de-poule rue des Lilas",
    body: "Un affaissement s'est formé devant le numéro 12.",
    status: "en_instruction",
    priority: "normale",
    channel: "guichet",
    source: "iris",
    received_at: "2026-08-21T09:00:00Z",
    closed_at: null,
    due_at: null,
    closure_motif: null,
    closure_text: null,
    assigned_to: "agent-1",
    socle_procedure_label: "Signalement de voirie",
    socle_category_label: "Cadre de vie",
    socle_organization_label: "Direction de la voirie",
    socle_scope_org_id: "socle-1",
    socle_procedure_id: "proc-1",
    ...over,
  } as Request;
}

const MEMBERS = [{ userId: "agent-1", displayName: "Camille Martin" }];

const DECLARED = {
  civility: "madame",
  first_name: "Marie",
  last_name: "Durand",
  email: "marie.durand@exemple.fr",
  mobile_phone: "06 41 22 87 03",
  address_line1: "12 rue des Lilas",
  postal_code: "44210",
  city: "Saint-Aubin",
};

function values(over: {
  req?: Partial<Request>;
  declared?: Record<string, unknown> | null;
  identityStatus?: string;
  events?: StageEvent[];
  members?: { userId: string; displayName: string }[];
  tenantName?: string;
} = {}) {
  const identityStatus = over.identityStatus ?? "rapprochee";
  return requestTemplateValues({
    request: request(over.req),
    identity: requesterIdentity(
      { declared: over.declared === undefined ? DECLARED : over.declared },
      identityStatus,
    ),
    events: over.events ?? [],
    members: over.members ?? MEMBERS,
    tenantName: over.tenantName ?? "Ville de Saint-Aubin",
  });
}

describe("requestTemplateValues — le groupe usager", () => {
  it("sert les cinq champs que RequesterIdentity n'exposait pas", () => {
    const v = values();
    expect(v["usager.civilite"]).toBe("Madame");
    expect(v["usager.prenom"]).toBe("Marie");
    expect(v["usager.nom"]).toBe("Durand");
    expect(v["usager.nom_complet"]).toBe("Marie Durand");
    expect(v["usager.adresse"]).toBe("12 rue des Lilas, 44210 Saint-Aubin");
  });

  it("traduit la civilité des publics Iris comme celle du Socle", () => {
    expect(values({ declared: { civilite: "monsieur" } })["usager.civilite"]).toBe("Monsieur");
  });

  it("rend une civilité hors contrat telle quelle plutôt que de la perdre", () => {
    expect(values({ declared: { civility: "Mme" } })["usager.civilite"]).toBe("Mme");
  });

  it("sert la raison sociale d'une entreprise sans nom de personne", () => {
    const v = values({ declared: { raison_sociale: "Boulangerie Durand", siret: "12345678900012" } });
    expect(v["usager.raison_sociale"]).toBe("Boulangerie Durand");
    expect(v["usager.nom_complet"]).toBe("Boulangerie Durand");
  });

  it("N'ÉCRIT PAS le repli d'écran « Identité déclarée »", () => {
    const v = values({ declared: {} });
    expect(v).not.toHaveProperty("usager.nom_complet");
  });

  it("ne sert rien d'un dépôt anonyme", () => {
    const v = values({ declared: { anonymous: true }, identityStatus: "anonyme" });
    for (const key of Object.keys(v)) expect(key.startsWith("usager.")).toBe(false);
  });
});

describe("requestTemplateValues — le groupe demande", () => {
  it("rend les libellés français, jamais les valeurs techniques", () => {
    const v = values({
      req: { status: "en_instruction", priority: "haute", channel: "courrier" },
    });
    expect(v["demande.statut"]).toBe("En cours d'instruction");
    expect(v["demande.priorite"]).toBe("Haute");
    expect(v["demande.canal"]).toBe("Courrier");
  });

  it("rend le motif de clôture en clair", () => {
    const v = values({ req: { closure_motif: "irrecevable", closed_at: "2026-08-28T10:00:00Z" } });
    expect(v["demande.motif_cloture"]).toBe("Irrecevable");
    expect(v["demande.date_cloture"]).toBe("28 août 2026");
  });

  it("date les dates en toutes lettres, avec l'année", () => {
    expect(values()["demande.date_depot"]).toBe("21 août 2026");
  });

  it("omet une date absente plutôt que d'écrire « date inconnue »", () => {
    const v = values({ req: { due_at: null, closed_at: null } });
    expect(v).not.toHaveProperty("demande.date_echeance");
    expect(v).not.toHaveProperty("demande.date_cloture");
  });

  it("omet une date illisible", () => {
    const v = values({ req: { due_at: "pas-une-date" } });
    expect(v).not.toHaveProperty("demande.date_echeance");
  });

  it("omet les libellés Socle absents (snapshot dégradé)", () => {
    const v = values({ req: { socle_procedure_label: null, socle_category_label: null } });
    expect(v).not.toHaveProperty("demande.demarche");
    expect(v).not.toHaveProperty("demande.categorie");
  });
});

describe("demande.date_instruction — le PREMIER passage, pas le dernier", () => {
  const events: StageEvent[] = [
    { event_type: "created", payload: { status: "a_traiter" }, created_at: "2026-08-21T09:00:00Z" },
    { event_type: "status_changed", payload: { to: "en_instruction" }, created_at: "2026-08-22T08:00:00Z" },
    { event_type: "status_changed", payload: { to: "resolue_positive" }, created_at: "2026-08-25T08:00:00Z" },
    // Réouverture : `buildStages` retiendrait CE passage-ci, qui est le mauvais.
    { event_type: "status_changed", payload: { to: "en_instruction" }, created_at: "2026-08-30T08:00:00Z" },
  ];

  it("retient la prise en charge initiale même après une réouverture", () => {
    expect(values({ events })["demande.date_instruction"]).toBe("22 août 2026");
  });

  it("ne dépend pas de l'ordre d'arrivée des événements", () => {
    expect(values({ events: [...events].reverse() })["demande.date_instruction"]).toBe("22 août 2026");
  });

  it("omet la clé tant que la demande n'a pas été prise en charge", () => {
    const v = values({ events: [events[0]!] });
    expect(v).not.toHaveProperty("demande.date_instruction");
  });
});

describe("requestTemplateValues — agent et organisation", () => {
  it("nomme l'agent en charge et la collectivité", () => {
    const v = values();
    expect(v["agent.nom"]).toBe("Camille Martin");
    expect(v["organisation.nom"]).toBe("Ville de Saint-Aubin");
  });

  it("omet l'agent quand la demande n'est affectée à personne", () => {
    expect(values({ req: { assigned_to: null } })).not.toHaveProperty("agent.nom");
  });

  it("omet l'agent inconnu de l'annuaire plutôt que d'écrire « Utilisateur »", () => {
    expect(values({ members: [] })).not.toHaveProperty("agent.nom");
  });

  it("n'envoie JAMAIS l'adresse d'un agent en guise de nom", () => {
    const v = values({ members: [{ userId: "agent-1", displayName: "c.martin@ville.fr" }] });
    expect(v).not.toHaveProperty("agent.nom");
  });
});

describe("le catalogue et le résolveur restent d'accord", () => {
  it("ne produit aucune clé absente du catalogue", () => {
    const known = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
    for (const key of Object.keys(values())) expect(known.has(key)).toBe(true);
  });

  it("sait servir CHAQUE clé du catalogue, demande complète en main", () => {
    const v = values({
      req: {
        closed_at: "2026-08-28T10:00:00Z",
        due_at: "2026-09-04T10:00:00Z",
        closure_motif: "irrecevable",
      },
      declared: { ...DECLARED, raison_sociale: "Boulangerie Durand" },
      events: [{ event_type: "status_changed", payload: { to: "en_instruction" }, created_at: "2026-08-22T08:00:00Z" }],
    });
    for (const variable of TEMPLATE_VARIABLES) {
      expect(v[variable.key], `clé non servie : ${variable.key}`).toBeTruthy();
    }
  });

  it("une clé sans valeur laisse un TROU, pas un gabarit à nu", () => {
    const rendered = renderTemplate(
      "Bonjour {{usager.prenom}}, échéance : {{demande.date_echeance}}.",
      values({ req: { due_at: null } }),
    );
    expect(rendered).toBe("Bonjour Marie, échéance : .");
    expect(rendered).not.toContain("{{");
  });
});

describe("le brouillon du composeur", () => {
  const draft = { subject: "Votre demande", body: "Bonjour," };

  it("exige un objet et un message", () => {
    expect(validateEmailDraft({ subject: "  ", body: "  " }, [])).toEqual({
      subject: "L'objet est obligatoire.",
      body: "Le message est obligatoire.",
    });
    expect(hasDraftErrors(validateEmailDraft(draft, []))).toBe(false);
  });

  it("refuse des pièces au-delà de 10 Mo, et le dit en français", () => {
    const files = [{ size: MAX_EMAIL_ATTACHMENT_BYTES }, { size: 1 }];
    const errors = validateEmailDraft(draft, files);
    expect(errors.attachments).toBe("Les pièces jointes dépassent le maximum de 10 Mo.");
    expect(hasDraftErrors(errors)).toBe(true);
  });

  it("accepte exactement le plafond", () => {
    expect(validateEmailDraft(draft, [{ size: MAX_EMAIL_ATTACHMENT_BYTES }])).toEqual({});
  });

  it("totalise les tailles", () => {
    expect(totalBytes([{ size: 10 }, { size: 32 }])).toBe(42);
    expect(totalBytes([])).toBe(0);
  });
});

describe("insertAtCaret", () => {
  it("insère la VALEUR au curseur et rend la position d'après", () => {
    expect(insertAtCaret("Bonjour , merci", 8, "Marie")).toEqual({
      text: "Bonjour Marie, merci",
      caret: 13,
    });
  });

  it("borne un curseur hors du texte", () => {
    expect(insertAtCaret("abc", 99, "!").text).toBe("abc!");
    expect(insertAtCaret("abc", -5, "!").text).toBe("!abc");
  });
});
