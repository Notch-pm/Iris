// Fournisseur d'appareil : « sommes-nous sur un téléphone ? » — largeur d'écran
// suivie en direct (`matchMedia`), commutateur mémorisé sur l'appareil
// (localStorage, jamais plus loin : c'est un réglage de CET écran, pas du
// compte). La règle vit dans `src/lib/device.ts`, pur et testé.
//
// Monté à la RACINE de l'application (au-dessus d'`AuthProvider`) : les routes
// publiques pourront s'en servir — un intervenant reçoit son invitation sur
// son téléphone.

import * as React from "react";
import {
  DEVICE_OVERRIDE_KEY, MOBILE_MEDIA_QUERY, parseOverride, resolveDevice,
  type DeviceMode, type DeviceOverride,
} from "@/lib/device";

interface DeviceContextValue {
  mode: DeviceMode;
  isMobile: boolean;
  /** La largeur seule, sans le commutateur — pour dire « détection automatique : mobile ». */
  viewportNarrow: boolean;
  override: DeviceOverride;
  setOverride: (value: DeviceOverride) => void;
}

const DeviceContext = React.createContext<DeviceContextValue | undefined>(undefined);

function readOverride(): DeviceOverride {
  try {
    return parseOverride(localStorage.getItem(DEVICE_OVERRIDE_KEY));
  } catch {
    return null;
  }
}

function writeOverride(value: DeviceOverride) {
  try {
    if (value) localStorage.setItem(DEVICE_OVERRIDE_KEY, value);
    else localStorage.removeItem(DEVICE_OVERRIDE_KEY);
  } catch {
    // Navigation privée ou stockage bloqué : le choix vaut pour la session en cours.
  }
}

function matchesNarrow(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [viewportNarrow, setViewportNarrow] = React.useState<boolean>(matchesNarrow);
  const [override, setOverrideState] = React.useState<DeviceOverride>(readOverride);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setViewportNarrow(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setOverride = React.useCallback((value: DeviceOverride) => {
    writeOverride(value);
    setOverrideState(value);
  }, []);

  const mode = resolveDevice({ viewportNarrow, override });
  const value = React.useMemo<DeviceContextValue>(
    () => ({ mode, isMobile: mode === "mobile", viewportNarrow, override, setOverride }),
    [mode, viewportNarrow, override, setOverride],
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  const ctx = React.useContext(DeviceContext);
  if (!ctx) throw new Error("useDevice must be used within a DeviceProvider");
  return ctx;
}
