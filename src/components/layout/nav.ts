// Activation d'une entrée du rail — LOGIQUE PURE, testée.
//
// `NavLink` d'un `to` non exact allume l'entrée sur tout le sous-arbre d'URL,
// ce qui ne suffit plus dès que deux entrées partagent un préfixe : sur
// `/demandes/tableau`, « Demandes » ET « Tableau des demandes » s'allumeraient.
// D'où `except` — les sous-chemins qui ont LEUR PROPRE entrée.

export interface NavRoute {
  to: string;
  /** Correspondance exacte seulement (l'accueil : sinon toute URL commence par « / »). */
  end: boolean;
  /** Sous-chemins possédant leur propre entrée de rail, donc soustraits à celle-ci. */
  except?: string[];
}

export function isNavRouteActive(route: NavRoute, pathname: string): boolean {
  if (route.end) return pathname === route.to;
  const claimedElsewhere = (route.except ?? []).some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (claimedElsewhere) return false;
  return pathname === route.to || pathname.startsWith(`${route.to}/`);
}
