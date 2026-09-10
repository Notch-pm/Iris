// La gamme Edilumen vue depuis Iris — LOGIQUE PURE, testée.
//
// Quatre applications, quatre sites bâtis sur le même motif :
// `<application>.edilumen.fr`. Iris n'a rien à demander à personne pour
// proposer la bascule : l'adresse se déduit de la clé, et rien d'autre ne
// transite (ni session, ni organisation — chaque produit tient son propre
// projet Supabase, cf. invariant « aucun flux base-à-base »).

export type AppKey = "socle" | "iris" | "clara" | "ariane";

export interface EdilumenApp {
  key: AppKey;
  name: string;
  /** Lettre de la pastille (en-tête, rail, menu). */
  initial: string;
  tagline: string;
}

/** Ordre de la maquette « En-tête multi-applications » (Claude Design). */
export const EDILUMEN_APPS: readonly EdilumenApp[] = [
  { key: "socle", name: "Socle", initial: "S", tagline: "Organisations et paramétrage" },
  { key: "iris", name: "Iris", initial: "I", tagline: "Demandes des usagers" },
  { key: "clara", name: "Clara", initial: "C", tagline: "Gestion du courrier" },
  { key: "ariane", name: "Ariane", initial: "A", tagline: "Gestion de file d'attente" },
];

export const CURRENT_APP_KEY: AppKey = "iris";

export const CURRENT_APP: EdilumenApp = EDILUMEN_APPS.find((a) => a.key === CURRENT_APP_KEY)!;

/** Adresse publique d'une application de la gamme. */
export function appUrl(key: AppKey): string {
  return `https://${key}.edilumen.fr`;
}
