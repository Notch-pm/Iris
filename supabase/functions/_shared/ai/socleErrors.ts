/**
 * Ce que devient, pour l'agent, un refus du Socle.
 *
 * Depuis la centralisation, Iris n'appelle plus Mistral : il appelle le
 * guichet IA du Socle. Les erreurs traversent donc une frontière de plus, et
 * chacune doit être retraduite — pas relayée telle quelle.
 *
 * DEUX RÈGLES QUI GOUVERNENT CETTE TABLE :
 *
 *  1. **Une erreur d'authentification n'est JAMAIS relayée** (motif
 *     `relaySocleError` de `socle-proxy`). Un 401/403 du Socle veut dire que
 *     la clé d'Iris est mauvaise, révoquée, sans le scope « ai » ou sans
 *     imputation : c'est une panne de configuration, pas un problème de
 *     l'agent. Il reçoit « signaler à un administrateur », pas le détail.
 *
 *  2. **Un 400 du Socle est NOTRE bug, pas celui de l'agent.** Iris compose le
 *     payload : si le Socle le refuse, c'est qu'Iris a mal composé. L'agent
 *     reçoit une erreur interne, et la trace part dans les journaux.
 *
 * ⚠️ Le 429 fait exception à la règle « ne rien relayer » : son message vient
 * du Socle **mot pour mot**, parce que le Socle est désormais propriétaire de
 * la période et de la date de renouvellement. Le recomposer ici recréerait le
 * jumeau que la centralisation vient de supprimer — et un jumeau qui dérive
 * ferait mentir la date.
 *
 * Module PUR, testé.
 */

export interface MappedFailure {
  status: number;
  code: string;
  message: string;
}

/** Le cas neuf de la centralisation : le référentiel ne répond pas. */
export const SOCLE_UNREACHABLE: MappedFailure = {
  status: 502,
  code: "assistant_unavailable",
  message:
    "L'assistant est indisponible : le référentiel ne répond pas. " +
    "L'instruction des demandes n'est pas affectée.",
};

const PROVIDER_DOWN: MappedFailure = {
  status: 502,
  code: "ai_unavailable",
  message: "L'assistant est momentanément indisponible — réessayez dans un instant.",
};

const NOT_CONFIGURED: MappedFailure = {
  status: 503,
  code: "not_configured",
  message: "L'assistant IA n'est pas configuré sur la plateforme.",
};

const AUTH_FAILED: MappedFailure = {
  status: 502,
  code: "socle_auth_failed",
  message: "Authentification au Référentiel en échec — signaler à un administrateur.",
};

const OUR_BUG: MappedFailure = {
  status: 500,
  code: "internal_error",
  message: "Erreur interne — l'assistant n'a pas pu être interrogé.",
};

function socleMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() !== "" ? message : null;
}

/**
 * `status === null` ⇒ aucune réponse (réseau, délai dépassé) : le Socle est
 * injoignable, et c'est le seul cas où l'agent apprend que le problème vient
 * du référentiel — parce que c'est actionnable pour lui : il peut continuer à
 * instruire.
 */
export function mapSocleFailure(status: number | null, body: unknown): MappedFailure {
  if (status === null) return SOCLE_UNREACHABLE;

  if (status === 429) {
    // La seule phrase relayée mot pour mot : elle nomme la date de
    // renouvellement, que seul le Socle connaît.
    const message = socleMessage(body);
    return {
      status: 429,
      code: "ai_quota_exceeded",
      message: message ??
        "Le plafond d'utilisation de l'assistant IA est atteint pour ce mois.",
    };
  }
  if (status === 503) return NOT_CONFIGURED;
  if (status === 401 || status === 403) return AUTH_FAILED;
  if (status === 400 || status === 404) return OUR_BUG;
  // 502 du Socle (fournisseur muet), 500, et tout le reste.
  return PROVIDER_DOWN;
}
