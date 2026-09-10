// Point d'entrée unique vers le composant ApexCharts pour React.
//
// `react-apexcharts@1.5.0` (le dernier wrapper qui accepte ApexCharts 3, le
// moteur de Clara) n'est publié qu'en CommonJS (`exports.default = Charts`).
// Selon le chemin d'import — pré-bundle Vite en dev, Rolldown en prod — la
// valeur reçue par `import X from` est tantôt le composant, tantôt l'objet
// `{ default: composant }` (vu en dev le 2026-09-18 : « type is invalid …
// got: object »). On déballe ici, une fois, plutôt que dans chaque graphique.

import type * as React from "react";
import * as mod from "react-apexcharts";

type ChartComponent = React.ComponentType<import("react-apexcharts").Props>;

function unwrap(value: unknown): ChartComponent | null {
  if (typeof value === "function") return value as ChartComponent;
  if (value && typeof value === "object" && "default" in value) {
    return unwrap((value as { default: unknown }).default);
  }
  return null;
}

const resolved = unwrap(mod);
if (!resolved) {
  throw new Error("react-apexcharts : composant introuvable dans le module importé.");
}

export const ReactApexChart: ChartComponent = resolved;
