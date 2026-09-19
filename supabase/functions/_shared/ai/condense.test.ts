import { describe, expect, it } from "vitest";
import {
  condenseKnowledge,
  demoteHeadings,
  truncateAtBoundary,
  type DocumentExtract,
} from "./condense";
import { emptyAiKnowledge, parseAiKnowledge, type AiKnowledge } from "./knowledge";
import {
  emptyUserCommunication,
  parseUserCommunicationKnowledge,
  type UserCommunicationKnowledge,
} from "./userCommunication";
import { emptyAgentGuidance, type AgentGuidance } from "../organizations/agentGuidance";

const kb = (over: Partial<AiKnowledge> = {}): AiKnowledge => ({
  ...emptyAiKnowledge(),
  agentHelpText: "Vérifier la qualité du demandeur.",
  proceduresText: "1. Accueillir\n2. Contrôler\n3. Délivrer",
  faq: [{ question: "Quelles pièces ?", answer: "Un justificatif de domicile." }],
  guardrails: ["Ne jamais délivrer sans vérifier la qualité du demandeur."],
  ...over,
});

const doc = (name: string, size: number): DocumentExtract => ({
  path: `o/p/training/${name}`,
  name,
  text: `Contenu de ${name}. `.repeat(Math.ceil(size / 20)).slice(0, size),
});

describe("truncateAtBoundary", () => {
  it("laisse un texte court intact", () => {
    expect(truncateAtBoundary("court", 100)).toBe("court");
  });

  it("coupe sur une frontière de mot et annonce la troncature", () => {
    const source = "un deux trois quatre cinq six sept huit";
    const out = truncateAtBoundary(source, 20);
    expect(out).toContain("(extrait tronqué)");
    // Le texte conservé est un préfixe EXACT de la source, terminé sur un mot
    // entier — donc jamais « quatr » ni « quatre c ».
    const kept = out.slice(0, out.indexOf(" […]"));
    expect(source.startsWith(kept)).toBe(true);
    expect(source[kept.length]).toBe(" ");
  });

  // Un caractère hors BMP coupé en deux produit un caractère de remplacement
  // dans le prompt. Sur un document scanné, ça arrive.
  it("ne scinde JAMAIS une paire de substituts UTF-16", () => {
    const text = "a".repeat(9) + "😀" + "b".repeat(40);
    for (let cut = 8; cut <= 14; cut++) {
      const out = truncateAtBoundary(text, cut);
      expect(out).not.toContain("�");
      // Aucun substitut orphelin en fin de chaîne utile.
      for (let i = 0; i < out.length; i++) {
        const c = out.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = out.charCodeAt(i + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        }
      }
    }
  });

  it("rend une chaîne vide sur un budget nul", () => {
    expect(truncateAtBoundary("texte", 0)).toBe("");
  });
});

