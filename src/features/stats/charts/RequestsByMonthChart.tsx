import { ReactApexChart } from "./ReactApexChart";
import type { ApexOptions } from "apexcharts";
import { CHART_COLORS, baseChart, baseGrid, baseTooltip, baseXAxis, baseYAxis } from "../chartConfig";
import { monthLabel } from "../stats";
import type { MonthPoint } from "../useStats";
import { ChartCard } from "./ChartCard";

interface Props {
  data: MonthPoint[] | undefined;
  loading: boolean;
}

/** Demandes reçues par mois — 12 derniers mois (les mois vides viennent à 0 du serveur). */
export function RequestsByMonthChart({ data, loading }: Props) {
  const categories = (data ?? []).map((d) => monthLabel(d.month_key));
  const series = [{ name: "Demandes reçues", data: (data ?? []).map((d) => Number(d.request_count)) }];

  const options: ApexOptions = {
    chart: { ...baseChart, type: "bar", id: "requests-by-month" },
    plotOptions: { bar: { borderRadius: 4, columnWidth: "60%" } },
    colors: [CHART_COLORS[0]],
    xaxis: { ...baseXAxis, categories },
    yaxis: baseYAxis,
    grid: baseGrid,
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} demande(s)` } },
    dataLabels: { enabled: false },
  };

  return (
    <ChartCard title="Demandes reçues — 12 derniers mois" loading={loading}>
      <ReactApexChart options={options} series={series} type="bar" height={280} />
    </ChartCard>
  );
}
