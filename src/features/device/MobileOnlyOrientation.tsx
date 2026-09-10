// Écran d'orientation (mobile) : cette fonction n'a pas de version mobile.
// Jamais une impasse — le bouton ouvre la version bureau SUR PLACE (même
// URL, le commutateur bascule le rendu), et un lien ramène aux écrans faits
// pour le téléphone.

import { Link } from "react-router-dom";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/features/tenant/TenantProvider";
import { useDevice } from "./DeviceProvider";

interface Props {
  /** Ce que l'écran nomme (« La carte des interventions ») ; défaut générique. */
  feature?: string;
}

export function MobileOnlyOrientation({ feature }: Props) {
  const { setOverride } = useDevice();
  const { rights } = useTenant();
  const home = rights.is_intervenant ? "/interventions" : "/demandes";

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Monitor className="size-7" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-bold">
        {feature ? `${feature} se consulte sur ordinateur.` : "Cette fonction se fait sur ordinateur."}
      </h1>
      <p className="text-sm text-muted-foreground">
        Sur téléphone, Iris propose vos interventions, les demandes et leur fiche. Le reste
        de l'application reste accessible en version bureau.
      </p>
      <Button type="button" onClick={() => setOverride("desktop")}>
        Ouvrir la version bureau
      </Button>
      <Link to={home} className="text-sm font-semibold text-primary hover:underline">
        {rights.is_intervenant ? "Retour à mes interventions" : "Retour aux demandes"}
      </Link>
    </div>
  );
}
