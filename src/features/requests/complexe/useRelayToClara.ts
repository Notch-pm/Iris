// « Demande complexe » relayée à Clara — données de l'écran.
//
// Iris ne conserve rien : la mutation envoie le texte et les fichiers à l'edge
// function `relay-courrier-clara`, qui les vérifie et les transmet à Clara.
// Aucune requête n'est invalidée — il n'y a rien à relire dans Iris.

import { useMutation } from "@tanstack/react-query";
import type { ConsentKind } from "@fn/_shared/consents/catalog";
import type { RelayRequester } from "@fn/_shared/clara/relay";
import { invokeEdgeForm } from "@/lib/edge";
import { useTenant } from "@/features/tenant/TenantProvider";
import { relayOrganizationIds } from "@/features/rights/rights";
import { useSocleOrganizationsCatalog } from "@/features/socle/useSocleCatalog";

export interface RelayOrganisation {
  id: string;
  label: string;
}

/**
 * Organismes vers lesquels l'agent peut relayer (droit de création sur au
 * moins une démarche — reflet, le serveur revérifie), triés par nom.
 * Admin plateforme : tout le miroir du tenant, comme la garde SQL.
 */
export function useRelayOrganisations(): { organisations: RelayOrganisation[]; isLoading: boolean } {
  const { current, rights } = useTenant();
  const orgId = current?.organizationId ?? "";
  const catalog = useSocleOrganizationsCatalog(orgId);
  const allowed = rights.is_platform_admin ? null : relayOrganizationIds(rights);
  const organisations = (catalog.data ?? [])
    .filter((o) => allowed === null || allowed.has(o.value))
    .map((o) => ({ id: o.value, label: o.label }));
  return { organisations, isLoading: catalog.isLoading };
}

/** L'agent peut-il relayer une demande complexe, vers au moins un organisme ? */
export function useCanRelayToClara(): boolean {
  const { organisations } = useRelayOrganisations();
  return organisations.length > 0;
}

export interface RelayInput {
  submissionId: string;
  socleOrganizationId: string;
  body: string;
  files: File[];
  requester: RelayRequester;
  consents: Record<ConsentKind, boolean>;
}

export interface RelayResult {
  /** Référence du courrier dans le registre de Clara (`chrono`), si Clara en a donné une. */
  reference: string | null;
  /** Le même dépôt avait déjà été reçu : Clara a rendu le courrier existant. */
  duplicate: boolean;
  /** Libellé de l'organisme, relu par le serveur dans le miroir. */
  organisme: string;
}

export function useRelayToClara() {
  const { current } = useTenant();
  return useMutation({
    mutationFn: async (input: RelayInput): Promise<RelayResult> => {
      const form = new FormData();
      form.append("organization_id", current?.organizationId ?? "");
      form.append("socle_organization_id", input.socleOrganizationId);
      form.append("submission_id", input.submissionId);
      form.append("body", input.body);
      form.append("requester", JSON.stringify(input.requester));
      form.append(
        "consents",
        JSON.stringify(Object.entries(input.consents).map(([kind, granted]) => ({ kind, granted }))),
      );
      for (const file of input.files) form.append("files", file, file.name);
      return await invokeEdgeForm<RelayResult>("relay-courrier-clara", form);
    },
  });
}
