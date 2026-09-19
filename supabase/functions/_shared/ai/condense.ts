/**
 * Le budget de contexte : faire tenir une base de connaissances entière — y
 * compris des documents d'entraînement — dans une enveloppe de jetons.
 *
 * Clara tronque à plat (800 / 800 / 3 FAQ / 400 caractères) : suffisant pour
 * un pré-remplissage, insuffisant ici, où l'on doit en plus loger des
 * documents de plusieurs dizaines de pages.
 *
 * DEUX PRINCIPES :
 *
 *  1. **Les garde-fous passent en premier et ne sont jamais évincés.** Ce sont
 *     eux qui changent une décision, et le Socle les adresse explicitement
 *     « à l'agent ET à l'IA ». Tout le reste peut être rogné avant eux.
 *
 *  2. **Les documents se partagent le reliquat en TOURNIQUET**, pas au premier
 *     arrivé. Un découpage à plat ferait qu'un PDF de 200 pages évince tous
 *     les autres, silencieusement — et l'agent ne saurait jamais que la
 *     réponse ignore trois documents sur quatre. Chaque document reçoit une
 *     part égale, puis les courts rendent leur surplus aux longs.
 *
 * Toute troncature est ANNONCÉE dans le texte (le modèle doit savoir qu'il ne
 * voit pas tout) et remontée dans `skipped` / `truncated`, jusqu'à l'écran.
 *
 * Depuis le 2026-09-18, la base de connaissances comprend aussi ce que la
 * collectivité PUBLIE pour ses usagers (`userCommunication.ts`) : un bloc à
 * part, après la matière du service et avant les documents.
 *
 * Depuis le 2026-09-19, elle comprend les RECOMMANDATIONS GÉNÉRALES de la
 * collectivité à ses agents (Socle 1.27.0, `_shared/organizations/
 * agentGuidance.ts`) : un bloc à part, APRÈS la matière de la démarche — une
 * consigne propre à la démarche l'emporte, et c'est elle qui doit survivre au
 * budget — et AVANT la communication aux usagers. Plafond propre : il ne mord
 * jamais sur les garde-fous ni sur les consignes de la démarche.
 *
 * Sortie DÉTERMINISTE : même entrée, même chaîne. C'est ce qui rendra un cache
 * de prompt possible le jour où on en voudra un.
 *
 * Module PUR, testé.
 */

import { estimateTokens } from "./tokens.ts";
import type { AiKnowledge } from "./knowledge.ts";
import {
  isUserCommunicationEmpty,
  type UserCommunicationKnowledge,
} from "./userCommunication.ts";
import {
  isAgentGuidanceEmpty,
  type AgentGuidance,
} from "../organizations/agentGuidance.ts";

/** Enveloppe par défaut laissée à la base de connaissances. */
export const KNOWLEDGE_BUDGET_TOKENS = 20000;

const CHARS_PER_TOKEN = 3.5;

const LIMITS = {
  guardrails: 2000,
  agentHelp: 3000,
  procedures: 3000,
  faqEntries: 8,
  faqQuestion: 200,
  faqAnswer: 600,
  /** Communication aux usagers, bloc entier (jetons). */
  userCommunication: 4000,
  /** Dont le descriptif usager (jetons) — le plus long, rendu en dernier. */
  userDescription: 1500,
  pieces: 20,
  pieceText: 300,
  audienceNote: 500,
  /** Recommandations générales de la collectivité, bloc entier (jetons). */
  agentGuidance: 3000,
  /** Rôle des agents, accueil physique : chacun (caractères). */
  guidanceText: 2400,
  guidelines: 12,
  guidelineTitle: 150,
  guidelineText: 900,
} as const;

const TRUNCATION_MARK = " […] (extrait tronqué)";

/**
 * Part minimale sous laquelle un document est ÉCARTÉ plutôt que réduit à une
 * miette. Servir 80 caractères d'un barème n'aide personne : le modèle croit
 * disposer du document, alors qu'il n'en a qu'un fragment sans contexte. Mieux
 * vaut l'annoncer à l'agent (« 3 documents non pris en compte ») et répondre
 * avec ce qu'on a vraiment lu.
 */
