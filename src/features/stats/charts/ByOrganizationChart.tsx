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
import type { OrganizationPoint } from "../useStats";
import { ChartCard } from "./ChartCard";

interface Props {
  data: OrganizationPoint[] | undefined;
  loading: boolean;
}

/** Demandes reçues par organisme porteur — barres horizontales (motif Clara « entrants par service »). */
export function ByOrganizationChart({ data, loading }: Props) {
  const rows = data ?? [];
  const categories = rows.map((d) => d.org_name);
  const maxVal = Math.max(...rows.map((d) => Number(d.request_count)), 1);
  const series = [{ name: "Demandes reçues", data: rows.map((d) => Number(d.request_count)) }];

  const options: ApexOptions = {
    chart: { ...baseChart, type: "bar", id: "by-organization" },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "60%" } },
    colors: [CHART_COLORS[0]],
    xaxis: {
      categories,
      tickAmount: Math.min(maxVal, 8),
      labels: { style: { fontFamily: FONT_FAMILY, fontSize: "11px" }, formatter: integerAxisLabel },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { fontFamily: FONT_FAMILY, fontSize: "11px" } } },
    grid: baseGrid,
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} demande(s)` } },
    dataLabels: { enabled: false },
  };

  return (
    <ChartCard title="Demandes reçues par organisme" loading={loading} empty={rows.length === 0}>
      <ReactApexChart
        options={options}
        series={series}
        type="bar"
        height={Math.max(200, categories.length * 44)}
      />
    </ChartCard>
  );
}
