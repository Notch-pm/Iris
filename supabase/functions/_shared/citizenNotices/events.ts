// Avis à l'usager (B12) — les ÉVÉNEMENTS. Module PUR, testé.
//
// Le trigger t41 n'enfile que des faits bruts (de, vers). Le facteur compare,
// AU MOMENT DE L'ENVOI, le statut COURANT de la demande au statut que l'usager
// CONNAÎT (`request_citizen_status`) : une rafale « en attente puis reprise »
// revient au point de départ et ne produit rien. Ce module nomme ce qui a
// changé POUR L'USAGER — un catalogue fermé, que le réglage par événement du
// second temps (ADR-8) réutilisera tel quel.

/** Le catalogue FERMÉ des événements nommés. */
export const CITIZEN_EVENTS = [
  "prise_en_charge",
  "attente_information",
  "reprise_instruction",
  "annulation",
  "reouverture",
  "renvoi_qualification",
  "archivage",
  "resolution",
  "aucun_changement",
] as const;
export type CitizenEvent = (typeof CITIZEN_EVENTS)[number];

const TERMINAL = new Set(["annulee", "resolue_positive", "resolue_negative", "archivee"]);

/**
 * Ce que l'usager lit d'un statut — libellés du portail, pas ceux de l'agent :
 * « En attente d'information » se lit, côté usager, « En attente de votre réponse ».
 */
export const CITIZEN_STATUS_LABELS: Record<string, string> = {
  a_traiter: "Envoyée",
  en_instruction: "En cours de traitement",
  en_attente: "En attente de votre réponse",
  annulee: "Annulée",
  resolue_positive: "Traitée",
  resolue_negative: "Traitée",
  archivee: "Traitée",
};

/** `known` absent : la demande n'a jamais été notifiée — on part du statut connu au dépôt. */
export function citizenEventFor(known: string | null, current: string): CitizenEvent {
  const from = known ?? "a_traiter";
  if (from === current) return "aucun_changement";
  switch (current) {
    case "en_instruction":
      if (TERMINAL.has(from)) return "reouverture";
      if (from === "en_attente") return "reprise_instruction";
      return "prise_en_charge";
    case "en_attente":
      return "attente_information";
    case "annulee":
      return "annulation";
    case "resolue_positive":
    case "resolue_negative":
      return "resolution";
    case "archivee":
      return "archivage";
    case "a_traiter":
      // Une demande close renvoyée à qualifier : pour l'usager, elle est rouverte.
      return TERMINAL.has(from) ? "reouverture" : "renvoi_qualification";
    default:
      return "aucun_changement";
  }
}
