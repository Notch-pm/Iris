// Tableau de bord — motif Clara (`clara-mailflow-hub/src/pages/Dashboard.tsx`),
// décision PO 2026-09-19 : trois grands indicateurs et leur équivalent du
// mois précédent, puis deux colonnes — les demandes en attente d'instruction,
// et celles affectées à l'utilisateur.
//
// Périmètre : « l'ensemble des organisations auxquelles l'utilisateur a
// accès » = ce que le RLS laisse lire (consultation par couple). Aucun filtre
// d'écran : les chiffres viennent de `stats_monthly_flows` (faits insensibles
// à la purge), les listes de `requests` — l'un et l'autre bornés au serveur.

import * as React from "react";
import { Link } from "react-router-dom";
import { AlarmClock, AlarmClockOff, CheckCircle2, Clock, FileText, Inbox, UserCheck } from "lucide-react";
import { useWideLayout } from "@/components/layout/shellLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { DUE_TONE, openDueView } from "@/features/requests/echeance";
import { priorityOption } from "@/features/requests/instruction/instruction";
import { pinColor } from "@/features/requests/carte/InterventionMap";
import type { RequestListItem } from "@/features/requests/useRequests";
import {
  formatVariation,
  monthLongLabel,
  pickMonthPair,
  variation,
} from "@/features/dashboard/dashboard";
import {
  DASHBOARD_LIST_LIMIT,
  useAwaitingRequests,
  useDueCount,
  useMonthlyFlows,
  useMyAssignedRequests,
  type DashboardList,
} from "@/features/dashboard/useDashboard";
import { cn } from "@/lib/utils";

// ─── Carte d'indicateur (motif Clara : titre discret + icône, valeur 3xl, sous-titre) ───

interface KpiCardProps {
  label: string;
  value: number;
  sub: string;
  Icon: React.ElementType;
  iconClassName: string;
  href?: string;
  loading: boolean;
  /** Le sous-titre est un mois (« novembre 2026 ») : majuscule initiale. Faux pour une phrase. */
  monthSub?: boolean;
}

function KpiCard({ label, value, sub, Icon, iconClassName, href, loading, monthSub = true }: KpiCardProps) {
  const inner = (
    <Card className={cn("h-full", href && "cursor-pointer transition-shadow hover:shadow-airbnb-md")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("size-5 shrink-0", iconClassName)} aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <div className="text-3xl font-bold">{value.toLocaleString("fr-FR")}</div>
        )}
        <p className={cn("mt-1 text-xs text-muted-foreground", monthSub && "capitalize")}>{sub}</p>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link to={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ─── Liste de demandes (une colonne) ───

function frDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

interface RequestListProps {
  title: string;
  Icon: React.ElementType;
  list: DashboardList | undefined;
  loading: boolean;
  emptyText: string;
  /** Lien « Voir toutes » quand la liste dépasse ce qui est affiché. */
  moreHref: string;
  /** Statut affiché sur chaque ligne (utile quand la liste mélange les statuts). */
  showStatus?: boolean;
}

/**
 * Pastille de priorité, seulement quand elle est élevée (haute, urgente) — la
 * règle de la carte du tableau (`BoardCard`) : « normale » et « basse » n'ont
 * que le liseré.
 */
function PriorityMention({ priority }: { priority: string }) {
  const option = priorityOption(priority);
  if (option.tone === "muted") return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-[7px] py-[2px] text-[10px] font-bold",
        option.tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-secondary/40 text-secondary-foreground",
      )}
    >
      {option.label}
    </span>
  );
}

/**
 * Mention d'échéance d'une ligne (B16) : seulement quand la demande ouverte est
 * en retard ou à 3 jours ou moins — la pastille de la fiche, mêmes jetons.
 */
function DueMention({ r, now }: { r: RequestListItem; now: Date }) {
  const view = openDueView(r.due_at, r.status, now);
  if (!view || view.tone === "normal") return null;
  return (
    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", DUE_TONE[view.tone])}>
      {view.label}
    </span>
  );
}

