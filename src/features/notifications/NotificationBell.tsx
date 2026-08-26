// Cloche des notifications — tuile du header (à gauche des Paramètres), au
// motif du menu compte : bouton + volet flottant, fermeture au clic extérieur
// et à Échap.
//
// Le volet n'est pas un journal : il montre les dernières notifications du
// tenant courant et renvoie vers la fiche pour le reste. Cliquer une
// notification l'ouvre ET la marque lue — le geste vaut accusé de lecture.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  badgeLabel, groupNotifications, notificationMessage, notificationSubtitle,
  notificationTitle, relativeAge, unreadCount, type NotificationItem,
} from "./notifications";
import {
  useMarkAllNotificationsRead, useMarkNotificationsRead, useNotifications,
  useNotificationsRealtime,
} from "./useNotifications";

function NotificationRow({
  item, now, onOpen,
}: {
  item: NotificationItem;
  now: Date;
  onOpen: (item: NotificationItem) => void;
}) {
  const unread = item.readAt === null;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={cn(
        "flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted",
        unread && "bg-primary/5",
      )}
    >
      {/* Pastille de non-lu : l'espace est réservé dans les deux cas pour que
          les lignes restent alignées. */}
      <span
        aria-hidden="true"
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("text-[13px]", unread ? "font-semibold" : "font-medium")}>
            {notificationTitle(item.kind)}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {relativeAge(item.createdAt, now)}
          </span>
        </span>
        <span className="mt-0.5 block text-[12px] text-muted-foreground">
          {notificationMessage(item.kind, item.payload)}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
          {notificationSubtitle(item.payload)}
        </span>
      </span>
      {unread ? <span className="sr-only">Non lue</span> : null}
    </button>
  );
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useNotificationsRealtime();
  const list = useNotifications();
  const markRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items = React.useMemo(() => list.data ?? [], [list.data]);
  const unread = unreadCount(items);

  // L'âge relatif ne se recalcule qu'à l'ouverture puis chaque minute : inutile
  // de faire battre l'application entière pour un « il y a 3 min ».
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = React.useMemo(() => groupNotifications(items, now), [items, now]);

  function openNotification(item: NotificationItem) {
    setOpen(false);
    if (item.readAt === null) markRead.mutate([item.id]);
    navigate(`/demandes/${item.requestId}`);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          open ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground"
          >
            {badgeLabel(unread)}
          </span>
        ) : null}
        <span className="sr-only">
          {unread > 0 ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-11 z-40 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-1.5 shadow-airbnb-lg"
        >
          <div className="flex items-center justify-between px-2.5 py-2">
            <p className="text-[13px] font-semibold">Notifications</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Tout marquer comme lu
              </button>
            ) : null}
          </div>
          <div className="my-1 h-px bg-border" />

          <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
            {list.isLoading ? (
              <p className="px-2.5 py-6 text-center text-[12px] text-muted-foreground">Chargement…</p>
            ) : list.isError ? (
              <p role="alert" className="px-2.5 py-6 text-center text-[12px] text-destructive">
                Notifications indisponibles.
              </p>
            ) : items.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-[12px] text-muted-foreground">
                Aucune notification.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  {group.items.map((item) => (
                    <NotificationRow key={item.id} item={item} now={now} onOpen={openNotification} />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
