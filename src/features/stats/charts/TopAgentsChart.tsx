import { ReactApexChart } from "./ReactApexChart";
import type { ApexOptions } from "apexcharts";
import {
  CHART_COLORS,
  FONT_FAMILY,
  baseChart,
  baseGrid,
  baseTooltip,
  integerAxisLabel,
} from "../chartConfig";
import type { AgentPoint } from "../useStats";
import { ChartCard } from "./ChartCard";

interface Props {
  data: AgentPoint[] | undefined;
  loading: boolean;
  title: string;
  /** Nom de la série et unité de l'infobulle (« demande », « intervention »). */
  unit: string;
  color?: string;
  emptyText?: string;
}

/** Classement d'agents — barres horizontales, top 10 (agents instructeurs, intervenants). */
export function TopAgentsChart({ data, loading, title, unit, color = CHART_COLORS[0], emptyText }: Props) {
  const rows = data ?? [];
  const categories = rows.map((d) => d.user_name);
  const values = rows.map((d) => Number(d.request_count ?? d.intervention_count ?? 0));
  const maxVal = Math.max(...values, 1);
  const series = [{ name: `${unit}s`, data: values }];

  const options: ApexOptions = {
    chart: { ...baseChart, type: "bar", id: `top-${unit}` },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "60%" } },
    colors: [color],
    xaxis: {
      categories,
      tickAmount: Math.min(maxVal, 8),
      labels: { style: { fontFamily: FONT_FAMILY, fontSize: "11px" }, formatter: integerAxisLabel },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { fontFamily: FONT_FAMILY, fontSize: "11px" } } },
    grid: baseGrid,
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} ${unit}(s)` } },
    dataLabels: { enabled: false },
  };

  return (
    <ChartCard title={title} loading={loading} empty={rows.length === 0} emptyText={emptyText}>
      <ReactApexChart
        options={options}
        series={series}
        type="bar"
        height={Math.max(200, categories.length * 44)}
      />
    </ChartCard>
  );
}
