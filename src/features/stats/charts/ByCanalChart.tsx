import { useMemo } from "react";
import { ReactApexChart } from "./ReactApexChart";
import type { ApexOptions } from "apexcharts";
import { CHART_COLORS, FONT_FAMILY, baseChart, baseLegend, baseTooltip } from "../chartConfig";
import { groupBySourceIntoCanal, type SourceCount } from "../stats";
import { ChartCard } from "./ChartCard";

interface Props {
  data: SourceCount[] | undefined;
  loading: boolean;
}

/** Répartition par canal de réception : portail, Clara, création directe, partenaires. */
export function ByCanalChart({ data, loading }: Props) {
  const canaux = useMemo(() => groupBySourceIntoCanal(data ?? []), [data]);
  const total = canaux.reduce((s, c) => s + c.count, 0);

  const options: ApexOptions = {
    chart: { ...baseChart, type: "donut", id: "by-canal" },
    labels: canaux.map((c) => c.label),
    colors: CHART_COLORS,
    plotOptions: {
      pie: {
        donut: {
          size: "60%",
          labels: { show: true, total: { show: true, label: "Total", fontSize: "13px" } },
        },
      },
    },
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} demande(s)` } },
    legend: baseLegend,
    dataLabels: { style: { fontFamily: FONT_FAMILY, fontSize: "11px" } },
  };

  return (
    <ChartCard title="Répartition par canal de réception" loading={loading} empty={total === 0}>
      <ReactApexChart options={options} series={canaux.map((c) => c.count)} type="donut" height={280} />
    </ChartCard>
  );
}
