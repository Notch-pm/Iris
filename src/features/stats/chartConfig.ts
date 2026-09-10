// Réglages communs des graphiques — COPIE de Clara
// (clara-mailflow-hub/src/components/stats/chartConfig.ts) : même bibliothèque
// (ApexCharts), même rendu, même palette. Décision PO 2026-09-18 : l'écran
// Statistiques d'Iris se lit comme celui de Clara.
//
// ⚠️ Palette en hexadécimal brut, comme chez Clara : ApexCharts ne lit pas les
// tokens CSS du design system, il lui faut des couleurs littérales. C'est
// l'exception assumée au garde-fou `_adherence.oxlintrc.json` (hex bruts).
// CHART_COLORS[0] est le vert vif « --primary-bright » (#02D185 ≈ #0acf83).

import type { ApexOptions } from "apexcharts";

export const CHART_COLORS = [
  "#0acf83",
  "#ffcd57",
  "#3b82f6",
  "#f97316",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f43f5e",
  "#a3e635",
  "#fb923c",
];

export const FONT_FAMILY = "'Nunito Sans', sans-serif";

export const baseChart: ApexOptions["chart"] = {
  fontFamily: FONT_FAMILY,
  toolbar: {
    show: true,
    tools: {
      download: true,
      selection: true,
      zoom: true,
      zoomin: true,
      zoomout: true,
      pan: true,
      reset: true,
    },
    export: {
      csv: { columnDelimiter: ";" },
    },
  },
  zoom: { enabled: true },
};

export const baseGrid: ApexOptions["grid"] = {
  borderColor: "#e5e7eb",
  strokeDashArray: 4,
};

export const baseXAxis: ApexOptions["xaxis"] = {
  labels: { style: { fontFamily: FONT_FAMILY, fontSize: "11px" } },
  axisBorder: { show: false },
  axisTicks: { show: false },
};

export const baseYAxis: ApexOptions["yaxis"] = {
  labels: {
    style: { fontFamily: FONT_FAMILY, fontSize: "11px" },
    formatter: (v: number) => Math.round(v).toString(),
  },
};

export const baseTooltip: ApexOptions["tooltip"] = {
  style: { fontFamily: FONT_FAMILY },
};

export const baseLegend: ApexOptions["legend"] = {
  position: "bottom",
  fontSize: "11px",
  fontFamily: FONT_FAMILY,
};

/** Étiquettes d'axe entières seulement (un demi-courrier n'existe pas). */
export const integerAxisLabel = (v: string | number) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : "";
};
