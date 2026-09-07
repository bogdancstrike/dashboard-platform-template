import { api } from "./client";

export type Polarity = "up_is_good" | "down_is_good" | "neutral";
export type Trend = "up" | "down" | "flat";

export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: string;
  previous: number;
  change_percent: number;
  trend: Trend;
  polarity: Polarity;
  icon: string;
  accent: string;
  /** The list this tile drills into, filters already applied (§44). */
  link: string;
  hint: string;
}

export interface ChartPoint {
  bucket?: string;
  name?: string;
  value: number;
  /** The second dimension: a stack, a line in a multi-line, a heatmap column. */
  group?: string;
  /** Scatter only — the two measures being correlated. */
  x?: number;
  y?: number;
}

/**
 * The chart vocabulary the platform themes and draws.
 *
 * Wide on purpose. This is a template, and one that only ships a bar chart
 * teaches people to reach for a bar chart. Each kind is here because a
 * question wanted it: a funnel because fulfilment is a sequence with drop-off,
 * a heatmap because "when are we busy" is two dimensions, a scatter because a
 * correlation drawn as two bar charts is not a correlation.
 */
export type ChartKind =
  | "line"
  | "area"
  | "bar"
  | "hbar"
  | "pie"
  | "multi-line"
  | "stacked-bar"
  | "stacked-hbar"
  | "funnel"
  | "gauge"
  | "heatmap"
  | "scatter"
  | "radar"
  | "treemap";

export interface ChartPanel {
  kind: ChartKind;
  title: string;
  series: ChartPoint[];
  /** For the stacked and multi-series kinds: the stacks, in order. Also the
   *  heatmap's horizontal axis, which is a second dimension rather than a
   *  stack — the same field, read the way that kind reads it. */
  groups?: string[];
  /**
   * The category axis in the order it should be drawn, when first sighting is
   * the wrong order.
   *
   * A heatmap of weekdays has to read Mon→Sun whatever order the rows arrive
   * in, and only whoever asked the question knows that. Absent means "the
   * order the rows came in", which is right for anything the server already
   * sorted.
   */
  categories?: string[];
  /**
   * What the two axes of a scatter *mean*.
   *
   * Named by the panel because a renderer that knows one chart is about
   * budget and progress is a renderer that can only ever draw that chart. The
   * dashboard declares its own; a chart built from an analysis declares the
   * two measures it chose.
   */
  axes?: { x: string; y: string; format?: "percent" | "number" | "currency" };
  /** A formatting hint — `currency`, `percent`. */
  unit?: string;
  /** Scope/caveat displayed alongside the panel, including snapshot metrics. */
  description?: string;
}

export interface DashboardAlert {
  key: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  count: number;
  message: string;
  link: string;
  icon: string;
}

export interface ActivityEntry {
  id: string;
  kind: string;
  action: string;
  actor: string;
  summary: string;
  resource_type: string | null;
  resource_id: string | null;
  resource_label: string | null;
  occurred_at: string;
}

export interface DashboardSummary {
  period: {
    key: string;
    from: string;
    to: string;
    previous_from: string;
    previous_to: string;
    options: { key: string; label: string }[];
  };
  kpis: Kpi[];
  charts: Record<string, ChartPanel | string> & { grain: string };
  alerts: DashboardAlert[];
  activity: ActivityEntry[];
  generated_at: string;
}

export const dashboardApi = {
  summary: (params: { period?: string; from?: string; to?: string }, signal?: AbortSignal) =>
    api.get<DashboardSummary>("/dashboard/summary", { params, signal }),
  alerts: (signal?: AbortSignal) =>
    api.get<{ items: DashboardAlert[]; total: number }>("/dashboard/alerts", { signal }),
};

/**
 * The panels, in the order the dashboard lays them out.
 *
 * Ordered by the question they answer rather than by chart kind: money first,
 * then demand, then delivery, then the fleet. A dashboard sorted by chart type
 * is a gallery.
 */
export const CHART_KEYS = [
  "revenue_over_time",
  "orders_by_channel",
  "fulfilment_funnel",
  "top_customers",
  "ticket_flow",
  "sla_gauge",
  "support_load",
  "tickets_by_category",
  "budget_vs_progress",
  "projects_by_health",
  "tasks_by_status",
  "device_health",
  "support_profile",
  "portfolio_budget",
  "revenue_by_region",
  "orders_over_time",
] as const;
