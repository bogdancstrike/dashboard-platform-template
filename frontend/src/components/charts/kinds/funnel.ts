import { format } from "echarts";

import type { ChartPanel } from "@/api/dashboard";
import { SERIES } from "@/theme/tokens";

import type { Theme } from "./shared";

export function funnel(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const first = panel.series[0]?.value ?? 0;
  return {
    ...theme,
    tooltip: {
      ...theme.tooltip,
      trigger: "item",
      // Share of the *first* stage, which is the number somebody is after:
      // "62% of orders placed reached delivery".
      formatter: (params: { name?: string; value?: number }) =>
        `${format.encodeHTML(params.name ?? "")}<br/>${(params.value ?? 0).toLocaleString()}` +
        (first ? ` · ${Math.round((100 * (params.value ?? 0)) / first)}% of placed` : ""),
    },
    legend: { ...theme.legend, bottom: 0 },
    series: [
      {
        type: "funnel",
        top: 10,
        bottom: 34,
        left: "8%",
        width: "84%",
        minSize: "24%",
        sort: "none",
        gap: 3,
        label: { show: true, position: "inside", fontWeight: 600 },
        itemStyle: { borderWidth: 0 },
        data: panel.series.map((point, index) => ({
          name: point.name ?? "—",
          value: point.value,
          itemStyle: { color: SERIES[index % SERIES.length] },
        })),
      },
    ],
  };
}
