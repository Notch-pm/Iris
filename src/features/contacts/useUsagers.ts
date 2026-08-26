// Liste des usagers — DEUX sources qu'aucun serveur ne joint :
//
// 1. le référentiel d'usagers du SOCLE, via `socle-proxy /v1/contacts/list`
//    (clé Socle côté serveur, réponses sanitisées). Iris n'en garde rien :
//    requête sans rétention (`gcTime: 0`), comme la fiche usager ;
// 2. les compteurs de demandes d'IRIS (RPC `contact_request_counts`), bornés
//    par le RLS au périmètre du lecteur.
//
// Le rapprochement des deux, le tri et les filtres se font dans le navigateur
// (`usagers.ts`, pur et testé).

import { useQuery } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import { supabase } from "@/lib/supabase";
import { canCreateProcedure } from "@/features/rights/rights";
import { useSocleProceduresCatalog } from "@/features/socle/useSocleCatalog";
import { useTenant } from "@/features/tenant/TenantProvider";
import type { SocleContact } from "./rapprochement";
import type { UsagerStatusFilter } from "./usagers";

/** Taille de page demandée au Socle (borne haute acceptée par le proxy). */
const PROXY_PAGE_SIZE = 500;

/** Plafond de rapatriement — annoncé à l'écran quand il mord, jamais silencieux. */
export const USAGERS_MAX = 5000;

interface ProxyPage {
  contacts: SocleContact[];
  has_more: boolean;
}

export interface UsagersResult {
  contacts: SocleContact[];
  /** Le référentiel dépasse `USAGERS_MAX` : la liste n'est pas exhaustive. */
  truncated: boolean;
}

/**
 * Toutes les fiches du référentiel pour le statut demandé (« actifs » par
 * défaut), rapatriées page par page. Le filtre `status` est le seul servi par
 * le Socle : il change ce qui est chargé, tous les autres filtrent en mémoire.
 */
export function useUsagers(orgId: string, status: UsagerStatusFilter, enabled = true) {
  return useQuery({
    queryKey: ["usagers", orgId, status],
    enabled: Boolean(orgId) && enabled,
    // Aucune rétention : Iris ne met aucun usager en cache (invariant).
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<UsagersResult> => {
      const contacts: SocleContact[] = [];
      for (let offset = 0; ; offset += PROXY_PAGE_SIZE) {
        const page = await invokeEdge<ProxyPage>("socle-proxy/v1/contacts/list", {
          organization_id: orgId,
          status,
          limit: PROXY_PAGE_SIZE,
          offset,
        });
        contacts.push(...(page.contacts ?? []));
        if (!page.has_more) return { contacts, truncated: false };
        if (contacts.length >= USAGERS_MAX) {
          return { contacts: contacts.slice(0, USAGERS_MAX), truncated: true };
        }
      }
    },
  });
}

export interface ContactCounts {
  total: number;
  open: number;
}

/**
 * Nombre de demandes et de demandes ouvertes par usager Socle, indexé par
 * identifiant. `contact_request_counts` est SECURITY INVOKER : deux agents
 * peuvent lire deux nombres différents pour le même usager, chacun voyant son
 * périmètre — c'est la règle, la même que sur la fiche usager.
 */
export function useContactRequestCounts(orgId: string) {
  return useQuery({
    queryKey: ["contact-request-counts", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<Map<string, ContactCounts>> => {
      const { data, error } = await supabase.rpc("contact_request_counts", { p_org_id: orgId });
      if (error) throw error;
      const byContact = new Map<string, ContactCounts>();
      for (const row of data ?? []) {
        if (!row.contact_id) continue;
        byContact.set(row.contact_id, { total: Number(row.total), open: Number(row.open_count) });
      }
      return byContact;
    },
  });
}

/**
 * Droit d'accéder au référentiel d'usagers : le MÊME que « Nouvelle demande »
 * (au moins une démarche créable) — c'est exactement la garde que `socle-proxy`
 * applique à toutes les routes `/v1/contacts/*`. Reflet de confort : l'edge
 * function reste l'autorité, l'entrée de navigation ne fait que s'y conformer.
 */
export function useCanBrowseUsagers(): boolean {
  const { current, rights } = useTenant();
  const orgId = current?.organizationId ?? "";
  const procCatalog = useSocleProceduresCatalog(orgId);
  if (!orgId) return false;
  if (rights.is_platform_admin) return true;
  return (procCatalog.data ?? []).some((o) => canCreateProcedure(rights, o.value));
}
