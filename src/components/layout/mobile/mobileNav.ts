// Onglets de la barre basse mobile — logique PURE, testée. Quatre entrées au
// plus : un pouce ne vise pas juste au-delà. L'activation vient de
// `isNavRouteActive` (nav.ts), comme pour le rail de bureau : « Demandes »
// et « Nouvelle » partagent le préfixe `/demandes`.

import type { NavRoute } from "../nav";

export type MobileNavKey = "interventions" | "demandes" | "nouvelle" | "compte";

export interface MobileNavItem extends NavRoute {
  key: MobileNavKey;
  label: string;
}

export interface MobileNavInput {
  /** Profil « Intervenant » actif dans le tenant (`my_rights.is_intervenant`). */
  isIntervenant: boolean;
  /** Au moins un couple (organisme, démarche) créable ET activé — même règle que le bouton « Nouvelle demande ». */
  canCreate: boolean;
}

export function mobileNavItems(input: MobileNavInput): MobileNavItem[] {
  const items: MobileNavItem[] = [];
  if (input.isIntervenant) {
    items.push({ key: "interventions", label: "Interventions", to: "/interventions", end: false });
  }
  items.push({ key: "demandes", label: "Demandes", to: "/demandes", end: false, except: ["/demandes/nouvelle"] });
  if (input.canCreate) {
    items.push({ key: "nouvelle", label: "Nouvelle", to: "/demandes/nouvelle", end: false });
  }
  items.push({ key: "compte", label: "Compte", to: "/mon-compte", end: false });
  return items;
}