describe("condenseKnowledge", () => {
  it("rend un bloc vide quand la démarche n'est pas documentée", () => {
    const r = condenseKnowledge(emptyAiKnowledge());
    expect(r.text).toBe("");
    expect(r.included).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("compose les blocs dans l'ordre, garde-fous en tête", () => {
    const r = condenseKnowledge(kb());
    expect(r.text.indexOf("Garde-fous")).toBeLessThan(r.text.indexOf("Consignes du service"));
    expect(r.text).toContain("Ne jamais délivrer sans vérifier");
    expect(r.text).toContain("Procédure de traitement");
    expect(r.text).toContain("Questions fréquentes");
  });

  // LA règle du module : les garde-fous sont la dernière chose abandonnée.
  it("garde les garde-fous même sur un budget minuscule", () => {
    const r = condenseKnowledge(kb({ agentHelpText: "x".repeat(50000) }), [], 200);
    expect(r.text).toContain("Garde-fous");
    expect(r.text).toContain("Ne jamais délivrer");
  });

  it("borne la FAQ à 8 entrées et le signale", () => {
    const faq = Array.from({ length: 12 }, (_, i) => ({ question: `q${i}`, answer: `r${i}` }));
    const r = condenseKnowledge(kb({ faq }));
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("q7");
    expect(r.text).not.toContain("q8");
  });

  it("partage le reliquat entre les documents — un gros n'évince pas les autres", () => {
    const r = condenseKnowledge(kb(), [doc("petit.pdf", 200), doc("enorme.pdf", 400000)], 8000);
    expect(r.included).toContain("petit.pdf");
    expect(r.included).toContain("enorme.pdf");
    expect(r.text).toContain("Document « petit.pdf »");
    expect(r.text).toContain("Document « enorme.pdf »");
  });

  it("tronque un document unique et énorme plutôt que de l'écarter", () => {
    const r = condenseKnowledge(kb(), [doc("enorme.pdf", 400000)], 6000);
    expect(r.included).toEqual(["enorme.pdf"]);
    expect(r.skipped).toEqual([]);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("(extrait tronqué)");
  });

  it("nomme les documents écartés faute de budget", () => {
    const many = Array.from({ length: 10 }, (_, i) => doc(`doc${i}.pdf`, 5000));
    const r = condenseKnowledge(kb(), many, 1200);
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(r.skipped[0].reason).toBe("budget de contexte atteint");
    // Rien n'est perdu en silence : inclus + écartés couvrent tout.
    expect(r.included.length + r.skipped.length).toBe(many.length);
  });

  it("rend les documents dans leur ordre d'origine, pas par taille", () => {
    const r = condenseKnowledge(kb(), [doc("b.pdf", 3000), doc("a.pdf", 100)], 20000);
    expect(r.text.indexOf("« b.pdf »")).toBeLessThan(r.text.indexOf("« a.pdf »"));
  });

  it("cite les sources sans les suivre", () => {
    const r = condenseKnowledge(parseAiKnowledge({
      guardrails: ["g"],
      aiSources: [{ url: "https://interne/llm", description: "Corpus interne" }],
    }));
    expect(r.text).toContain("non consultées par l'assistant");
    expect(r.text).toContain("Corpus interne");
  });

  it("est déterministe — même entrée, même chaîne", () => {
    const docs = [doc("a.pdf", 5000), doc("b.pdf", 900)];
    expect(condenseKnowledge(kb(), docs, 4000).text)
      .toBe(condenseKnowledge(kb(), docs, 4000).text);
  });

  // Une miette de 80 caractères ferait croire au modèle qu'il a le document.
  it("écarte un document plutôt que d'en servir un fragment inexploitable", () => {
    const many = Array.from({ length: 20 }, (_, i) => doc(`doc${i}.pdf`, 5000));
    const r = condenseKnowledge(kb(), many, 1500);
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(r.included.length + r.skipped.length).toBe(many.length);
  });

  it("ignore un document dont l'extraction n'a rien donné", () => {
    const r = condenseKnowledge(kb(), [{ path: "p", name: "vide.pdf", text: "   " }]);
    expect(r.included).toEqual([]);
    expect(r.text).not.toContain("vide.pdf");
  });
});

const uc = (over: Partial<UserCommunicationKnowledge> = {}): UserCommunicationKnowledge => ({
  ...emptyUserCommunication(),
  description: "Pour **stationner** près de chez vous.",
  processingTime: "3 semaines",
  audienceNote: "Réservée aux résidents.",
  announcedPieces: [{ label: "Original du livret de famille", description: "À présenter au guichet" }],
  faq: [{ question: "Où retirer la carte ?", answer: "À l'accueil de la mairie." }],
  admittedAudiences: ["Citoyen", "Entreprise"],
  formPieces: [{ label: "Justificatif de domicile", requirement: "obligatoire", required: true }],
  ...over,
});

describe("condenseKnowledge — communication aux usagers", () => {
  it("n'ajoute rien quand la collectivité n'a rien écrit (piège n° 6)", () => {
    const empty = condenseKnowledge(kb(), [], 20000, emptyUserCommunication());
    const absent = condenseKnowledge(kb());
    expect(empty.text).toBe(absent.text);
    expect(empty.userCommunication).toBe(false);
    expect(empty.text).not.toContain("Communication aux usagers");
  });

  // Le formulaire existe sur presque toutes les démarches : s'il suffisait, une
  // démarche jamais documentée passerait pour « base de connaissances lue ».
  it("les contrepoids seuls ne font pas un bloc", () => {
    const r = condenseKnowledge(emptyAiKnowledge(), [], 20000, uc({
      description: "", processingTime: null, audienceNote: "", announcedPieces: [], faq: [],
    }));
    expect(r.text).toBe("");
    expect(r.userCommunication).toBe(false);
  });

  it("rend le bloc après la matière du service et avant les documents", () => {
    const r = condenseKnowledge(kb(), [{ path: "p", name: "bareme.pdf", text: "Barème." }], 20000, uc());
    expect(r.userCommunication).toBe(true);
    const at = r.text.indexOf("Communication aux usagers");
    expect(at).toBeGreaterThan(r.text.indexOf("Questions fréquentes du service"));
    expect(at).toBeLessThan(r.text.indexOf("Document « bareme.pdf »"));
  });

  // Piège n° 5 : deux FAQ, deux destinataires — jamais fusionnées.
  it("garde la FAQ des usagers à part de celle du service", () => {
    const r = condenseKnowledge(kb(), [], 20000, uc());
    const service = r.text.indexOf("Questions fréquentes du service");
    const usagers = r.text.indexOf("Questions fréquentes DES USAGERS");
    expect(service).toBeGreaterThanOrEqual(0);
    expect(usagers).toBeGreaterThan(service);
    // La question du service n'a pas migré sous le titre des usagers, ni l'inverse.
    expect(r.text.indexOf("Quelles pièces ?")).toBeLessThan(usagers);
    expect(r.text.indexOf("Où retirer la carte ?")).toBeGreaterThan(usagers);
  });

  // Piège n° 2 : trois durées. Celle-ci est un délai de RÉPONSE annoncé.
  it("présente le délai comme annoncé, pas comme une échéance ni un temps de saisie", () => {
    const r = condenseKnowledge(kb(), [], 20000, uc());
    expect(r.text).toContain("Durée habituelle d'instruction annoncée à l'usager : 3 semaines");
    expect(r.text).toContain("ne dit rien de l'échéance d'un dossier");
    expect(r.text).toContain("pas le temps de saisie");
  });

  // Piège n° 3 : la note ne filtre rien, les publics admis font foi.
  it("dit que la note sur le public ne restreint rien, et pose les publics admis", () => {
    const r = condenseKnowledge(kb(), [], 20000, uc());
    expect(r.text).toContain("elle ne restreint pas le dépôt) : « Réservée aux résidents. »\n");
    expect(r.text).toContain("Publics admis au dépôt");
    expect(r.text).toContain("Citoyen, Entreprise");
  });

  // Piège n° 4 : l'annonce n'est pas la liste de dépôt — deux listes, distinctes.
  it("sépare les pièces annoncées des pièces du formulaire, sans les fusionner", () => {
    const r = condenseKnowledge(kb(), [], 20000, uc());
    const annoncees = r.text.indexOf("Pièces ANNONCÉES");
    const formulaire = r.text.indexOf("Pièces demandées par le formulaire");
    expect(annoncees).toBeGreaterThanOrEqual(0);
    expect(formulaire).toBeGreaterThan(annoncees);
    expect(r.text).toContain("  - Original du livret de famille — À présenter au guichet");
    expect(r.text).toContain("  - Justificatif de domicile — obligatoire");
  });

  it("formulaire sans pièce : le dit ; formulaire illisible : se tait", () => {
    expect(condenseKnowledge(kb(), [], 20000, uc({ formPieces: [] })).text)
      .toContain("formulaire de dépôt en ligne : aucune");
    const r = condenseKnowledge(kb(), [], 20000, uc({ formPieces: null }));
    expect(r.text).toContain("Pièces ANNONCÉES");
    expect(r.text).not.toContain("formulaire de dépôt en ligne");
  });

  it("descend les titres du descriptif sous ceux de la base de connaissances", () => {
    const r = condenseKnowledge(kb(), [], 20000, uc({ description: "# Qui ?\nTout le monde." }));
    expect(r.text).toContain("#### Qui ?");
    expect(r.text).not.toMatch(/^# Qui/m);
  });

  it("borne la FAQ des usagers à 8 entrées et le signale", () => {
    const faq = Array.from({ length: 12 }, (_, i) => ({ question: `uq${i}`, answer: `ur${i}` }));
    const r = condenseKnowledge(emptyAiKnowledge(), [], 20000, uc({ faq }));
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("uq7");
    expect(r.text).not.toContain("uq8");
  });

  it("signale un descriptif tronqué", () => {
    const r = condenseKnowledge(emptyAiKnowledge(), [], 20000, uc({ description: "mot ".repeat(5000) }));
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("(extrait tronqué)");
  });

  it("les garde-fous restent le premier bloc, même avec une communication abondante", () => {
    const r = condenseKnowledge(kb(), [], 20000, uc({ description: "mot ".repeat(5000) }));
    expect(r.text.startsWith("### Garde-fous")).toBe(true);
  });

  it("de bout en bout depuis la réponse du Socle", () => {
    const parsed = parseUserCommunicationKnowledge({
      user_communication: { delays: { processingTimeValue: 10, processingTimeUnit: "jour_ouvre" } },
    });
    expect(condenseKnowledge(emptyAiKnowledge(), [], 20000, parsed).text)
      .toContain("annoncée à l'usager : 10 jours ouvrés");
  });
});

const guidance = (over: Partial<AgentGuidance> = {}): AgentGuidance => ({
  ...emptyAgentGuidance(),
  roleDescription: "Accueillir, orienter, instruire.",
  physicalReception: "Guichet ouvert de 8 h 30 à 12 h.",
  guidelines: [{ title: "Confidentialité", text: "Aucun dossier lu\nà voix haute." }],
  faq: [{ question: "Un tiers peut-il déposer ?", answer: "Avec une procuration." }],
  recommendedSources: [{ url: "https://www.service-public.fr", description: "Fiches pratiques" }],
  ...over,
});

describe("condenseKnowledge — recommandations générales de la collectivité", () => {
  it("n'ajoute rien quand la collectivité n'a rien écrit", () => {
    const empty = condenseKnowledge(kb(), [], 20000, null, emptyAgentGuidance());
    expect(empty.text).toBe(condenseKnowledge(kb()).text);
    expect(empty.agentGuidance).toBe(false);
  });

  it("vient APRÈS la matière de la démarche et AVANT les textes publics", () => {
    const r = condenseKnowledge(kb(), [], 20000, uc(), guidance());
    expect(r.agentGuidance).toBe(true);
    const at = r.text.indexOf("Recommandations générales de la collectivité");
    expect(at).toBeGreaterThan(r.text.indexOf("Questions fréquentes du service"));
    expect(at).toBeLessThan(r.text.indexOf("Communication aux usagers"));
    expect(r.text.startsWith("### Garde-fous")).toBe(true);
  });

  it("trois FAQ, trois titres : celle des agents ne se mêle ni au service ni aux usagers", () => {
    const r = condenseKnowledge(kb(), [], 20000, uc(), guidance());
    const service = r.text.indexOf("Questions fréquentes du service");
    const agents = r.text.indexOf("Questions fréquentes DES AGENTS");
    const usagers = r.text.indexOf("Questions fréquentes DES USAGERS");
    expect(service).toBeLessThan(agents);
    expect(agents).toBeLessThan(usagers);
    expect(r.text.indexOf("Un tiers peut-il déposer ?")).toBeGreaterThan(agents);
    expect(r.text.indexOf("Un tiers peut-il déposer ?")).toBeLessThan(usagers);
  });

  it("une consigne tient sur une ligne, titre puis texte", () => {
    const r = condenseKnowledge(emptyAiKnowledge(), [], 20000, null, guidance());
    expect(r.text).toContain("- Confidentialité : Aucun dossier lu à voix haute.");
  });

  it("a son propre plafond : un texte démesuré n'évince pas la matière de la démarche", () => {
    const r = condenseKnowledge(
      kb({ proceduresText: "Étape finale du service." }),
      [],
      20000,
      null,
      guidance({ roleDescription: "mot ".repeat(20000), physicalReception: "mot ".repeat(20000) }),
    );
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("Étape finale du service.");
    const block = r.text.slice(r.text.indexOf("### Recommandations générales"));
    // 3 000 jetons au plus pour le bloc (≈ 10 500 caractères, marge du titre comprise).
    expect(block.length).toBeLessThan(11_500);
  });

  it("les sources recommandées rejoignent les sources citées, sans doublon", () => {
    const r = condenseKnowledge(
      parseAiKnowledge({
        guardrails: ["g"],
        agentLinks: [{ url: "https://www.service-public.fr", description: "Service public" }],
      }),
      [],
      20000,
      null,
      guidance({
        recommendedSources: [
          { url: "https://www.service-public.fr", description: "Fiches pratiques" },
          { url: "https://www.legifrance.gouv.fr", description: "Légifrance" },
        ],
      }),
    );
    expect(r.text.match(/service-public\.fr/g)).toHaveLength(1);
    expect(r.text).toContain("Légifrance (https://www.legifrance.gouv.fr) — recommandée par la collectivité");
  });

  it("des sources recommandées seules comptent comme un apport", () => {
    const r = condenseKnowledge(emptyAiKnowledge(), [], 20000, null, {
      ...emptyAgentGuidance(),
      recommendedSources: [{ url: "https://www.legifrance.gouv.fr", description: "Légifrance" }],
    });
    expect(r.agentGuidance).toBe(true);
    expect(r.text).not.toContain("Recommandations générales de la collectivité");
    expect(r.text).toContain("Légifrance");
  });
});

describe("demoteHeadings", () => {
  it("descend de trois crans, plafonne à six, et ne touche pas au reste", () => {
    expect(demoteHeadings("# A\n## B\n#### C\ntexte #1\n#hashtag")).toBe(
      "#### A\n##### B\n###### C\ntexte #1\n#hashtag",
    );
  });
});
