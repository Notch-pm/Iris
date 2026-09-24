// Appel au guichet IA du Socle (`ai-api`) — partagé par `request-assistant`
// et `request-email-assistant`.
//
// Ce qu'Iris envoie : le prompt système QU'IL A COMPOSÉ, la conversation, un
// alias d'agent, et des références opaques. Ce qu'il n'envoie pas : ni modèle,
// ni agent réel, ni imputation — l'imputation vient de la clé, et le Socle la
// refuserait dans le corps. Iris décide ce qui est dit ; le Socle décide si ça
// peut l'être et ce que ça a coûté.
//
// ⚠️ CHAÎNE DE DÉLAIS, À NE PAS INVERSER : Mistral 55 s < Socle 60 s < Iris
// 75 s. Inversée, Iris abandonne des appels que le Socle termine et facture —
// et l'agent, en réessayant, paie deux fois.
//
// Dépend de Deno (env, fetch) : hors du périmètre des tests purs.

import type { ChatMessage } from "./messages.ts";
import { estimateCall } from "./tokens.ts";

/** 75 s : le dernier maillon de la chaîne, plus long que le Socle (60 s). */
export const SOCLE_TIMEOUT_MS = 75_000;

export function publicApiBase(): string {
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "");
}

/**
 * Base de `ai-api`, dérivée de celle du référentiel — les edge functions d'un
 * même projet ne diffèrent que par leur dernier segment.
 */
export function aiApiBase(): string {
  const base = publicApiBase();
  return base === "" ? "" : base.replace(/public-api$/, "ai-api");
}

/** L'instance est-elle raccordée au guichet ? (clé Socle d'Iris, scope « ai »). */
export function aiConfigured(): boolean {
  return aiApiBase() !== "" && Boolean(Deno.env.get("SOCLE_API_KEY"));
}

export type SocleOutcome =
  | { ok: true; answer: string }
  | { ok: false; status: number | null; body: unknown };

export interface SocleCall {
  system: string;
  messages: ChatMessage[];
  /** Fonctionnalité imputée au journal du Socle. */
  feature: string;
  /** Alias logique d'agent : le Socle le résout, Iris ne connaît pas le modèle. */
  agent: string;
  maxOutputTokens: number;
  /** TOUJOURS dérivé côté serveur du tenant vérifié. */
  socleOrgId: string;
  reference: { kind: "request" | "procedure"; id: string } | null;
  userId: string;
  /** Préfixe des journaux d'erreur (nom de l'edge function). */
  logLabel: string;
}

export async function askSocle(call: SocleCall): Promise<SocleOutcome> {
  const base = aiApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) {
    console.error(`${call.logLabel}: SOCLE_API_URL ou SOCLE_API_KEY absente`);
    return { ok: false, status: 503, body: null };
  }

  const res = await fetch(`${base}/v1/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Organization-Id": call.socleOrgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      feature: call.feature,
      agent: call.agent,
      system: call.system,
      messages: call.messages,
      max_output_tokens: call.maxOutputTokens,
      // Indication seulement : le Socle recalcule et retient le maximum.
      estimated_tokens: estimateCall({
        system: call.system, messages: call.messages, maxOutput: call.maxOutputTokens,
      }),
      reference: call.reference,
      actor_id: call.userId,
    }),
    signal: AbortSignal.timeout(SOCLE_TIMEOUT_MS),
  }).catch(() => null);

  // Pas de réponse : réseau, délai dépassé, Socle à terre. `status: null` est
  // le seul cas où l'agent apprend que le référentiel est en cause — parce que
  // c'est actionnable pour lui.
  if (!res) return { ok: false, status: null, body: null };

  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, body };

  // Le `usage` et le `quota` de la réponse ne sont PAS relus ici : le journal
  // et le compteur du Socle font foi, et une seconde comptabilité côté Iris ne
  // pourrait que diverger. Seule la réponse nous intéresse.
  const answer = typeof body === "object" && body !== null
    ? (body as { answer?: unknown }).answer
    : null;
  if (typeof answer !== "string" || answer.trim() === "") {
    console.error(`${call.logLabel}: réponse du guichet IA vide ou inattendue`);
    return { ok: false, status: 502, body: null };
  }
  return { ok: true, answer: answer.trim() };
}