const MIN_DOCUMENT_TOKENS = 150;

function tokensToChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}

/**
 * Tronque sans couper un mot — et surtout **jamais au milieu d'une paire de
 * substituts UTF-16**. Un emoji ou un caractère hors BMP coupé en deux produit
 * un caractère de remplacement dans le prompt ; sur un document scanné, ça
 * arrive plus souvent qu'on ne croit.
 */
export function truncateAtBoundary(text: string, maxChars: number): string {
  if (typeof text !== "string" || text.length <= maxChars) return text ?? "";
  if (maxChars <= 0) return "";

  let cut = maxChars;
  // Ne pas scinder une paire de substituts.
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;

  // Reculer jusqu'à une frontière de ligne, sinon de mot, si elle n'est pas
  // trop loin — au-delà on préfère couper net que perdre 30 % du texte.
  const slice = text.slice(0, cut);
  const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  if (lastBreak > cut * 0.7) cut = lastBreak;

  return text.slice(0, cut).trimEnd() + TRUNCATION_MARK;
}

/** Texte extrait d'un document d'entraînement (vague 4 ; vide avant elle). */
export interface DocumentExtract {
  path: string;
  name: string;
  text: string;
}

export interface CondenseResult {
  /** Le bloc de connaissances prêt à être injecté. Vide si rien à dire. */
  text: string;
  /** Noms des documents effectivement injectés. */
  included: string[];
  /** Documents écartés, avec le motif — remonté jusqu'à l'écran. */
  skipped: { name: string; reason: string }[];
  /** Vrai si au moins un bloc a été rogné. */
  truncated: boolean;
  /** Vrai si le bloc « Communication aux usagers » a été injecté. */
  userCommunication: boolean;
  /** Vrai si le bloc « Recommandations générales de la collectivité » a été injecté. */
  agentGuidance: boolean;
}

function block(title: string, body: string): string {
  return body.trim() === "" ? "" : `### ${title}\n${body.trim()}\n`;
}

/**
 * Descend d'un cran de plus que nos blocs (`###`) les titres d'un texte
 * Markdown venu du référentiel : le descriptif usager en porte, et un `# Titre`
 * au milieu du contexte se lirait comme un bloc voisin de la base de
 * connaissances. C'est aussi la consigne du contrat aux portails (« descendez
 * ses titres d'un niveau »).
 */