function RequestList({ title, Icon, list, loading, emptyText, moreHref, showStatus = false }: RequestListProps) {
  const items: RequestListItem[] = list?.items ?? [];
  const now = new Date();
  const total = list?.total ?? 0;
  return (
    // `min-w-0` : sans lui, l'élément de grille prend la largeur du plus long
    // objet, la troncature ne joue plus et la mention d'échéance sort de l'écran.
    <section className="flex min-w-0 flex-col gap-3" aria-label={title}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-semibold">{title}</h2>
          {!loading ? <Badge variant="secondary">{total}</Badge> : null}
        </div>
        {total > DASHBOARD_LIST_LIMIT ? (
          <Link to={moreHref} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            Voir toutes →
          </Link>
        ) : null}
      </div>
      <Card>
        {loading ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/demandes/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  {/* Liseré de PRIORITÉ — mêmes couleurs que le tableau et la carte (`pinColor`). */}
                  <span
                    title={`Priorité ${priorityOption(r.priority).label.toLowerCase()}`}
                    className={cn("w-1 shrink-0 self-stretch rounded-full", pinColor(r.priority))}
                  >
                    <span className="sr-only">Priorité {priorityOption(r.priority).label.toLowerCase()}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.reference}</span>
                      <PriorityMention priority={r.priority} />
                      <span className="truncate">{r.subject}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {frDate(r.received_at)}
                      {r.socle_organization_label ? (
                        <span className="ml-2 text-muted-foreground/70">— {r.socle_organization_label}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <DueMention r={r} now={now} />
                    {showStatus ? <StatusBadge status={r.status} /> : null}
                    <span className="text-muted-foreground" aria-hidden="true">→</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

// ─── Page ───

export function DashboardPage() {
  // Gabarit LARGE, comme la liste et les statistiques : deux colonnes de
  // demandes et six cartes se servent de tout l'écran (retour PO 2026-09-19 —
  // la colonne centrée à 1240 px paraissait étroite sur un grand écran).
  useWideLayout();
  const { profile, session } = useAuth();
  const { current, rightsLoading, hasAnyProfile } = useTenant();
  const orgId = current?.organizationId ?? "";
  const userId = session?.user.id ?? null;
  const isPlatformAdmin = profile?.is_platform_admin ?? false;

  const flows = useMonthlyFlows(orgId);
  const awaiting = useAwaitingRequests(orgId);
  const mine = useMyAssignedRequests(orgId, userId);
  const dueLate = useDueCount(orgId, "late");
  const dueSoon = useDueCount(orgId, "soon");

  const pair = React.useMemo(() => pickMonthPair(flows.data ?? []), [flows.data]);
  const currentLabel = monthLongLabel(pair.current.month_key);
  const previousLabel = monthLongLabel(pair.previous.month_key);

  if (!current) return null;
  // Évite un flash de la carte « aucun droit » pendant le premier chargement
  // de my_rights (repli emptyRights le temps que la requête résolve).
  if (rightsLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  // RM-45 : un membre nouvellement rattaché n'a aucun profil, donc aucun
  // droit — jamais d'erreur brute ni de page vide, un message explicite.
  if (!hasAnyProfile && !isPlatformAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Aucun droit attribué</CardTitle>
            <p className="text-sm text-muted-foreground">
              Aucun droit ne vous a encore été attribué sur {current.organizationName} —
              contactez votre administrateur.
            </p>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const sub = (label: string, cur: number, prev: number) => `${label} · ${formatVariation(variation(cur, prev))} vs M−1`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
          {isPlatformAdmin ? <Badge variant="secondary">Admin plateforme</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Vue d'ensemble des demandes de {current.organizationName}, dans la limite de vos droits.
        </p>
      </div>

      {/* Quatre colonnes : les trois flux du mois puis « Échéance dépassée » ;
          les trois flux de M−1 puis « Échéance approchante » (B16). Les deux
          cartes d'échéance sont des STOCKS à l'instant, sans M−1. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Demandes reçues"
          value={pair.current.received_count}
          sub={sub(currentLabel, pair.current.received_count, pair.previous.received_count)}
          Icon={Inbox}
          iconClassName="text-primary"
          href="/demandes"
          loading={flows.isLoading}
        />
        <KpiCard
          label="Mises en instruction"
          value={pair.current.instruction_count}
          sub={sub(currentLabel, pair.current.instruction_count, pair.previous.instruction_count)}
          Icon={FileText}
          iconClassName="text-blue-500"
          href="/demandes?status=en_instruction"
          loading={flows.isLoading}
        />
        <KpiCard
          label="Demandes instruites"
          value={pair.current.resolved_count}
          sub={sub(currentLabel, pair.current.resolved_count, pair.previous.resolved_count)}
          Icon={CheckCircle2}
          iconClassName="text-primary"
          href="/statistiques"
          loading={flows.isLoading}
        />
        <KpiCard
          label="Échéance dépassée"
          value={dueLate.data ?? 0}
          sub="Demandes en cours, à traiter en priorité"
          Icon={AlarmClockOff}
          iconClassName="text-destructive"
          href="/demandes?due=late"
          loading={dueLate.isLoading}
          monthSub={false}
        />
        <KpiCard
          label="Demandes reçues (M−1)"
          value={pair.previous.received_count}
          sub={previousLabel}
          Icon={Inbox}
          iconClassName="text-muted-foreground"
          loading={flows.isLoading}
        />
        <KpiCard
          label="Mises en instruction (M−1)"
          value={pair.previous.instruction_count}
          sub={previousLabel}
          Icon={FileText}
          iconClassName="text-muted-foreground"
          loading={flows.isLoading}
        />
        <KpiCard
          label="Demandes instruites (M−1)"
          value={pair.previous.resolved_count}
          sub={previousLabel}
          Icon={CheckCircle2}
          iconClassName="text-muted-foreground"
          loading={flows.isLoading}
        />
        <KpiCard
          label="Échéance approchante"
          value={dueSoon.data ?? 0}
          sub="Demandes en cours, échéance dans 3 jours ou moins"
          Icon={AlarmClock}
          iconClassName="text-secondary-foreground"
          href="/demandes?due=soon"
          loading={dueSoon.isLoading}
          monthSub={false}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <RequestList
          title="En attente d'instruction"
          Icon={Clock}
          list={awaiting.data}
          loading={awaiting.isLoading}
          emptyText="Aucune demande n'attend d'être prise en charge."
          moreHref="/demandes?status=a_traiter"
        />
        <RequestList
          title="Mes demandes"
          Icon={UserCheck}
          list={mine.data}
          loading={mine.isLoading}
          emptyText="Aucune demande ouverte ne vous est affectée."
          moreHref="/demandes"
          showStatus
        />
      </div>
    </div>
  );
}
