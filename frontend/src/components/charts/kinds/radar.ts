import type { ChartPanel } from "@/api/dashboard";

import type { Theme } from "./shared";

/** Shared count scale keeps the radar's axes comparable. */
export function radar(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const max = Math.max(1, ...panel.series.map((point) => point.value));
  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "item" },
    radar: {
      radius: "62%",
      indicator: panel.series.map((point) => ({ name: point.name, max })),
      axisName: { color: theme.textStyle.color },
      splitLine: theme.valueAxis.splitLine,
      splitArea: { show: false },
    },
    series: [{
      type: "radar",
      data: [{ name: panel.title, value: panel.series.map((point) => point.value) }],
      areaStyle: { opacity: 0.15 },
    }],
  };
}
