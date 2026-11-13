import type { ChartPanel } from "@/api/dashboard";
import { categoryColor } from "@/theme/tokens";

import { compactNumber, type Theme } from "./shared";

/**
 * A donut, with the total in the hole.
 *
 * The hole was empty, which wastes the most legible spot on the chart: the
 * question a share chart raises first is "of how many?", and a reader who
 * cannot see the total has to add five slices in their head or go and find the
 * number somewhere else. It is the sum of what is *drawn* — a truncated
 * breakdown folds its remainder into an "Other" slice, so the sum of the
 * slices is the whole and no separate figure can disagree with the picture.
 */
export function pie(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const total = panel.series.reduce((sum, point) => sum + point.value, 0);
  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "item" },
    legend: { ...theme.legend, bottom: 0, left: "center" },
    // The number, and what it counts, centred in the ring. `title` rather than
    // a `graphic`: it is themed with everything else and moves with the chart
    // when the card is resized.
    title: {
      text: compactNumber(total),
      subtext: "total",
      left: "50%",
      top: "34%",
      textAlign: "center",
      textStyle: {
        color: theme.valueAxis.axisLabel.color,
        fontSize: 20,
        fontWeight: 650,
      },
      subtextStyle: { color: theme.categoryAxis.axisLabel.color, fontSize: 11 },
    },
    series: [
      {
        type: "pie",
        // Sized to leave the bottom band to the legend at any height.
        radius: ["40%", "62%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: true,
        itemStyle: theme.pie.itemStyle,
        label: { show: false },
        data: panel.series.map((point, index) => ({
          name: point.name ?? "—",
          value: point.value,
          itemStyle: { color: categoryColor(point.name, index) },
        })),
      },
    ],
  };
}
