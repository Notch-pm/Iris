// Bascule par route, MÊME URL : une adresse, deux rendus. Le permalien d'un
// e-mail (`/demandes/<id>`) ouvre donc la fiche mobile sur un téléphone, sans
// espace `/m/` à part. Sans variante mobile, l'écran d'orientation dit que la
// fonction se fait sur ordinateur — et offre la version bureau.

import * as React from "react";
import { useDevice } from "./DeviceProvider";
import { MobileOnlyOrientation } from "./MobileOnlyOrientation";

interface Props {
  desktop: React.ReactElement;
  /** Absente ⇒ écran d'orientation sur mobile. */
  mobile?: React.ReactElement;
}

export function Adaptive({ desktop, mobile }: Props) {
  const { isMobile } = useDevice();
  if (!isMobile) return desktop;
  return mobile ?? <MobileOnlyOrientation />;
}
