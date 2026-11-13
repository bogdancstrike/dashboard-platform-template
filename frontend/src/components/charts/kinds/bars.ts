import type { ChartPanel } from "@/api/dashboard";
import { categoryColor, knownStatusColor } from "@/theme/tokens";

import { categoriesOf, compactNumber, groupsOf, labelFor, table, type Theme } from "./shared";

/**
 * One bar's colour, as the canvas draws a single series: the first (largest)
 * bar in the accent and the rest in a lighter step of it — one hue, so the
 * eye compares lengths rather than reading a rainbow as categories. A value
 * that names a known status keeps that status's colour, because "Done" in
 * red would be a lie told in paint.
 */
function barColor(name: string | null | undefined, index: number, theme: Theme): string {
  const known = knownStatusColor(name);
  if (known) return known;
  // Rank-graded: full accent, then lighter steps down to about 45%.
  const alpha = index === 0 ? 1 : Math.max(0.45, 0.8 - (index - 1) * 0.07);
  return `${theme.accent}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

export function bars(panel: ChartPanel, theme: Theme, horizontal: boolean): Record<string, unknown> {
  const categories = categoriesOf(panel);
  const crowded = !horizontal && categories.length > 4;
  const value = {
    ...theme.valueAxis,
    type: "value",
    axisLabel: { ...theme.valueAxis.axisLabel, formatter: compactNumber },
  };
  const category = {
    ...theme.categoryAxis,
    type: "category",
    // A horizontal bar chart is read top to bottom and the server sent the
    // largest first, so the axis is inverted to keep it at the top.
    ...(horizontal ? { inverse: true } : {}),
    data: categories.map(labelFor),
    axisLabel: {
      ...theme.categoryAxis.axisLabel,
      interval: 0,
      hideOverlap: true,
      rotate: crowded ? 30 : 0,
      ...(horizontal ? { width: 130, overflow: "truncate" } : {}),
      ...(crowded ? { width: 84, overflow: "truncate" } : {}),
    },
  };

  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
    grid: {
      ...theme.grid,
      top: 16,
      bottom: crowded ? 28 : 4,
      ...(horizontal ? { left: 150 } : {}),
    },
    xAxis: horizontal ? value : category,
    yAxis: horizontal ? category : value,
    series: [
      {
        type: "bar",
        barMaxWidth: horizontal ? 18 : 56,
        // The value on the bar, as the canvas draws it, while there is room.
        label: {
          show: categories.length <= 12,
          position: horizontal ? "right" : "top",
          color: theme.valueAxis.axisLabel.color,
          fontSize: 11,
          formatter: (params: { value: number }) => compactNumber(params.value),
        },
        data: panel.series.map((point, index) => ({
          value: point.value,
          itemStyle: {
            color: barColor(point.name, index, theme),
            borderRadius: horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0],
          },
        })),
      },
    ],
  };
}

export function stacked(panel: ChartPanel, theme: Theme, horizontal: boolean): Record<string, unknown> {
  const categories = categoriesOf(panel);
  const groups = groupsOf(panel);
  const cells = table(panel, categories, groups);

  const value = {
    ...theme.valueAxis,
    type: "value",
    axisLabel: { ...theme.valueAxis.axisLabel, formatter: compactNumber },
  };
  const category = {
    ...theme.categoryAxis,
    type: "category",
    ...(horizontal ? { inverse: true } : {}),
    data: categories.map(labelFor),
    axisLabel: {
      ...theme.categoryAxis.axisLabel,
      hideOverlap: true,
      ...(horizontal ? { width: 110, overflow: "truncate" } : {}),
    },
  };

  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { ...theme.legend, bottom: 0, data: groups },
    grid: { ...theme.grid, top: 16, bottom: 32, ...(horizontal ? { left: 130 } : {}) },
    xAxis: horizontal ? value : category,
    yAxis: horizontal ? category : value,
    series: groups.map((group, index) => ({
      name: group,
      type: "bar",
      stack: "total",
      barMaxWidth: 26,
      itemStyle: { color: categoryColor(group, index) },
      data: cells[index],
    })),
  };
}
