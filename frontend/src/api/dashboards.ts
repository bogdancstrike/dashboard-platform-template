import { api } from "./client";

/**
 * Dashboards: a saved layout of widgets (§45, §67).
 *
 * The endpoint stores *where the widgets are and what question each one asks*,
 * and computes nothing. A KPI is answered by `/api/explorer/insights`, a chart
 * by `/api/analysis/run`, a list by `/api/explorer/query`, the alert strip and
 * the activity feed by `/api/dashboard/*`. A widget is a reference to a
 * question, not a copy of one — which is what makes a saved chart usable as a
 * widget without being rebuilt.
 *
 * Sharing is the model saved searches and reports use: private by default,
 * shared with named members, public, and only the owner writes.
 */

export type DashboardScope = "PRIVATE" | "SHARED" | "PUBLIC";

/** Every widget the platform can draw. The server refuses anything else. */
export type WidgetKind =
  | "KPI"
  | "GAUGE"
  | "LIST"
  | "TABLE"
  | "ACTIVITY"
  | "ALERTS"
  | "LINE_CHART"
  | "AREA_CHART"
  | "BAR_CHART"
  | "PIE_CHART"
  | "HEATMAP"
  /** A chart with the whole vocabulary — the picture is configuration. */
  | "CHART"
  /** The dataset's declared metrics as a strip, the way `/analytics` opens. */
  | "ANALYTICS"
  /** Records on a map, from the same places endpoint `/maps` reads. */
  | "MAP"
  /** A saved report — the chart builder's own output, drawn where it was left. */
  | "REPORT"
  /** A saved search — a question composed in the explorer, answered here. */
  | "SEARCH"
  // ── modules ───────────────────────────────────────────────────────────
  // A window onto a page of the product rather than a question about a
  // dataset. Each is answered by that module's own endpoint, under that
  // module's own permission — so a widget is the page in miniature and not a
  // second implementation of it.
  | "TASKS"
  | "MAIL"
  | "FILES"
  | "NOTIFICATIONS"
  | "PROJECTS"
  | "ANNOUNCEMENTS"
  | "EXPLORER"
  | "RELATIONSHIPS"
  | "FAVORITES"
  | "CALENDAR";

/**
 * What one widget asks.
 *
 * Every field is optional because the *kind* decides which of them mean
 * anything, and because a widget with no dimension is complete: the dataset
 * declares which field it is worth grouping by, and a default read from the
 * declaration is derived rather than invented.
 */
export interface WidgetConfig {
  /** The dataset it reads. Absent on the platform-wide feeds. */
  entity?: string;
  /** For a KPI or a gauge: which of the dataset's declared metrics. */
  metric?: string;
  /** For a chart: the grouping, defaulting to the dataset's first declared one. */
  dimension?: string;
  /** For a chart over time: the bucket. */
  granularity?: string;
  /** For a chart: a second grouping — a stack, or a heatmap's columns. */
  stack?: string;
  /** For a chart: how to measure, defaulting to counting rows. */
  aggregation?: string;
  measure?: string;
  period?: string;
  filters?: Record<string, string>;
  /** A saved report this widget draws, instead of an inline question. */
  report_id?: string;
  /** A saved search this widget answers, instead of an inline query. */
  search_id?: string;
  /** For `CHART`: which picture, from the chart builder's own vocabulary. */
  chart?: string;

  // ── module options ────────────────────────────────────────────────────
  // Each module widget reads only the keys its own module understands; the
  // server drops the rest rather than storing configuration nothing reads.
  /** `TASKS`: one kanban board's lanes, instead of the task dataset. */
  board_id?: string;
  /** `TASKS`, `FILES`, `PROJECTS`: narrowed to this reader. */
  mine?: boolean;
  /** `TASKS`, `PROJECTS`: one state only. */
  status?: string;
  /** `MAIL`: which folder. */
  folder?: string;
  /** `MAIL`, `NOTIFICATIONS`: only what has not been read. */
  unread_only?: boolean;
  /** `FILES`: one folder of the tree. */
  folder_id?: string;
  /** `NOTIFICATIONS`, `ANNOUNCEMENTS`: one category. */
  category?: string;
  /** `CALENDAR`: how far ahead to look. */
  days?: number;
  /** `FAVORITES`: bookmarks, or the places you have been. */
  view?: string;
}

