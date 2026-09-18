/**
 * Publics ADMIS au dépôt d'une démarche — ceux que son `requester_config`
 * active (`citoyen`, `entreprise`, `association`).
 *
 * C'est la lecture que le Socle publie lui-même au portail (`audiences`, dérivé
 * de `requester_config` par `readAudiences`) : le filtre « Je suis… ». Iris la
 * lit pour la même raison, afficher « public concerné » sur une tuile de
 * démarche sans charger sa fiche.
 *
 * ⚠️ Une démarche sans aucun public activé rend une liste VIDE : on ne suppose
 * rien (le repli sur « citoyen » de `selectableAudiences` sert à ne jamais
 * bloquer une SAISIE, pas à faire une affirmation).
 *
 * Deux lecteurs : `socle-proxy` (résumé d'une démarche, à partir du
 * `requester_config` brut) et le navigateur (re-parse par défiance de la liste
 * relayée — `parseAudiences`, idempotent).
 *
 * Module PUR (aucune dépendance), testé.
 */

export const AUDIENCE_KEYS = ["citoyen", "entreprise", "association"] as const;
export type AudienceKey = (typeof AUDIENCE_KEYS)[number];

/** Les libellés de l'écran d'identification du demandeur (`procedureForm.AUDIENCES`). */
export const AUDIENCE_LABELS: Record<AudienceKey, string> = {
  citoyen: "Citoyen",
  entreprise: "Entreprise",
  association: "Association",
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** `requester_config` brut → publics activés, dans l'ordre du contrat. */
export function readAudiences(rawRequesterConfig: unknown): AudienceKey[] {
  const config = record(rawRequesterConfig);
  if (!config) return [];
  return AUDIENCE_KEYS.filter((key) => record(config[key])?.enabled === true);
}

/** Liste relayée → publics connus, dédoublonnés, dans l'ordre du contrat. Idempotente. */
export function parseAudiences(raw: unknown): AudienceKey[] {
  if (!Array.isArray(raw)) return [];
  return AUDIENCE_KEYS.filter((key) => raw.includes(key));
}
