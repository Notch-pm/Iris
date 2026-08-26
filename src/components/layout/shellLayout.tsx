import * as React from "react";

// Gabarit horizontal du shell, demandé par la page montée :
//   « default » — colonne centrée à 1240px (formulaires, fiches de réglages :
//                 la largeur de lecture prime) ;
//   « wide »    — pleine largeur, padding du shell conservé (listes denses :
//                 le tableau se sert de tout l'écran) ;
//   « full »    — pleine hauteur sans gabarit ni padding (parcours de
//                 création, carte : zones défilantes propres, pied d'actions).
// Portée : le temps du montage de la page.

export type ShellWidth = "default" | "wide" | "full";

interface ShellLayoutContextValue {
  setWidth: (value: ShellWidth) => void;
}

export const ShellLayoutContext = React.createContext<ShellLayoutContextValue | null>(null);

function useShellWidth(width: ShellWidth) {
  const ctx = React.useContext(ShellLayoutContext);
  React.useEffect(() => {
    if (!ctx) return;
    ctx.setWidth(width);
    return () => ctx.setWidth("default");
  }, [ctx, width]);
}

/** Page pleine hauteur : le shell retire son gabarit centré et son padding. */
export function useFullBleedLayout() {
  useShellWidth("full");
}

/** Liste dense : le shell garde son padding mais retire son plafond de largeur. */
export function useWideLayout() {
  useShellWidth("wide");
}