export interface DashboardWidget {
  id: string;
  kind: WidgetKind;
  title: string;
  subtitle: string | null;
  /** Grid geometry, in the dashboard's own column count. */
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
  config: WidgetConfig;
}

export interface SavedDashboard {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  scope: DashboardScope;
  icon: string | null;
  /** This reader's home dashboard (§67). One person has one. */
  is_home: boolean;
  is_default: boolean;
  columns: number;
  filters: Record<string, unknown>;
  owner: { id: string; name: string; email: string | null };
  /** Whether this reader may change it — owner, and holding dashboards.manage. */
  can_edit: boolean;
  members: { id: string; name: string; email: string }[];
  widget_count: number;
  /** *What* it holds — a reader recognises "alerts, revenue, a heatmap" far
   *  faster than "7 widgets". */
  widget_kinds: WidgetKind[];
  created_at: string | null;
  updated_at: string | null;
  /** Present on a single dashboard, absent from the listing. */
  widgets?: DashboardWidget[];
}

export interface DashboardList {
  items: SavedDashboard[];
  total: number;
  /** The kinds a builder may offer, from the server that refuses the rest. */
  widget_kinds: WidgetKind[];
  columns: number;
  /** Only the datasets this reader may read, so a widget cannot be pointed at
   *  one that would always answer forbidden. */
  datasets: { key: string; label: string; path: string }[];
  can_create: boolean;
  can_share: boolean;
}

export interface DashboardInput {
  name?: string;
  /** Widgets to create it holding. One request, so it is never half-built. */
  widgets?: { kind: WidgetKind; title?: string; config?: WidgetConfig }[];
  description?: string | null;
  scope?: DashboardScope;
  icon?: string | null;
  is_home?: boolean;
  filters?: Record<string, unknown>;
  member_ids?: string[];
}

export interface WidgetInput {
  kind?: WidgetKind;
  title?: string;
  subtitle?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  config?: WidgetConfig;
}

/** One drag's worth of geometry — every widget, because one move reflows many. */
export interface Placement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const dashboardsApi = {
  list: (signal?: AbortSignal) => api.get<DashboardList>("/api/dashboards", { signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<SavedDashboard>(`/api/dashboards/${id}`, { signal }),
  create: (input: DashboardInput) => api.post<SavedDashboard>("/api/dashboards", input),
  update: (id: string, input: DashboardInput) =>
    api.put<SavedDashboard>(`/api/dashboards/${id}`, input),
  remove: (id: string) =>
    api.delete<{ id: string; deleted: boolean; name: string }>(`/api/dashboards/${id}`),

  addWidget: (id: string, input: WidgetInput) =>
    api.post<SavedDashboard>(`/api/dashboards/${id}/widgets`, input),
  updateWidget: (id: string, widgetId: string, input: WidgetInput) =>
    api.put<SavedDashboard>(`/api/dashboards/${id}/widgets/${widgetId}`, input),
  removeWidget: (id: string, widgetId: string) =>
    api.delete<SavedDashboard>(`/api/dashboards/${id}/widgets/${widgetId}`),
  arrange: (id: string, widgets: Placement[]) =>
    api.put<SavedDashboard>(`/api/dashboards/${id}/arrange`, { widgets }),

  /**
   * A private copy of a dashboard, owned by whoever asked for it.
   *
   * What makes sharing worth having: a colleague's layout is something to
   * adopt and adapt, not only to look at. The copy shares nothing — inheriting
   * the original's audience would publish your adaptation to their members.
   */
  duplicate: (id: string) => api.post<SavedDashboard>(`/api/dashboards/${id}/duplicate`, {}),
};
