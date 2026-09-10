// Accueil mobile : pas de tableau de bord — on va droit au travail du jour.
// Un intervenant arrive sur ses interventions, les autres sur les demandes.
// On attend les droits avant de router, sans quoi un intervenant verrait la
// liste des demandes clignoter avant d'être redirigé.

import { Navigate } from "react-router-dom";
import { useTenant } from "@/features/tenant/TenantProvider";

export function MobileHome() {
  const { current, rights, rightsLoading } = useTenant();
  if (!current || rightsLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Chargement…</p>;
  }
  return <Navigate to={rights.is_intervenant ? "/interventions" : "/demandes"} replace />;
}
