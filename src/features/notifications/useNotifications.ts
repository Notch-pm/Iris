// Accès aux notifications — un hook par usage, `queryKey` explicite,
// invalidation dans `onSuccess` (convention du projet).
//
// Le RLS borne déjà la lecture aux SIENNES : la requête ne filtre que par
// tenant courant, jamais par utilisateur — ce n'est pas au navigateur de
// décider qui voit quoi.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { readPayload, unreadCount, type NotificationItem } from "./notifications";

/** Le volet n'est pas un journal : au-delà, on renvoie vers la fiche. */
export const NOTIFICATIONS_PAGE_SIZE = 30;

/** Filet de sécurité si le temps réel ne s'établit pas (proxy, onglet dormant,
 *  websocket coupé). Le push reste le chemin normal. */
const POLL_INTERVAL_MS = 60_000;

const SELECT = "id, kind, request_id, created_at, read_at, payload";

export const notificationKeys = {
  list: (orgId: string) => ["notifications", orgId] as const,
};

export function useNotifications() {
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";

  return useQuery({
    queryKey: notificationKeys.list(orgId),
    enabled: Boolean(orgId),
    refetchInterval: POLL_INTERVAL_MS,
    queryFn: async (): Promise<NotificationItem[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select(SELECT)
        .eq("organization_id", orgId)
        // `in_app = false` : la ligne n'existe que pour porter l'e-mail
        // (l'utilisateur a coupé le canal in-app) — elle ne s'affiche pas.
        .eq("in_app", true)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATIONS_PAGE_SIZE);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        requestId: row.request_id,
        createdAt: row.created_at,
        readAt: row.read_at,
        payload: readPayload(row.payload),
      }));
    },
  });
}

/**
 * Abonnement temps réel aux INSERT me concernant. Realtime ré-applique le RLS
 * par abonné ; le filtre `user_id` n'est donc pas une sécurité (il ne fait
 * qu'éviter du trafic inutile), et c'est bien le serveur qui décide.
 *
 * ⚠️ Keyé sur l'id utilisateur et l'id de tenant, JAMAIS sur l'objet session :
 * supabase-js ré-émet un nouvel objet session à chaque retour d'onglet, ce qui
 * détruirait et recréerait le canal en boucle (piège AuthProvider du projet).
 */
export function useNotificationsRealtime() {
  const { session } = useAuth();
  const { current } = useTenant();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const orgId = current?.organizationId ?? "";

  React.useEffect(() => {
    if (!userId || !orgId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: notificationKeys.list(orgId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, orgId, queryClient]);
}

/** Accusé de lecture ciblé — RPC : `notifications` n'a aucune policy d'écriture. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list(orgId) });
    },
  });
}

/** « Tout marquer comme lu », borné au tenant courant. */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("mark_all_notifications_read", { p_org_id: orgId });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list(orgId) });
    },
  });
}

/** Compteur de la pastille — dérivé de la même liste, aucune requête de plus. */
export function useUnreadNotificationCount(): number {
  const list = useNotifications();
  return React.useMemo(() => unreadCount(list.data ?? []), [list.data]);
}
