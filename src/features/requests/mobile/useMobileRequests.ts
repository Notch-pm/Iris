// Hooks TanStack Query de la page mobile « Mes demandes ». Trois requêtes
// légères et indépendantes plutôt qu'une seule qui saurait tout faire : la
// liste (bornée à 60 lignes, un filtre à la fois), les effectifs des quatre
// puces (une lecture des seuls statuts OUVERTS, dérivée en mémoire — jamais
// quatre allers-retours), et le compte d'interventions en attente par
// demande (pour l'icône « N intervention(s) en cours » des cartes).
//
// `queryKey` préfixé par "requests" à dessein : les mutations existantes
// (transition, affectation, sollicitation…) invalident déjà ce préfixe
// (`useInvalidateRequest`, `useInvalidateInterventions`) — la liste et les
// compteurs mobiles se remettent donc à jour sans code d'invalidation propre.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { mobileCounts, type MobileListFilter, type MobileRequestCounts } from "./mobileRequests";

export interface MobileRequestListItem {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priority: string;
  due_at: string | null;
  updated_at: string;
  received_at: string;
  socle_organization_label: string | null;
  socle_procedure_label: string | null;
  assigned_to: string | null;
  identity_status: string;
  requester_snapshot: unknown;
}

// Un seul littéral de chaîne (jamais une concaténation `+`) : supabase-js
// parse ce type au niveau des types pour rendre `MobileRequestListItem` sans
// caster — une concaténation l'élargirait en `string` et ferait retomber
// l'appel sur un type d'erreur générique (piège vécu en écrivant ce fichier).
const MOBILE_LIST_SELECT =
  "id, reference, subject, status, priority, due_at, updated_at, received_at, socle_organization_label, socle_procedure_label, assigned_to, identity_status, requester_snapshot";

const MOBILE_LIST_LIMIT = 60;

const OPEN_STATUSES = ["a_traiter", "en_instruction", "en_attente"] as const;

/** Les 60 dernières demandes du filtre choisi, les plus récemment mises à jour d'abord. */
export function useMobileRequestsList(orgId: string, filter: MobileListFilter, userId: string | null) {
  return useQuery({
    queryKey: ["requests", "mobile", orgId, filter, userId],
    enabled: Boolean(orgId) && (filter !== "affectees" || Boolean(userId)),
    queryFn: async (): Promise<MobileRequestListItem[]> => {
      let query = supabase.from("requests").select(MOBILE_LIST_SELECT).eq("organization_id", orgId);
      query = filter === "affectees"
        ? query.eq("assigned_to", userId ?? "").in("status", OPEN_STATUSES)
        : query.eq("status", filter);
      const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(MOBILE_LIST_LIMIT);
      if (error) throw error;
      return (data ?? []) as MobileRequestListItem[];
    },
  });
}

/** Effectifs des quatre puces, dérivés d'une seule lecture des statuts ouverts. */
export function useMobileRequestCounts(orgId: string, userId: string | null) {
  return useQuery({
    queryKey: ["requests", "mobile-counts", orgId, userId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<MobileRequestCounts> => {
      const { data, error } = await supabase
        .from("requests")
        .select("id, status, assigned_to")
        .eq("organization_id", orgId)
        .in("status", OPEN_STATUSES)
        .limit(2000);
      if (error) throw error;
      return mobileCounts(data ?? [], userId);
    },
  });
}

/** Sollicitations À RÉALISER par demande, pour les cartes de la liste (« N intervention(s) en cours »). */
export function usePendingInterventionCounts(requestIds: readonly string[]) {
  const ids = [...requestIds].sort();
  return useQuery({
    queryKey: ["requests", "mobile-pending-interventions", ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from("request_interventions")
        .select("request_id")
        .eq("status", "demandee")
        .in("request_id", ids);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        counts.set(row.request_id, (counts.get(row.request_id) ?? 0) + 1);
      }
      return counts;
    },
  });
}
