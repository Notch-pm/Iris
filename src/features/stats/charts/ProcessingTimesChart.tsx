import { ReactApexChart } from "./ReactApexChart";
import type { ApexOptions } from "apexcharts";
import { CHART_COLORS, FONT_FAMILY, baseChart, baseGrid, baseLegend, baseTooltip } from "../chartConfig";
import type { ProcessingPoint } from "../useStats";
import { ChartCard } from "./ChartCard";

interface Props {
  data: ProcessingPoint[] | undefined;
  loading: boolean;
}

/**
 * Délais moyens par organisme, en jours : réception → première instruction,
 * réception → résolution (résolutions positives et négatives ; une annulation
 * n'est pas une résolution).
 */
export function ProcessingTimesChart({ data, loading }: Props) {
  const rows = data ?? [];
  const categories = rows.map((d) => d.org_name);
  const series = [
    { name: "Réception → Instruction", data: rows.map((d) => Number(d.avg_days_to_instruction ?? 0)) },
    { name: "Réception → Résolution", data: rows.map((d) => Number(d.avg_days_to_resolution ?? 0)) },
  ];

  const options: ApexOptions = {
    chart: { ...baseChart, type: "bar", id: "processing-times" },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "70%" } },
    colors: [CHART_COLORS[2], CHART_COLORS[0]],
    xaxis: {
      categories,
      labels: { style: { fontFamily: FONT_FAMILY, fontSize: "11px" }, formatter: (v) => `${v}j` },
      axisBorder: { show: false },
    },
    yaxis: { labels: { style: { fontFamily: FONT_FAMILY, fontSize: "11px" } } },
    grid: baseGrid,
    tooltip: { ...baseTooltip, y: { formatter: (v) => (v > 0 ? `${v} jour(s)` : "—") } },
    dataLabels: { enabled: false },
    legend: baseLegend,
  };

  return (
    <ChartCard
      title="Délais de traitement par organisme (jours)"
      loading={loading}
      empty={rows.length === 0}
      emptyText="Aucune donnée de traitement disponible"
    >
      <ReactApexChart
        options={options}
        series={series}
        type="bar"
        height={Math.max(200, categories.length * 60)}
      />
    </ChartCard>
  );
}
