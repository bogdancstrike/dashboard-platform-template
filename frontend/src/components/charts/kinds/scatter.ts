import { format } from "echarts";

import type { ChartPanel } from "@/api/dashboard";
import { categoryColor } from "@/theme/tokens";

import { compactNumber, groupsOf, type Theme } from "./shared";

/**
 * Two measures against each other, one point per record.
 *
 * The axis names and their unit come from the panel. A scatter whose renderer
 * knows it is about budget and progress is a scatter that can only ever be
 * about budget and progress — and a correlation is exactly the chart a builder
 * should be able to point at any two numbers.
 */
export function scatter(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const groups = groupsOf(panel);
  const biggest = Math.max(...panel.series.map((point) => point.value), 1);
  const axes = panel.axes ?? { x: "x", y: "y" };
  const suffix = axes.format === "percent" ? "%" : "";
  // A percentage axis is bounded by its own definition; anything else is
  // bounded by the data, and forcing 0–100 onto revenue draws every point in
  // the bottom-left corner.
  const bound = (values: number[]) =>
    axes.format === "percent" ? Math.max(100, ...values) : undefined;

  return {
    ...theme,
    tooltip: {
      ...theme.tooltip,
      trigger: "item",
      formatter: (params: { data?: { name?: string; value?: number[] } }) => {
        const value = params.data?.value;
        if (!value) return "";
        return `${format.encodeHTML(params.data?.name ?? "")}<br/>${format.encodeHTML(
          axes.x,
        )} ${compactNumber(value[0] ?? 0)}${suffix} · ${format.encodeHTML(
          axes.y,
        )} ${compactNumber(value[1] ?? 0)}${suffix}`;
      },
    },
    // A legend of one unnamed series is a legend that says "—". It appears
    // when the points are actually grouped and not before.
    legend:
      groups.length > 1
        ? { ...theme.legend, bottom: 0, data: groups }
        : { show: false },
    grid: { ...theme.grid, top: 16, bottom: groups.length > 1 ? 34 : 12, left: 56 },
    xAxis: {
      ...theme.valueAxis,
      type: "value",
      name: axes.x,
      nameLocation: "middle",
      nameGap: 24,
      max: bound(panel.series.map((point) => point.x ?? 0)),
      axisLabel: { ...theme.valueAxis.axisLabel, formatter: `{value}${suffix}` },
    },
    yAxis: {
      ...theme.valueAxis,
      type: "value",
      // Along the axis rather than above its corner: ECharts' default parks a
      // vertical axis name in the top-left, where it is read as a stray word.
      name: axes.y,
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 44,
      max: bound(panel.series.map((point) => point.y ?? 0)),
      axisLabel: { ...theme.valueAxis.axisLabel, formatter: `{value}${suffix}` },
    },
    series: groups.map((group, index) => ({
      name: group,
      type: "scatter",
      // Sized by the third number, when there is one: a €4M project off the
      // diagonal matters more than a €40k one in the same place.
      symbolSize: (value: number[]) => 8 + Math.sqrt((value[2] ?? 0) / biggest) * 22,
      itemStyle: { color: categoryColor(group, index), opacity: 0.85 },
      data: panel.series
        .filter((point) => (point.group ?? "—") === group)
        .map((point) => ({ name: point.name, value: [point.x ?? 0, point.y ?? 0, point.value] })),
    })),
  };
}
