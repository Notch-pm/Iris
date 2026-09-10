// Barre basse mobile — logique PURE, testée. Maquette « Iris mobile — v2 »
// (2026-09-14) : TROIS onglets au plus (Demandes, Interventions, Moi) et un
// bouton rond « Créer » au centre, au pouce. Un pouce ne vise pas juste
// au-delà de quatre cibles.
//
// Deux natures d'entrée : les ONGLETS mènent à une route (activation par
// `isNavRouteActive`, comme le rail de bureau — « Demandes » et « Créer »
// partagent le préfixe `/demandes`) ; « Moi » ouvre la feuille du compte SUR
// PLACE, sans quitter l'écran.

import type { NavRoute } from "../nav";

export type MobileNavKey = "demandes" | "interventions" | "creer" | "moi";

export type MobileNavItem =
  | { kind: "tab"; key: "demandes" | "interventions"; label: string; route: NavRoute }
  | { kind: "create"; key: "creer"; label: string; route: NavRoute }
  | { kind: "account"; key: "moi"; label: string };

export interface MobileNavInput {
  /** Profil « Intervenant » actif dans le tenant (`my_rights.is_intervenant`). */
  isIntervenant: boolean;
  /** Au moins un couple (organisme, démarche) créable ET activé — même règle que le bouton « Nouvelle demande ». */
  canCreate: boolean;
}

export function mobileNavItems(input: MobileNavInput): MobileNavItem[] {
  const items: MobileNavItem[] = [
    { kind: "tab", key: "demandes", label: "Demandes", route: { to: "/demandes", end: false, except: ["/demandes/nouvelle"] } },
  ];
  if (input.isIntervenant) {
    items.push({ kind: "tab", key: "interventions", label: "Interventions", route: { to: "/interventions", end: false } });
  }
  if (input.canCreate) {
    items.push({ kind: "create", key: "creer", label: "Créer", route: { to: "/demandes/nouvelle", end: false } });
  }
  items.push({ kind: "account", key: "moi", label: "Moi" });
  return items;
}