export function demoteHeadings(markdown: string): string {
  return markdown.replace(
    /^(#{1,6})(?=\s)/gm,
    (hashes) => "#".repeat(Math.min(6, hashes.length + 3)),
  );
}

/**
 * Le bloc « Communication aux usagers ». Les libellés sont composés par Iris et
 * portent le SENS de chaque donnée, parce que c'est là que le contrat prévient
 * qu'on se trompe (voir `userCommunication.ts`) : un délai annoncé n'est pas
 * une échéance, une note sur le public n'est pas une règle, une pièce annoncée
 * n'est pas une pièce à déposer, la FAQ des usagers n'est pas celle du service.
 */
function userCommunicationBody(
  uc: UserCommunicationKnowledge,
  onTruncate: () => void,
): string {
  // Toute coupe est signalée : le marqueur rallonge le texte, donc on compare
  // les chaînes, pas les longueurs.
  const clip = (value: string, maxChars: number): string => {
    const out = truncateAtBoundary(value, maxChars);
    if (out !== value) onTruncate();
    return out;
  };
  const lines: string[] = [
    "Textes PUBLICS : ils disent ce que la collectivité annonce à l'usager, pas comment instruire.",
  ];

  if (uc.processingTime) {
    lines.push(
      `- Durée habituelle d'instruction annoncée à l'usager : ${uc.processingTime}. ` +
        "C'est un délai de réponse indicatif : il ne dit rien de l'échéance d'un dossier " +
        "ni d'un délai réglementaire, et ce n'est pas le temps de saisie du formulaire.",
    );
  }

  if (uc.audienceNote) {
    const note = clip(uc.audienceNote, LIMITS.audienceNote);
    // La citation en fin de ligne : la note finit souvent par un point, qu'un
    // « ». » redoublerait.
    lines.push(
      "- Précision sur le public concerné (phrase d'information : elle ne restreint pas le " +
        `dépôt) : « ${note} »`,
    );
    if (uc.admittedAudiences.length > 0) {
      lines.push(
        `- Publics admis au dépôt (paramétrage du formulaire — fait foi en cas de ` +
          `contradiction avec la phrase ci-dessus) : ${uc.admittedAudiences.join(", ")}.`,
      );
    }
  }

  if (uc.announcedPieces.length > 0) {
    const pieces = uc.announcedPieces.slice(0, LIMITS.pieces);
    if (uc.announcedPieces.length > pieces.length) onTruncate();
    lines.push(
      "- Pièces ANNONCÉES à l'usager (texte de présentation, pas la liste de dépôt : il peut " +
        "recouper le formulaire, ou citer une pièce à présenter au guichet) :",
    );
    for (const p of pieces) {
      const label = clip(p.label, LIMITS.pieceText);
      const detail = p.description ? ` — ${clip(p.description, LIMITS.pieceText)}` : "";
      lines.push(`  - ${label}${detail}`);
    }
    // Le contrepoids : sans lui, le modèle prendrait l'annonce pour la liste
    // complète, et « n'afficher que items en cacherait certaines du dépôt ».
    // `null` : formulaire illisible, on n'en dit rien plutôt que « aucune ».
    if (uc.formPieces !== null) {
      const formPieces = uc.formPieces.slice(0, LIMITS.pieces);
      if (uc.formPieces.length > formPieces.length) onTruncate();
      if (formPieces.length === 0) {
        lines.push("- Pièces demandées par le formulaire de dépôt en ligne : aucune.");
      } else {
        lines.push("- Pièces demandées par le formulaire de dépôt en ligne (font foi pour le dépôt) :");
        for (const p of formPieces) {
          lines.push(`  - ${clip(p.label, LIMITS.pieceText)} — ${p.requirement}`);
        }
      }
    }
  }

  if (uc.faq.length > 0) {
    const entries = uc.faq.slice(0, LIMITS.faqEntries);
    if (uc.faq.length > entries.length) onTruncate();
    lines.push(
      "",
      "Questions fréquentes DES USAGERS (réponses publiées par la collectivité — distinctes " +
        "des questions fréquentes du service) :",
    );
    entries.forEach((f, i) => {
      if (i > 0) lines.push("");
      lines.push(`Q. ${clip(f.question, LIMITS.faqQuestion)}`, `R. ${clip(f.answer, LIMITS.faqAnswer)}`);
    });
  }

  if (uc.description) {
    const description = clip(demoteHeadings(uc.description), tokensToChars(LIMITS.userDescription));
    lines.push("", "Descriptif de la démarche présenté à l'usager :", description);
  }

  return lines.join("\n");
}

/**
 * Le bloc « Recommandations générales ». Ses sous-titres portent le SENS de
 * chaque rubrique ; la règle de préséance (la démarche l'emporte) est, elle,
 * une consigne : `prompt.ts` la pose HORS du bloc de données.
 * Les sources recommandées n'y sont pas : elles rejoignent les sources citées.
 */
function agentGuidanceBody(g: AgentGuidance, onTruncate: () => void): string {
  const clip = (value: string, maxChars: number): string => {
    const out = truncateAtBoundary(value, maxChars);
    if (out !== value) onTruncate();
    return out;
  };
  // Une consigne tient sur une ligne de liste : ses sauts de ligne se replient.
  const oneLine = (value: string) => value.replace(/\s*\n\s*/g, " ");
  const lines: string[] = ["Valables pour toutes les démarches de la collectivité."];

  if (g.roleDescription) {
    lines.push("", "Rôle des agents :", clip(demoteHeadings(g.roleDescription), LIMITS.guidanceText));
  }
  if (g.physicalReception) {
    lines.push("", "Accueil physique :", clip(demoteHeadings(g.physicalReception), LIMITS.guidanceText));
  }
  if (g.guidelines.length > 0) {
    const entries = g.guidelines.slice(0, LIMITS.guidelines);
    if (g.guidelines.length > entries.length) onTruncate();
    lines.push("", "Consignes générales :");
    for (const c of entries) {
      const title = c.title ? clip(oneLine(c.title), LIMITS.guidelineTitle) : "";
      const body = c.text ? clip(oneLine(c.text), LIMITS.guidelineText) : "";
      lines.push(`- ${title}${title && body ? " : " : ""}${body}`);
    }
  }
  if (g.faq.length > 0) {
    const entries = g.faq.slice(0, LIMITS.faqEntries);
    if (g.faq.length > entries.length) onTruncate();
    lines.push(
      "",
      "Questions fréquentes DES AGENTS, toutes démarches confondues (distinctes de celles du " +
        "service pour cette démarche) :",
    );
    entries.forEach((f, i) => {
      if (i > 0) lines.push("");
      lines.push(`Q. ${clip(f.question, LIMITS.faqQuestion)}`, `R. ${clip(f.answer, LIMITS.faqAnswer)}`);
    });
  }
  return lines.join("\n");
}

export function condenseKnowledge(
  kb: AiKnowledge,
  extracts: DocumentExtract[] = [],
  budgetTokens: number = KNOWLEDGE_BUDGET_TOKENS,
  userCommunication: UserCommunicationKnowledge | null = null,
  agentGuidance: AgentGuidance | null = null,
): CondenseResult {
  const parts: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const included: string[] = [];
  let truncated = false;
  let remaining = Math.max(budgetTokens, 0);

  const spend = (text: string, maxTokens: number): string => {
    const allowance = Math.min(maxTokens, remaining);
    if (allowance <= 0 || text.trim() === "") return "";
    const chars = tokensToChars(allowance);
    const out = truncateAtBoundary(text.trim(), chars);
    if (out.length < text.trim().length) truncated = true;
    remaining -= estimateTokens(out);
    return out;
  };

  // 1. Garde-fous — priorité absolue.
  if (kb.guardrails.length > 0) {
    const body = kb.guardrails.map((g) => `- ${g}`).join("\n");
    parts.push(block("Garde-fous (à respecter sans exception)", spend(body, LIMITS.guardrails)));
  }

  // 2. Consignes pour l'agent, 3. Procédure de traitement.
  parts.push(block("Consignes du service", spend(kb.agentHelpText, LIMITS.agentHelp)));
  parts.push(block("Procédure de traitement", spend(kb.proceduresText, LIMITS.procedures)));

  // 4. FAQ — bornée par entrée ET par nombre d'entrées.
  if (kb.faq.length > 0) {
    const entries = kb.faq.slice(0, LIMITS.faqEntries);
    if (kb.faq.length > entries.length) truncated = true;
    const body = entries
      .map((f) => {
        const q = truncateAtBoundary(f.question.trim(), LIMITS.faqQuestion);
        const a = truncateAtBoundary(f.answer.trim(), LIMITS.faqAnswer);
        return `Q. ${q}\nR. ${a}`;
      })
      .join("\n\n");
    parts.push(block("Questions fréquentes du service", spend(body, remaining)));
  }

  // 4 bis. Recommandations générales de la collectivité (Socle 1.27.0). APRÈS
  // la matière de la démarche, qui l'emporte ; AVANT les textes publics. Bloc
  // distinct : ni la FAQ ni les consignes ne se fusionnent avec celles de la
  // démarche.
  let agentGuidanceIncluded = false;
  if (agentGuidance && !isAgentGuidanceEmpty(agentGuidance)) {
    const hasBody = agentGuidance.roleDescription !== "" || agentGuidance.physicalReception !== "" ||
      agentGuidance.guidelines.length > 0 || agentGuidance.faq.length > 0;
    if (hasBody) {
      const body = spend(
        agentGuidanceBody(agentGuidance, () => { truncated = true; }),
        LIMITS.agentGuidance,
      );
      if (body !== "") {
        parts.push(block("Recommandations générales de la collectivité à ses agents", body));
        agentGuidanceIncluded = true;
      }
    }
  }

  // 4 ter. Ce que la collectivité publie pour ses usagers (contrat Socle
  // 1.24.0). APRÈS la matière du service — une consigne d'instruction pèse
  // plus qu'une page de présentation — et AVANT les documents, qui prennent le
  // reliquat. Bloc distinct de la FAQ du service : le contrat interdit de
  // fusionner les deux FAQ.
  let userCommunicationIncluded = false;
  if (userCommunication && !isUserCommunicationEmpty(userCommunication)) {
    const body = spend(
      userCommunicationBody(userCommunication, () => { truncated = true; }),
      LIMITS.userCommunication,
    );
    if (body !== "") {
      parts.push(block("Communication aux usagers (textes publiés par la collectivité)", body));
      userCommunicationIncluded = true;
    }
  }

  // 5. Documents d'entraînement — le reliquat, EN TOURNIQUET.
  const usable = extracts.filter((e) => e.text.trim() !== "");
  if (usable.length > 0) {
    // On réserve de quoi citer les sources et les liens après.
    const forDocuments = Math.max(0, remaining - 400);
    // Les courts rendent leur surplus : on sert d'abord ceux qui tiennent dans
    // leur part, et le reliquat se redistribue aux longs.
    const sorted = [...usable].sort((a, b) => a.text.length - b.text.length);
    let pool = forDocuments;
    let left = sorted.length;
    const rendered: { name: string; body: string }[] = [];

    for (const doc of sorted) {
      const allowance = left > 0 ? Math.floor(pool / left) : 0;
      if (allowance < MIN_DOCUMENT_TOKENS) {
        skipped.push({ name: doc.name, reason: "budget de contexte atteint" });
        left -= 1;
        continue;
      }
      const body = truncateAtBoundary(doc.text.trim(), tokensToChars(allowance));
      if (body.length < doc.text.trim().length) truncated = true;
      const cost = estimateTokens(body);
      pool -= cost;
      left -= 1;
      rendered.push({ name: doc.name, body });
      included.push(doc.name);
    }

    // Rendu dans l'ordre d'origine (déterminisme lisible), pas dans l'ordre de
    // tri par taille.
    const byName = new Map(rendered.map((r) => [r.name, r.body]));
    const body = usable
      .filter((d) => byName.has(d.name))
      .map((d) => `-- Document « ${d.name} » --\n${byName.get(d.name)}`)
      .join("\n\n");
    if (body !== "") {
      parts.push(block("Documents de référence du service", body));
      remaining = Math.max(0, remaining - estimateTokens(body));
    }
  }

  // 6. Sources et liens — les URL seules, jamais suivies en v1. Celles de la
  // démarche d'abord ; puis celles que la collectivité recommande pour toutes,
  // dites comme telles, sans répéter une adresse déjà citée.
  const cited = new Set<string>();
  const sourceLines: string[] = [];
  const cite = (l: { url: string; description: string }, suffix: string) => {
    if (l.url !== "" && cited.has(l.url)) return;
    if (l.url !== "") cited.add(l.url);
    sourceLines.push(`- ${l.description || l.url}${l.description && l.url ? ` (${l.url})` : ""}${suffix}`);
  };
  for (const l of [...kb.aiSources, ...kb.agentLinks]) cite(l, "");
  let recommendedSourcesCited = false;
  for (const l of agentGuidance?.recommendedSources ?? []) {
    const before = sourceLines.length;
    cite(l, " — recommandée par la collectivité pour toutes les démarches");
    if (sourceLines.length > before) recommendedSourcesCited = true;
  }
  const sources = sourceLines.join("\n");
  let sourcesText = "";
  if (sources !== "") {
    sourcesText = spend(sources, remaining);
    parts.push(block("Sources citées (non consultées par l'assistant)", sourcesText));
  }

  return {
    text: parts.filter((p) => p !== "").join("\n").trim(),
    included,
    skipped,
    truncated,
    userCommunication: userCommunicationIncluded,
    // Des sources recommandées seules suffisent à dire que le bloc a compté —
    // à condition qu'elles aient survécu au budget.
    agentGuidance: agentGuidanceIncluded || (recommendedSourcesCited && sourcesText !== ""),
  };
}
