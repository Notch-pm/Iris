// « Fiche démarche » — ce qu'un agent peut lire d'une démarche AVANT de la
// choisir au guichet : ce que la collectivité écrit pour l'usager (contrat
// public-api 1.24.0), et ce que le service écrit pour l'agent (la part agent
// de la base de connaissances).
//
// Tout est relu dans le Socle à l'ouverture (`socle-proxy /v1/procedures/get`),
// rien n'est conservé dans Iris. Le proxy a déjà whitelisté ; ce module
// re-parse par défiance, avec LES MÊMES fonctions (idempotentes), et prépare
// ce que l'écran affiche.
//
// Module PUR (ni React ni réseau), testé.

import {
  emptyKnowledge,
  knowledgeCounts,
  parseAgentKnowledge,
  type AgentKnowledge,
} from "@fn/socle-proxy/_shared/knowledge";
import {
  isUserCommunicationEmpty,
  parseUserCommunication,
  processingTimeLabel,
  type UserCommunication,
} from "@fn/_shared/procedures/userCommunication";
import { admittedAudiences, formPieces, type FormPiece } from "@fn/_shared/procedures/deposit";

export type FicheTab = "usager" | "consignes" | "vigilance" | "procedure" | "faq" | "liens" | "assistant";

export interface ProcedureFiche {
  name: string;
  /** Descriptif usager (Markdown) — colonne `user_description`, voisine du bloc. */
  description: string;
  /** Durée de SAISIE du formulaire, en minutes. ⚠️ Pas le délai de réponse. */
  inputDurationMinutes: number | null;
  /** Durée habituelle d'INSTRUCTION annoncée, libellée. `null` = non annoncée. */
  processingTime: string | null;
  userCommunication: UserCommunication | null;
  /**
   * Faux quand la passerelle n'a PAS relayé le bloc (proxy antérieur au
   * contrat 1.24.0). À ne pas confondre avec `null`, « rien d'écrit » : l'écran
   * ne doit pas dire que la collectivité n'a rien écrit quand il n'a rien lu.
   */
  userCommunicationRelayed: boolean;
  /** Publics admis au dépôt (`requester_config`) — font foi. */
  admittedAudiences: string[];
  /** Pièces du formulaire de dépôt — font foi. `null` = formulaire illisible. */
  formPieces: FormPiece[] | null;
  knowledge: AgentKnowledge;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseProcedureFiche(raw: unknown): ProcedureFiche {
  const proc = record(raw) ?? {};
  const uc = parseUserCommunication(proc.user_communication);
  const minutes = proc.input_duration_minutes;
  return {
    name: typeof proc.name === "string" ? proc.name : "",
    description: typeof proc.user_description === "string" ? proc.user_description.trim() : "",
    inputDurationMinutes: typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
      ? Math.round(minutes)
      : null,
    processingTime: processingTimeLabel(uc?.delays),
    userCommunication: uc,
    userCommunicationRelayed: "user_communication" in proc,
    admittedAudiences: admittedAudiences(proc.requester_config),
    formPieces: formPieces(proc.form_schema),
    knowledge: record(proc.knowledge_base) ? parseAgentKnowledge(proc.knowledge_base) : emptyKnowledge(),
  };
}

/** « ≈ 10 min », « ≈ 1 h 30 ». `null` sans durée renseignée. */
export function inputDurationLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `≈ ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `≈ ${h} h` : `≈ ${h} h ${String(m).padStart(2, "0")}`;
}

/** La collectivité a-t-elle écrit quoi que ce soit pour ses usagers ? */
export function hasUserContent(fiche: ProcedureFiche): boolean {
  return fiche.description !== "" || !isUserCommunicationEmpty(fiche.userCommunication);
}

export interface FicheNavItem {
  tab: FicheTab;
  label: string;
  /** Pastille de volume (garde-fous, questions, liens). */
  count?: number;
}

/**
 * Entrées « Interne — agent » à proposer : seulement celles qui ont quelque
 * chose à montrer. Un onglet vide serait une promesse que l'écran ne tient pas.
 * Liste vide ⇒ le service n'a rien documenté, et l'écran le dit en une ligne.
 */
export function internalNav(knowledge: AgentKnowledge): FicheNavItem[] {
  const c = knowledgeCounts(knowledge);
  const items: FicheNavItem[] = [];
  if (c.aide) items.push({ tab: "consignes", label: "Consignes" });
  if (c.guardrails > 0) items.push({ tab: "vigilance", label: "Points de vigilance", count: c.guardrails });
  if (c.procedures) items.push({ tab: "procedure", label: "Procédure de traitement" });
  if (c.faq > 0) items.push({ tab: "faq", label: "FAQ agent", count: c.faq });
  if (c.links + c.documents > 0) {
    items.push({ tab: "liens", label: "Liens et documents", count: c.links + c.documents });
  }
  return items;
}

/**
 * L'onglet réellement affiché : celui qu'on demande s'il existe encore pour
 * CETTE démarche, sinon « Ce que voit l'usager ». Ouvrir la fiche d'une autre
 * démarche sur « FAQ agent » alors qu'elle n'en a pas ne doit pas montrer un
 * panneau vide.
 */
export function resolveTab(requested: FicheTab, fiche: ProcedureFiche | null): FicheTab {
  if (requested === "usager" || requested === "assistant") return requested;
  if (!fiche) return requested;
  return internalNav(fiche.knowledge).some((i) => i.tab === requested) ? requested : "usager";
}
