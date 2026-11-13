import type { ChartPanel } from "@/api/dashboard";
import { SERIES } from "@/theme/tokens";

import { categoriesOf, compactNumber, groupsOf, labelFor, table, type Theme } from "./shared";

/**
 * Several series over time, as lines or as a filled stack.
 *
 * One function for both because the *question* differs by one word and the
 * geometry does not: "which way are these going, against each other" wants
 * lines that cross, and "what is the total made of, over time" wants them
 * stacked so the top edge is the total. A separate renderer for the second
 * would be the first with `stack` set, and would drift.
 */
export function multiLine(
  panel: ChartPanel,
  theme: Theme,
  filled: boolean,
): Record<string, unknown> {
  const categories = categoriesOf(panel);
  const groups = groupsOf(panel);
  const cells = table(panel, categories, groups);

  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "axis" },
    legend: { ...theme.legend, bottom: 0, data: groups },
    grid: { ...theme.grid, top: 16, bottom: 32 },
    xAxis: {
      ...theme.categoryAxis,
      type: "category",
      data: categories.map(labelFor),
      axisLabel: { ...theme.categoryAxis.axisLabel, hideOverlap: true },
    },
    yAxis: {
      ...theme.valueAxis,
      type: "value",
      axisLabel: { ...theme.valueAxis.axisLabel, formatter: compactNumber },
    },
    series: groups.map((group, index) => ({
      name: group,
      type: "line",
      smooth: true,
      symbol: "none",
      // Stacked, and therefore filled: an unfilled stack reads as five lines
      // that happen not to cross, which is the opposite of what it says.
      ...(filled
        ? {
            stack: "total",
            areaStyle: { color: SERIES[index % SERIES.length], opacity: 0.75 },
            lineStyle: { width: 1, color: SERIES[index % SERIES.length] },
          }
        : { lineStyle: { width: 2, color: SERIES[index % SERIES.length] } }),
      itemStyle: { color: SERIES[index % SERIES.length] },
      data: cells[index],
    })),
  };
}
