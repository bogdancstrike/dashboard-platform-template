import type { ChartPanel, ChartPoint } from "@/api/dashboard";
import { SEMANTIC } from "@/theme/tokens";

import type { Theme } from "./shared";

export function gauge(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const point: ChartPoint = panel.series[0] ?? { value: 0 };
  // Green above 90, amber above 75, red below — the thresholds an operations
  // team already argues in, rather than a gradient nobody reads a number off.
  const colour =
    point.value >= 90 ? SEMANTIC.success : point.value >= 75 ? SEMANTIC.warning : SEMANTIC.danger;

  return {
    ...theme,
    tooltip: { show: false },
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        radius: "92%",
        center: ["50%", "58%"],
        progress: { show: true, width: 14, itemStyle: { color: colour } },
        axisLine: { lineStyle: { width: 14 } },
        axisTick: { show: false },
        splitLine: { length: 8, lineStyle: { width: 1 } },
        axisLabel: { distance: 16, fontSize: 10 },
        pointer: { show: false },
        anchor: { show: false },
        title: { offsetCenter: [0, "34%"], fontSize: 11 },
        detail: {
          offsetCenter: [0, "-4%"],
          fontSize: 30,
          fontWeight: 600,
          color: colour,
          formatter: "{value}%",
        },
        data: [{ value: point.value, name: point.name ?? "" }],
      },
    ],
  };
}
