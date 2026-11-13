import { format } from "echarts";

import type { ChartPanel } from "@/api/dashboard";
import { SERIES } from "@/theme/tokens";

import { categoriesOf, groupsOf, type Theme } from "./shared";

/**
 * Two dimensions and a count, as a grid.
 *
 * The axes are the panel's own — `groups` across, `categories` down — rather
 * than a weekday-by-hour calendar written in here. A renderer that knows one
 * chart is about weekdays can only ever draw that chart, and "when are we
 * busy" is one of many two-dimensional questions.
 */
export function heatmap(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const columns = panel.groups ?? groupsOf(panel);
  const rows = panel.categories ?? categoriesOf(panel);
  const max = Math.max(...panel.series.map((point) => point.value), 1);

  return {
    ...theme,
    tooltip: {
      ...theme.tooltip,
      trigger: "item",
      formatter: (params: { value?: number[] }) =>
        params.value
          ? `${format.encodeHTML(rows[params.value[1] ?? 0] ?? "")} · ${format.encodeHTML(
              columns[params.value[0] ?? 0] ?? "",
            )} · ${params.value[2] ?? 0}`
          : "",
    },
    grid: { ...theme.grid, top: 10, bottom: 46, left: 44, right: 12 },
    xAxis: {
      ...theme.categoryAxis,
      type: "category",
      data: columns,
      splitArea: { show: true },
      // Every other label once the axis is crowded. Twenty-four hours do not
      // fit; six channels do, and thinning those would hide half of them.
      axisLabel: {
        ...theme.categoryAxis.axisLabel,
        interval: columns.length > 12 ? 2 : 0,
      },
    },
    yAxis: { ...theme.categoryAxis, type: "category", data: rows, splitArea: { show: true } },
    visualMap: {
      min: 0,
      max,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 80,
      textStyle: theme.categoryAxis.axisLabel,
      // A single-hue ramp: two hues in a heatmap read as two categories.
      inRange: { color: [theme.tooltip.backgroundColor, SERIES[0]] },
    },
    series: [
      {
        type: "heatmap",
        data: panel.series.map((point) => [
          columns.indexOf(point.group ?? "—"),
          rows.indexOf(point.name ?? "—"),
          point.value,
        ]),
        label: { show: false },
        itemStyle: { borderWidth: 1, borderColor: "transparent" },
      },
    ],
  };
}
