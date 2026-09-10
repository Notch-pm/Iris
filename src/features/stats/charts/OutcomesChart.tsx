import { ReactApexChart } from "./ReactApexChart";
import type { ApexOptions } from "apexcharts";
import { CHART_COLORS, FONT_FAMILY, baseChart, baseLegend, baseTooltip } from "../chartConfig";
import type { OutcomeCounts } from "../stats";
import { ChartCard } from "./ChartCard";

interface Props {
  data: OutcomeCounts | undefined;
  loading: boolean;
}

/** Issue des demandes reçues sur la période : positives, négatives, annulées, en cours. */
export function OutcomesChart({ data, loading }: Props) {
  const series = [
    Number(data?.positive_count ?? 0),
    Number(data?.negative_count ?? 0),
    Number(data?.cancelled_count ?? 0),
    Number(data?.open_count ?? 0),
  ];
  const total = series.reduce((s, n) => s + n, 0);

  const options: ApexOptions = {
    chart: { ...baseChart, type: "donut", id: "outcomes" },
    labels: ["Résolues positivement", "Résolues négativement", "Annulées", "En cours"],
    colors: [CHART_COLORS[0], CHART_COLORS[7], CHART_COLORS[3], CHART_COLORS[2]],
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
    <ChartCard title="Issue des demandes reçues" loading={loading} empty={total === 0}>
      <ReactApexChart options={options} series={series} type="donut" height={280} />
    </ChartCard>
  );
}
