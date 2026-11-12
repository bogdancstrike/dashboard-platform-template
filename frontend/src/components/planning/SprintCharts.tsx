/**
 * The two charts a sprint is judged by (§18).
 *
 * **Burndown** — points remaining per day against the ideal straight line
 * from the commitment to zero. The actual line is the daily snapshots, so a
 * flat week then a cliff is visible as exactly that; scope added mid-sprint is
 * drawn as its own faint line, because a burndown that silently absorbs new
 * work lies about progress.
 *
 * **Velocity** — committed against completed for the last sprints, with the
 * average as a line: the number the next planning meeting should use.
 */

import ReactECharts from "echarts-for-react";

import type { Burndown, Velocity } from "@/api/planning";
import { EmptyState } from "@/components/EmptyState";
import { useAppearance } from "@/theme/AppearanceProvider";

import { shortDate } from "./gantt";

type Theme = ReturnType<typeof useAppearance>["chartTheme"];

export function burndownOption(burndown: Burndown, theme: Theme) {
  const labels = burndown.days.map(shortDate);
  return {
    color: [theme.accent, "#9aa3b2", "#e0a106"],
    textStyle: theme.textStyle,
    aria: { enabled: true },
    tooltip: { trigger: "axis", valueFormatter: (value: unknown) => (typeof value === "number" ? `${value} pts` : "—") },
    legend: { top: 0, data: ["Remaining", "Ideal", "Scope"], textStyle: theme.textStyle },
    grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
    xAxis: { type: "category", data: labels, boundaryGap: false, ...theme.categoryAxis },
    yAxis: { type: "value", name: "Points", min: 0, ...theme.valueAxis },
    series: [
      {
        name: "Remaining",
        type: "line",
        step: "end",
        data: burndown.actual,
        symbolSize: 6,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.12 },
      },
      { name: "Ideal", type: "line", data: burndown.ideal, symbol: "none", lineStyle: { type: "dashed", width: 1.5 } },
      { name: "Scope", type: "line", step: "end", data: burndown.scope, symbol: "none", lineStyle: { width: 1, opacity: 0.6 } },
    ],
  };
}

export function velocityOption(velocity: Velocity, theme: Theme) {
  const names = velocity.items.map((item) => item.name.replace(/^.*?(Sprint)/, "$1"));
  return {
    color: ["#c3cbe0", theme.accent, "#e0a106"],
    textStyle: theme.textStyle,
    aria: { enabled: true },
    tooltip: { trigger: "axis", valueFormatter: (value: unknown) => (typeof value === "number" ? `${value} pts` : "—") },
    legend: { top: 0, data: ["Committed", "Completed", "Average"], textStyle: theme.textStyle },
    grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
    xAxis: { type: "category", data: names, ...theme.categoryAxis },
    yAxis: { type: "value", name: "Points", min: 0, ...theme.valueAxis },
    series: [
      { name: "Committed", type: "bar", data: velocity.items.map((item) => item.committed), barGap: "10%", itemStyle: { borderRadius: [6, 6, 0, 0] } },
      { name: "Completed", type: "bar", data: velocity.items.map((item) => item.completed), itemStyle: { borderRadius: [6, 6, 0, 0] } },
      {
        name: "Average",
        type: "line",
        data: velocity.items.map(() => velocity.average),
        symbol: "none",
        lineStyle: { type: "dashed", width: 1.5 },
      },
    ],
  };
}

export function BurndownChart({ burndown, height = 260 }: { burndown: Burndown; height?: number }) {
  const { chartTheme } = useAppearance();
  if (burndown.days.length === 0) {
    return <EmptyState compact title="No dates yet" hint="Give the sprint a start and an end to draw its burndown." />;
  }
  return (
    <div data-testid="burndown-chart" aria-label="Burndown chart">
      <ReactECharts option={burndownOption(burndown, chartTheme)} style={{ height }} notMerge />
    </div>
  );
}

export function VelocityChart({ velocity, height = 260 }: { velocity: Velocity; height?: number }) {
  const { chartTheme } = useAppearance();
  if (velocity.items.length === 0) {
    return <EmptyState compact title="No finished sprints yet" hint="Velocity appears once a sprint is completed." />;
  }
  return (
    <div data-testid="velocity-chart" aria-label="Velocity chart">
      <ReactECharts option={velocityOption(velocity, chartTheme)} style={{ height }} notMerge />
    </div>
  );
}
