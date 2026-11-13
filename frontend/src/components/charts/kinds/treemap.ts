import type { ChartPanel } from "@/api/dashboard";
import { categoryColor } from "@/theme/tokens";

import { groupsOf, type Theme } from "./shared";

/** Budget belongs to a project within a health group; both levels retain totals. */
export function treemap(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "item" },
    series: [{
      type: "treemap",
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      top: 8, bottom: 8, left: 0, right: 0,
      upperLabel: { show: true, height: 22 },
      itemStyle: { borderColor: theme.tooltip.backgroundColor, borderWidth: 2, gapWidth: 2 },
      data: groupsOf(panel).map((group, index) => ({
        name: group,
        itemStyle: { color: categoryColor(group, index) },
        children: panel.series.filter((point) => (point.group ?? "—") === group)
          .map((point) => ({ name: point.name, value: point.value })),
      })),
    }],
  };
}
