// Lectures du référentiel qui nourrissent les prompts IA — partagées par
// `request-assistant` et `request-email-assistant`. Avec la clé de service :
// la base de connaissances COMPLÈTE (la part agent comme la matière de l'IA),
// que `socle-proxy` ne relaie jamais entière au navigateur.
//
// `undefined` = référentiel muet : l'appelant répond quand même, en le disant.
// Un Socle injoignable ne doit pas faire taire l'assistant.
//
// Dépend de Deno (env, fetch) : hors du périmètre des tests purs.

import { parseAiKnowledge, type AiKnowledge } from "./knowledge.ts";
import { publicApiBase } from "./socleClient.ts";
import {
  parseUserCommunicationKnowledge,
  type UserCommunicationKnowledge,
} from "./userCommunication.ts";
import {
  sanitizeAgentGuidanceView,
  type AgentGuidance,
} from "../organizations/agentGuidance.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ProcedureKnowledge {
  kb: AiKnowledge;
  userCommunication: UserCommunicationKnowledge;
  name: string | null;
}

/**
 * La démarche, lue dans le Socle. La même réponse porte, depuis le contrat
 * 1.24.0, ce que la collectivité publie pour ses usagers (`user_communication`,
 * `user_description`) : aucun second appel, et la même défense de périmètre.
 */
export async function socleKnowledge(
  procedureId: string,
  socleRootId: string,
  logLabel: string,
): Promise<ProcedureKnowledge | undefined> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) return undefined;
  const res = await fetch(`${base}/v1/procedures/${procedureId}`, {
    headers: { Authorization: `Bearer ${key}`, "X-Organization-Id": socleRootId },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`${logLabel}: démarche ${procedureId} illisible (${res?.status ?? "réseau"})`);
    return undefined;
  }
  const procedure = await res.json().catch(() => null);
  if (!isRecord(procedure)) return undefined;
  // Défense en profondeur : la démarche doit appartenir au tenant demandé.
  if (procedure.organization_id !== socleRootId) {
    console.error(`${logLabel}: démarche hors du tenant — ignorée`);
    return undefined;
  }
  return {
    kb: parseAiKnowledge(procedure.knowledge_base),
    userCommunication: parseUserCommunicationKnowledge(procedure),
    name: typeof procedure.name === "string" ? procedure.name : null,
  };
}

/**
 * Recommandations générales de la collectivité à ses agents (Socle 1.27.0),
 * lues sur la racine du tenant — elles valent pour TOUTES ses démarches, y
 * compris une demande historique sans démarche. Rien d'écrit = une structure
 * vide, que `condenseKnowledge` ignore.
 */
export async function socleAgentGuidance(
  socleRootId: string,
  logLabel: string,
): Promise<AgentGuidance | undefined> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) return undefined;
  const res = await fetch(`${base}/v1/organizations/${socleRootId}/agent-guidance`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`${logLabel}: recommandations générales illisibles (${res?.status ?? "réseau"})`);
    return undefined;
  }
  const body = await res.json().catch(() => null);
  if (!isRecord(body)) return undefined;
  return sanitizeAgentGuidanceView(body).guidance;
}
