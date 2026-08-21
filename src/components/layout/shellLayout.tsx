import * as React from "react";

// Les pages « pleine hauteur » (parcours de création : zones défilantes
// propres, rail latéral, pied d'actions) demandent au shell de retirer son
// gabarit centré et son padding. Portée : le temps du montage de la page.

interface ShellLayoutContextValue {
  setFullBleed: (value: boolean) => void;
}

export const ShellLayoutContext = React.createContext<ShellLayoutContextValue | null>(null);

export function useFullBleedLayout() {
  const ctx = React.useContext(ShellLayoutContext);
  React.useEffect(() => {
    if (!ctx) return;
    ctx.setFullBleed(true);
    return () => ctx.setFullBleed(false);
  }, [ctx]);
}
