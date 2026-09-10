// Détection d'appareil — logique PURE, testée.
//
// Iris n'adapte pas ses écrans de bureau : quand un TÉLÉPHONE est détecté, des
// pages mobiles dédiées se rendent à la place (décision PO 2026-09-14). La
// détection repose sur DEUX choses, et rien d'autre :
//
//   · la LARGEUR d'écran (`max-width: 767px`) — c'est ce que l'écran doit
//     réellement absorber ; une tablette (≥ 768 px) garde donc le bureau ;
//   · un COMMUTATEUR manuel, mémorisé sur l'appareil, qui PRIME : un agent sur
//     téléphone peut ouvrir la version bureau, un poste à petite fenêtre peut y
//     revenir. La détection n'est jamais une impasse.
//
// Jamais le User-Agent : il est figé (iPadOS se déclare Mac, Chrome le réduit)
// et ment plus souvent qu'un `matchMedia`. Le pointeur grossier
// (`pointer: coarse`) reste réservé au choix de la caméra (`CameraCapture`) :
// il ferait basculer les tablettes, ce que le PO ne veut pas.

export type DeviceMode = "mobile" | "desktop";
/** Le choix de l'utilisateur ; `null` = détection automatique. */
export type DeviceOverride = DeviceMode | null;

export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
export const DEVICE_OVERRIDE_KEY = "iris.device-override";

export function parseOverride(raw: string | null | undefined): DeviceOverride {
  return raw === "mobile" || raw === "desktop" ? raw : null;
}

export interface DeviceSignals {
  /** `matchMedia(MOBILE_MEDIA_QUERY).matches` */
  viewportNarrow: boolean;
  override: DeviceOverride;
}

/** Le commutateur prime ; sinon, la largeur décide. */
export function resolveDevice(signals: DeviceSignals): DeviceMode {
  if (signals.override) return signals.override;
  return signals.viewportNarrow ? "mobile" : "desktop";
}

export const DEVICE_MODE_LABELS: Record<DeviceMode, string> = {
  mobile: "Version mobile",
  desktop: "Version bureau",
};

/** L'entrée de menu à proposer : basculer vers l'AUTRE version. */
export function switchTarget(mode: DeviceMode): DeviceMode {
  return mode === "mobile" ? "desktop" : "mobile";
}
