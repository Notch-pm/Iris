// Écran « Statistiques » — motif Clara (StatistiquesPage) : cartes KPI,
// grille de graphiques ApexCharts, filtres organisme + période.
//
// Aucun chiffre ne vient de `requests` : tout est lu dans les tables de faits
// `request_stats` / `intervention_stats`, insensibles à la purge RGPD, par des
// RPC SECURITY INVOKER — l'agent ne voit que les couples (organisme, démarche)
// qu'il a le droit de consulter. Un administrateur sans droit de consultation
// voit des graphiques vides : c'est la règle, l'administration n'accorde
// aucun droit sur les demandes.

import * as React from "react";
import { BarChart3, CheckCircle2, HardHat, Inbox, Timer } from "lucide-react";
import { useWideLayout } from "@/components/layout/shellLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSocleOrganizationsCatalog } from "@/features/socle/useSocleCatalog";
import { useTenant } from "@/features/tenant/TenantProvider";
import { cn } from "@/lib/utils";
import { StatsFilters } from "./StatsFilters";
import { ByCanalChart } from "./charts/ByCanalChart";
import { ByOrganizationChart } from "./charts/ByOrganizationChart";
import { OutcomesChart } from "./charts/OutcomesChart";
import { ProcessingTimesChart } from "./charts/ProcessingTimesChart";
import { RequestsByMonthChart } from "./charts/RequestsByMonthChart";
import { TopAgentsChart } from "./charts/TopAgentsChart";
import { CHART_COLORS } from "./chartConfig";
import {
  formatCount,
  formatDays,
  formatPercent,
  positiveResolutionRate,
  sinceFromPeriod,
  type StatPeriod,
} from "./stats";
import {
  useInterventionStats,
  useOutcomes,
  useProcessingTimes,
  useRequestsByMonth,
  useRequestsByOrganization,
  useRequestsBySource,
  useTopIntervenants,
  useTopResolvers,
  type StatsScope,
} from "./useStats";

interface KpiCardProps {
  label: string;
  value: string;
  loading: boolean;
  Icon: React.ElementType;
  iconClassName: string;
}

function KpiCard({ label, value, loading, Icon, iconClassName }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pb-5 pt-5">
        <div className={cn("rounded-xl bg-muted p-2.5", iconClassName)}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-0.5 h-7 w-16" />
          ) : (
            <p className="text-2xl font-bold text-foreground">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function StatistiquesPage() {
  useWideLayout();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const [socleOrgId, setSocleOrgId] = React.useState<string | null>(null);
  const [period, setPeriod] = React.useState<StatPeriod>("30d");

  // La borne est figée par période choisie (pas recalculée à chaque rendu :
  // elle entre dans les clés de requête).
  const sinceISO = React.useMemo(() => sinceFromPeriod(period).toISOString(), [period]);
  const scope: StatsScope = React.useMemo(
    () => ({ orgId, socleOrgId, sinceISO }),
    [orgId, socleOrgId, sinceISO],
  );

  const organismes = useSocleOrganizationsCatalog(orgId);
  const byMonth = useRequestsByMonth(scope);
  const bySource = useRequestsBySource(scope);
  const byOrganization = useRequestsByOrganization(scope);
  const processing = useProcessingTimes(scope);
  const outcomes = useOutcomes(scope);
  const topResolvers = useTopResolvers(scope);
  const interventions = useInterventionStats(scope);
  const topIntervenants = useTopIntervenants(scope);

  const received = React.useMemo(
    () => (bySource.data ?? []).reduce((s, d) => s + Number(d.request_count), 0),
    [bySource.data],
  );
  const rate = outcomes.data ? positiveResolutionRate(outcomes.data) : null;

  if (!current) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BarChart3 className="size-6 text-primary" aria-hidden="true" /> Statistiques
        </h1>
        <p className="text-sm text-muted-foreground">
          Demandes et interventions de {current.organizationName}, dans la limite de vos droits
          de consultation.
        </p>
      </div>

      <StatsFilters
        organismes={(organismes.data ?? []).map((o) => ({ value: o.value, label: o.label }))}
        socleOrgId={socleOrgId}
        period={period}
        onOrganismeChange={setSocleOrgId}
        onPeriodChange={setPeriod}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Demandes reçues (période)"
          value={formatCount(received)}
          loading={bySource.isLoading}
          Icon={Inbox}
          iconClassName="text-primary"
        />
        <KpiCard
          label="Taux de résolution positive"
          value={formatPercent(rate)}
          loading={outcomes.isLoading}
          Icon={CheckCircle2}
          iconClassName="text-primary"
        />
        <KpiCard
          label="Interventions réalisées (période)"
          value={formatCount(interventions.data?.completed_count)}
          loading={interventions.isLoading}
          Icon={HardHat}
          iconClassName="text-amber-500"
        />
        <KpiCard
          label="Délai moyen de clôture des interventions"
          value={formatDays(interventions.data?.avg_days_to_completion)}
          loading={interventions.isLoading}
          Icon={Timer}
          iconClassName="text-blue-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RequestsByMonthChart data={byMonth.data} loading={byMonth.isLoading} />
        <ByCanalChart data={bySource.data} loading={bySource.isLoading} />
        <ByOrganizationChart data={byOrganization.data} loading={byOrganization.isLoading} />
        <ProcessingTimesChart data={processing.data} loading={processing.isLoading} />
        <OutcomesChart data={outcomes.data} loading={outcomes.isLoading} />
        <TopAgentsChart
          title="Agents ayant instruit le plus de demandes"
          unit="demande"
          data={topResolvers.data}
          loading={topResolvers.isLoading}
          emptyText="Aucune demande résolue sur la période sélectionnée"
        />
        <TopAgentsChart
          title="Intervenants ayant réalisé le plus d'interventions"
          unit="intervention"
          color={CHART_COLORS[1]}
          data={topIntervenants.data}
          loading={topIntervenants.isLoading}
          emptyText="Aucune intervention réalisée sur la période sélectionnée"
        />
      </div>
    </div>
  );
}
