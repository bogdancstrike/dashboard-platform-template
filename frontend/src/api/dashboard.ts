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
}

export interface ChartPanel {
  kind: "line" | "area" | "bar" | "pie";
  title: string;
  series: ChartPoint[];
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

/** The chart panels, in the order the dashboard lays them out. */
export const CHART_KEYS = [
  "revenue_over_time",
  "orders_over_time",
  "tickets_by_category",
  "projects_by_health",
  "tasks_by_status",
  "revenue_by_region",
] as const;
