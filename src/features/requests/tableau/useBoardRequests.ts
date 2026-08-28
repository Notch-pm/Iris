// Données du tableau des demandes (kanban). Le RLS borne ce qui est lu ; cet
// écran n'affiche que ce que la liste afficherait.
//
// DEUX requêtes, pas une : les demandes EN COURS se chargent toutes (c'est le
// travail du service, il doit tenir entier sur le tableau), tandis que les
// statuts finaux s'accumulent sans fin et se bornent à une fenêtre récente.
// Les charger sur le même plafond ferait disparaître des demandes à traiter
// derrière trois ans de clôtures.
//
// Clé de requête préfixée par « requests » À DESSEIN : c'est ce préfixe
// qu'invalide `useApplyTransition` — le tableau se remet donc à jour tout seul
// après une transition, la sienne comme celle d'une autre page.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { CLOSED_STATUSES, OPEN_STATUSES } from "../statuts";
import { BOARD_MAX_CLOSED, BOARD_MAX_OPEN, type BoardRow } from "./tableau";

// `requester_snapshot` pèse ~250 octets par demande : l'identité du dépôt tient
// sur la carte sans un appel de plus. Le `procedure_snapshot`, lui, reste dehors.
const BOARD_SELECT =
  "id, reference, subject, status, priority, socle_procedure_id, socle_procedure_label, " +
  "socle_organization_id, socle_organization_label, socle_scope_org_id, assigned_to, " +
  "received_at, updated_at, identity_status, requester_snapshot";

export interface BoardBucket {
  rows: BoardRow[];
  /** Total réel côté serveur — au-delà du plafond chargé, s'il y a lieu. */
  total: number;
}

export interface BoardData {
  rows: BoardRow[];
  /** Demandes en cours au-delà du plafond (0 = tout est là). */
  openTruncated: number;
  /** Clôtures de la fenêtre au-delà du plafond (0 = tout est là). */
  closedTruncated: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useBoardRequests(orgId: string, closedSince: string): BoardData {
  const open = useQuery({
    queryKey: ["requests", "kanban", "ouvertes", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<BoardBucket> => {
      const { data, error, count } = await supabase
        .from("requests")
        .select(BOARD_SELECT, { count: "exact" })
        .eq("organization_id", orgId)
        .in("status", [...OPEN_STATUSES])
        .order("received_at", { ascending: false })
        .limit(BOARD_MAX_OPEN);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as BoardRow[], total: count ?? 0 };
    },
  });

  const closed = useQuery({
    queryKey: ["requests", "kanban", "closes", orgId, closedSince],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<BoardBucket> => {
      const { data, error, count } = await supabase
        .from("requests")
        .select(BOARD_SELECT, { count: "exact" })
        .eq("organization_id", orgId)
        .in("status", [...CLOSED_STATUSES])
        .gte("updated_at", closedSince)
        .order("updated_at", { ascending: false })
        .limit(BOARD_MAX_CLOSED);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as BoardRow[], total: count ?? 0 };
    },
  });

  const openRows = open.data?.rows ?? [];
  const closedRows = closed.data?.rows ?? [];
  return {
    rows: [...openRows, ...closedRows],
    openTruncated: Math.max(0, (open.data?.total ?? 0) - openRows.length),
    closedTruncated: Math.max(0, (closed.data?.total ?? 0) - closedRows.length),
    isLoading: open.isLoading || closed.isLoading,
    isError: open.isError || closed.isError,
    refetch: () => {
      void open.refetch();
      void closed.refetch();
    },
  };
}
