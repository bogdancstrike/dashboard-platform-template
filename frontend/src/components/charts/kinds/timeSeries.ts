import type { ChartPanel } from "@/api/dashboard";

import { categoriesOf, compactNumber, labelFor, type Theme } from "./shared";

export function timeSeries(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const categories = categoriesOf(panel);
  const isTime = panel.series.some((point) => point.bucket !== undefined);
  const crowded = !isTime && categories.length > 4;

  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "axis" },
    grid: { ...theme.grid, top: 16, bottom: crowded ? 28 : 4 },
    xAxis: {
      ...theme.categoryAxis,
      type: "category",
      data: categories.map(labelFor),
      axisLabel: {
        ...theme.categoryAxis.axisLabel,
        interval: isTime ? "auto" : 0,
        rotate: crowded ? 30 : 0,
        hideOverlap: isTime,
        ...(crowded ? { width: 84, overflow: "truncate" } : {}),
      },
    },
    yAxis: {
      ...theme.valueAxis,
      type: "value",
      axisLabel: { ...theme.valueAxis.axisLabel, formatter: compactNumber },
    },
    series: [
      {
        type: "line",
        data: panel.series.map((point) => point.value),
        smooth: false,
        symbol: isTime ? "none" : "circle",
        itemStyle: { color: theme.accent },
        lineStyle: { width: 2.5, color: theme.accent },
        ...(panel.kind === "area"
          ? {
              areaStyle: {
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: `${theme.accent}47` },
                    { offset: 1, color: `${theme.accent}05` },
                  ],
                },
              },
            }
          : {}),
      },
    ],
  };
}
