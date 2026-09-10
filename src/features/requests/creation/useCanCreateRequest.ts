// « Puis-je créer une demande ? » — UNE règle pour toutes les entrées vers le
// parcours de création (tableau de bord, bouton de la liste, onglet mobile) :
// au moins un couple (organisme, démarche) à la fois dans mes droits de
// CRÉATION et ACTIVÉ dans le Socle (`creatableByOrganisation`, 2026-08-31).
// Sans le croisement, l'entrée mènerait à un parcours vide. Reflet de
// confort : le serveur revalide le couple, `t18` refuse une démarche non activée.

import { useTenant } from "@/features/tenant/TenantProvider";
import { useSocleProcedureActivations, useSocleProceduresCatalog } from "@/features/socle/useSocleCatalog";
import { activationsByOrganisation, creatableByOrganisation } from "./proposables";

export function useCanCreateRequest(): boolean {
  const { current, rights } = useTenant();
  const orgId = current?.organizationId ?? "";
  const procCatalog = useSocleProceduresCatalog(orgId);
  const activations = useSocleProcedureActivations(orgId);
  if (!orgId) return false;
  if (rights.is_platform_admin) return true;
  const cacheIds = (procCatalog.data ?? []).map((o) => o.value);
  return creatableByOrganisation(rights, cacheIds, activationsByOrganisation(activations.data ?? [])).size > 0;
}
