// Écran 1 « Mes demandes » (maquette Claude Design « Iris mobile — v2 »,
// lignes 39-160) — route `/demandes` sur téléphone. En-tête collant (avatar
// de l'agent, titre, organisation, cloche), recherche et puces de filtre,
// bandeau d'échéances du jour, cartes cliquables vers la fiche.
//
// Aucun appel `supabase` direct : les trois hooks de `useMobileRequests.ts`
// font le travail, `mobileRequests.ts` (pur) le présente.

import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clock, HardHat, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/surface";
import {
  MobileCardButton, MobileChip, MobileEmpty, MobileHeader, MobileNotice,
} from "@/components/layout/mobile/MobilePage";
import { StatusBadge } from "../StatusBadge";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { displayName, initials } from "@/features/account/account";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { cn } from "@/lib/utils";
import {
  deadlineBanner, dueTodayCount, FILTER_LABELS, isDueToday, matchesQuery, parseFilter,
  relativeTime, requesterLine, type MobileListFilter,
} from "./mobileRequests";
import {
  useMobileRequestCounts, useMobileRequestsList, usePendingInterventionCounts,
} from "./useMobileRequests";

const FILTERS: MobileListFilter[] = ["affectees", "a_traiter", "en_instruction", "en_attente"];

/** `AAAA-MM-JJ` du jour local de l'agent — jamais `toISOString` (UTC). */
function isoDayLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MobileRequestsListPage() {
  const navigate = useNavigate();
  const { profile, session } = useAuth();
  const { current } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const orgId = current?.organizationId ?? "";
  const userId = session?.user.id ?? null;

  const filter = parseFilter(searchParams.get("filtre"));
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const list = useMobileRequestsList(orgId, filter, userId);
  const counts = useMobileRequestCounts(orgId, userId);
  const items = list.data ?? [];
  const pendingInterventions = usePendingInterventionCounts(items.map((i) => i.id));

  const today = isoDayLocal(new Date());
  const banner = deadlineBanner(dueTodayCount(items, today));
  const filtered = debouncedQuery.trim().length >= 3
    ? items.filter((item) => matchesQuery(item, debouncedQuery))
    : items;

  function setFilter(next: MobileListFilter) {
    setSearchParams({ filtre: next }, { replace: true });
  }

  return (
    <div className="flex min-h-full flex-col">
      <MobileHeader
        title={
          <span className="flex items-center gap-2.5">
            <Avatar initials={initials(profile)} size="md" className="h-9 w-9 shrink-0 text-sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[17px] font-bold leading-tight">Mes demandes</span>
              <span className="truncate text-xs text-muted-foreground">
                {current?.organizationName ?? displayName(profile)}
              </span>
            </span>
          </span>
        }
        trailing={<NotificationBell />}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="h-11 pl-10"
            placeholder="Rechercher une demande, un usager…"
            aria-label="Rechercher une demande, un usager"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 scrollbar-none">
          {FILTERS.map((f) => (
            <MobileChip key={f} active={f === filter} onClick={() => setFilter(f)}>
              {FILTER_LABELS[f]}{counts.data ? ` ${counts.data[f]}` : ""}
            </MobileChip>
          ))}
        </div>
      </MobileHeader>

      <div className="flex flex-1 flex-col gap-2.5 px-3 py-3.5">
        {list.isLoading ? (
          <MobileEmpty>Chargement…</MobileEmpty>
        ) : list.isError ? (
          <MobileEmpty tone="error">Les demandes n'ont pas pu être chargées.</MobileEmpty>
        ) : filtered.length === 0 ? (
          <MobileEmpty>
            {items.length === 0
              ? "Aucune demande dans ce filtre."
              : "Aucune demande ne correspond à votre recherche."}
          </MobileEmpty>
        ) : (
          <>
            {banner ? (
              <MobileNotice icon={<Clock aria-hidden="true" />}>{banner}</MobileNotice>
            ) : null}
            {filtered.map((item) => {
              const pending = pendingInterventions.data?.get(item.id) ?? 0;
              const dueToday = isDueToday(item.due_at, today);
              return (
                <MobileCardButton key={item.id} onClick={() => navigate(`/demandes/${item.id}`)}>
                  <span className="text-[17px] font-bold leading-tight">
                    {item.socle_procedure_label ?? item.subject}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {requesterLine(item.requester_snapshot, item.identity_status, item.reference)}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} size="md" />
                    <span className="text-xs text-muted-foreground">{relativeTime(item.updated_at, new Date())}</span>
                    {pending > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-foreground">
                        <HardHat className="size-[13px]" aria-hidden="true" />
                        {pending} intervention{pending > 1 ? "s" : ""} en cours
                      </span>
                    ) : null}
                    {dueToday ? (
                      <span className="text-xs font-bold text-destructive">échéance aujourd'hui</span>
                    ) : null}
                  </span>
                </MobileCardButton>
              );
            })}
            {items.length === 60 ? (
              <p className={cn("py-1 text-center text-xs text-muted-foreground")}>60 dernières demandes</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
