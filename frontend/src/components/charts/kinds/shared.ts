/** What every chart builder shares: the themed base's type, the axis helpers and the compact number format. */

import type { ChartPanel } from "@/api/dashboard";
import type { buildChartTheme } from "@/theme/echarts";

export type Theme = ReturnType<typeof buildChartTheme>;

export function compactNumber(value: number): string {
  const size = Math.abs(value);
  if (size >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (size >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (size >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value * 100) / 100);
}

/** Distinct groups, in the order the server declared or first sighting. */
export function groupsOf(panel: ChartPanel): string[] {
  if (panel.groups && panel.groups.length > 0) return panel.groups;
  const seen: string[] = [];
  for (const point of panel.series) {
    const group = point.group ?? "—";
    if (!seen.includes(group)) seen.push(group);
  }
  return seen;
}

/** Distinct buckets or names along the category axis, in series order. */
export function categoriesOf(panel: ChartPanel): string[] {
  const seen: string[] = [];
  for (const point of panel.series) {
    const key = point.bucket ?? point.name ?? "—";
    if (!seen.includes(key)) seen.push(key);
  }
  return panel.series.some((point) => point.bucket !== undefined) ? seen.sort() : seen;
}

export function labelFor(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The value at (category, group), or zero.
 *
 * Zero rather than absent: a stacked bar with a hole in it is drawn as a
 * shorter stack, and the reader cannot tell "no orders that week" from "that
 * channel was missing from the result".
 */
export function table(panel: ChartPanel, categories: string[], groups: string[]): number[][] {
  const cells = groups.map(() => categories.map(() => 0));
  for (const point of panel.series) {
    const column = categories.indexOf(point.bucket ?? point.name ?? "—");
    const row = groups.indexOf(point.group ?? "—");
    if (column >= 0 && row >= 0) cells[row]![column]! += point.value;
  }
  return cells;
}
