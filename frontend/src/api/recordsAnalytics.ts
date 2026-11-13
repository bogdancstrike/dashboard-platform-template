/**
 * Records & analytics (§12, §13, §17, §18, §22, §25): customer health,
 * contracts and renewals, record version history, metric anomaly watches and
 * public dashboard links. One module because the six share types (a health
 * band rides on a contract, a contract has versions) and one prefix of pages.
 */

import { API_PREFIX } from "@/config";

import { api, ApiError, type ApiErrorBody } from "./client";
import type { AnalysisResult } from "./analysis";

// ── customer health ─────────────────────────────────────────────────────

export type HealthBand = "HEALTHY" | "AT_RISK" | "CRITICAL";
export type HealthSignal = "tickets" | "orders" | "usage" | "renewal";

export interface HealthFact {
  text: string;
  impact: number;
}

export interface HealthComponent {
  key: HealthSignal;
  label: string;
  score: number;
  weight: number;
  share: number;
  contribution: number;
  facts: HealthFact[];
  inputs: Record<string, unknown>;
}

export interface CustomerHealth {
  customer: { id: string; name: string; code: string };
  score: number;
  band: HealthBand;
  band_label: string;
  previous_band: HealthBand | null;
  band_changed_at: string | null;
  delta_7d: number | null;
  delta_30d: number | null;
  computed_at: string | null;
  components: HealthComponent[];
  trend: { day: string; score: number; band: HealthBand; components: Record<string, number> }[];
  thresholds: { healthy: number; at_risk: number };
}

export interface PortfolioEntry {
  id: string;
  name: string;
  code: string;
  segment: string;
  score: number;
  band: HealthBand;
  previous_band: HealthBand | null;
  delta_7d: number | null;
  delta_30d: number | null;
  lifetime_value: number;
  band_changed_at: string | null;
}

export interface HealthPortfolio {
  total: number;
  average: number | null;
  distribution: { band: HealthBand; label: string; count: number }[];
  histogram: { from: number; to: number; count: number }[];
  movers: { period: "7d" | "30d"; up: PortfolioEntry[]; down: PortfolioEntry[] };
  drops: PortfolioEntry[];
  items: PortfolioEntry[];
  matching: number;
  page: number;
  page_size: number;
  computed_at: string | null;
  thresholds: { healthy: number; at_risk: number };
  can_configure: boolean;
}

export interface HealthModel {
  id: string;
  name: string;
  weights: Record<HealthSignal, number>;
  thresholds: {
    bands: { healthy: number; at_risk: number };
    tickets: { open: number; escalated: number; breached: number };
    orders: { recency_days: number; window_days: number };
    usage: { contact_days: number };
    renewal: { window_days: number };
  };
  signals: { key: HealthSignal; label: string }[];
  bands: { key: HealthBand; label: string }[];
  updated_at: string | null;
  can_configure: boolean;
}

export const healthApi = {
  portfolio: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<HealthPortfolio>("/api/customer-health", { params, signal }),
  customer: (id: string, days = 90, signal?: AbortSignal) =>
    api.get<CustomerHealth>(`/api/customer-health/customers/${id}`, { params: { days }, signal }),
  model: (signal?: AbortSignal) => api.get<HealthModel>("/api/customer-health/model", { signal }),
  saveModel: (body: Partial<Pick<HealthModel, "name" | "weights">> & { thresholds?: Partial<HealthModel["thresholds"]> }) =>
    api.put<HealthModel & { recomputed: { customers: number } }>("/api/customer-health/model", body),
  recompute: () => api.post<{ status: string; customers: number; dropped: number }>("/api/customer-health/recompute"),
};

export const BAND_LABEL: Record<HealthBand, string> = {
  HEALTHY: "Healthy",
  AT_RISK: "At risk",
  CRITICAL: "Critical",
};

// ── contracts ───────────────────────────────────────────────────────────

export type ContractStage = "UPCOMING" | "NEGOTIATION" | "COMMITTED" | "RENEWED" | "CHURNED";

export interface ContractCard {
  id: string;
  reference: string;
  title: string;
  customer: { id: string; name: string | null; code: string | null };
  owner: { id: string | null; name: string | null };
  value: number;
  weighted: number;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  days_to_end: number | null;
  stage: ContractStage;
  stage_label: string;
  probability: number;
  rank: number;
  auto_renew: boolean;
  health_band: HealthBand | null;
  health_score: number | null;
  at_risk: boolean;
  updated_at: string | null;
}

export interface ContractDetail extends ContractCard {
  term_months: number;
  billing: string;
  notice_days: number;
  notice_by: string | null;
  terms: string | null;
  notes: string | null;
  churn_reason: string | null;
  stage_changed_at: string | null;
  closed_at: string | null;
  folder_id: string | null;
  created_at: string | null;
  can_edit: boolean;
}

export interface ContractSummary {
  open: number;
  pipeline: number;
  weighted: number;
  at_risk: number;
  at_risk_value: number;
  due_90: number;
}

export interface ContractColumn {
  stage: ContractStage;
  label: string;
  probability: number;
  count: number;
  value: number;
  weighted: number;
  at_risk: number;
  cards: ContractCard[];
}

export interface ContractBoard {
  columns: ContractColumn[];
  summary: ContractSummary;
  can_manage: boolean;
}

export interface ContractList {
  items: ContractCard[];
  total: number;
  page: number;
  page_size: number;
  summary: ContractSummary;
  stages: { key: ContractStage; label: string }[];
  can_manage: boolean;
}

export interface ForecastQuarter {
  key: string;
  label: string;
  current: boolean;
  past: boolean;
  pipeline: number;
  weighted: number;
  committed: number;
  renewed: number;
  churned: number;
  at_risk: number;
  count: number;
}

export interface ContractForecast {
  quarters: ForecastQuarter[];
  totals: Record<"pipeline" | "weighted" | "committed" | "renewed" | "churned" | "at_risk", number>;
}

export interface ContractCalendar {
  month: string;
  from: string;
  to: string;
  events: { day: string; kind: "END" | "NOTICE"; contract: ContractCard }[];
}

export interface ContractFile {
  id: string;
  name: string;
  extension: string | null;
  kind: string;
  size_bytes: number;
  status: string;
  owner: string | null;
  created_at: string | null;
}

export type ContractInput = Partial<{
  title: string;
  customer_id: string;
  owner_id: string | null;
  value: number | string;
  currency: string;
  start_date: string;
  end_date: string;
  term_months: number;
  billing: string;
  auto_renew: boolean;
  notice_days: number;
  stage: ContractStage;
  probability: number;
  terms: string | null;
  notes: string | null;
  churn_reason: string | null;
  expected_updated_at: string | null;
}>;

export const contractsApi = {
  list: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<ContractList>("/api/contracts", { params, signal }),
  board: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<ContractBoard>("/api/contracts/board", { params, signal }),
  forecast: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<ContractForecast>("/api/contracts/forecast", { params, signal }),
  calendar: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<ContractCalendar>("/api/contracts/calendar", { params, signal }),
  get: (id: string, signal?: AbortSignal) => api.get<ContractDetail>(`/api/contracts/${id}`, { signal }),
  create: (body: ContractInput) => api.post<ContractDetail>("/api/contracts", body),
  update: (id: string, body: ContractInput) => api.put<ContractDetail>(`/api/contracts/${id}`, body),
  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/api/contracts/${id}`),
  move: (id: string, body: { stage: ContractStage; before_id?: string | null; probability?: number; churn_reason?: string }) =>
    api.post<ContractDetail>(`/api/contracts/${id}/move`, body),
  files: (id: string, signal?: AbortSignal) =>
    api.get<{ folder_id: string | null; items: ContractFile[]; can_upload: boolean }>(`/api/contracts/${id}/files`, { signal }),
  folder: (id: string) => api.post<{ folder_id: string }>(`/api/contracts/${id}/files`),
};

export const STAGE_ORDER: ContractStage[] = ["UPCOMING", "NEGOTIATION", "COMMITTED", "RENEWED", "CHURNED"];
export const STAGE_LABEL: Record<ContractStage, string> = {
  UPCOMING: "Upcoming",
  NEGOTIATION: "In negotiation",
  COMMITTED: "Committed",
  RENEWED: "Renewed",
  CHURNED: "Churned",
};

// ── record versions ─────────────────────────────────────────────────────

export interface VersionField {
  name: string;
  label: string;
  kind: string;
  references: string;
}

export interface RecordVersion {
  id: string;
  number: number;
  at: string;
  action: string;
  actor: string;
  actor_id: string | null;
  message: string;
  changed: string[];
  restored_from: number | null;
  state: Record<string, unknown>;
}

export interface VersionHistory {
  resource_type: string;
  record_id: string;
  title: string;
  fields: VersionField[];
  versions: RecordVersion[];
  current: number;
  as_of: number | null;
  references: Record<string, Record<string, string>>;
  can_restore: boolean;
  updated_at: string | null;
}

export interface RestoreResult {
  restored: string[];
  version: number;
  message: string;
  history: VersionHistory;
}

export const versionsApi = {
  history: (type: string, id: string, at?: string | null, signal?: AbortSignal) =>
    api.get<VersionHistory>(`/api/records/${type}/${id}/versions`, { params: { at: at || undefined }, signal }),
  restore: (type: string, id: string, body: { version: number; fields?: string[]; expected_updated_at?: string | null }) =>
    api.post<RestoreResult>(`/api/records/${type}/${id}/versions/restore`, body),
};

// ── metric watches ──────────────────────────────────────────────────────

export type WatchStatus = "OK" | "ANOMALY" | "NO_DATA" | "ERROR";

export interface MetricWatch {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  measure: "count" | "sum" | "avg";
  measure_field: string | null;
  date_field: string | null;
  filters: Record<string, unknown>;
  granularity: "hour" | "day" | "week";
  method: "zscore" | "seasonal";
  sensitivity: "low" | "medium" | "high";
  threshold: number | null;
  direction: "both" | "up" | "down";
  window: number;
  channels: string[];
  recipient_ids: string[];
  enabled: boolean;
  muted: boolean;
  snoozed_until: string | null;
  owner: { id: string | null; name: string | null };
  last_evaluated_at: string | null;
  last_status: WatchStatus | null;
  last_value: number | null;
  last_error: string | null;
  threshold_effective: number;
  can_edit: boolean;
  open_anomalies?: number;
  last_anomaly_at?: string | null;
  sparkline?: number[];
}

export interface WatchPoint {
  at: string;
  value: number;
  expected?: number;
  upper?: number;
  lower?: number;
  zscore?: number;
  unusual?: boolean;
}

export interface Anomaly {
  id: string;
  watch_id: string;
  watch_name: string | null;
  bucket_at: string;
  value: number;
  expected: number;
  stddev: number;
  zscore: number;
  direction: "up" | "down";
  severity: "WARNING" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED";
  notified: boolean;
  suppressed_reason: string | null;
  acknowledged_at: string | null;
  created_at: string | null;
  series?: { at: string; value: number }[];
  granularity?: string | null;
}

export interface WatchCatalogue {
  datasets: {
    key: string;
    label: string;
    default_date: string;
    dates: { name: string; label: string }[];
    numbers: { name: string; label: string }[];
    filters: { name: string; label: string; kind: string; choices: string[] }[];
  }[];
  measures: string[];
  granularities: string[];
  methods: string[];
  sensitivities: { key: string; threshold: number }[];
  directions: string[];
  channels: string[];
  can_manage: boolean;
}

export type WatchInput = Partial<
  Pick<
    MetricWatch,
    | "name" | "description" | "dataset" | "measure" | "measure_field" | "date_field" | "filters"
    | "granularity" | "method" | "sensitivity" | "threshold" | "direction" | "window" | "channels"
    | "recipient_ids" | "enabled"
  >
>;

export const alertsApi = {
  catalogue: (signal?: AbortSignal) => api.get<WatchCatalogue>("/api/alerts/catalogue", { signal }),
  watches: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<{ items: MetricWatch[]; total: number; open_anomalies: number; can_manage: boolean }>(
      "/api/alerts/watches", { params, signal }),
  watch: (id: string, signal?: AbortSignal) => api.get<MetricWatch>(`/api/alerts/watches/${id}`, { signal }),
  create: (body: WatchInput) => api.post<MetricWatch>("/api/alerts/watches", body),
  update: (id: string, body: WatchInput) => api.put<MetricWatch>(`/api/alerts/watches/${id}`, body),
  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/api/alerts/watches/${id}`),
  chart: (id: string, points = 45, signal?: AbortSignal) =>
    api.get<{ watch: MetricWatch; points: WatchPoint[]; anomalies: Anomaly[] }>(
      `/api/alerts/watches/${id}/chart`, { params: { points }, signal }),
  evaluate: (id: string) =>
    api.post<{ status: WatchStatus; new: number; anomalies?: Anomaly[]; watch: MetricWatch; error?: string }>(
      `/api/alerts/watches/${id}/evaluate`),
  silence: (id: string, body: { hours?: number; until?: string; muted?: boolean; clear?: boolean }) =>
    api.post<MetricWatch>(`/api/alerts/watches/${id}/silence`, body),
  preview: (body: WatchInput, signal?: AbortSignal) =>
    api.post<{ points: WatchPoint[]; flagged: number; threshold: number }>("/api/alerts/preview", body, { signal }),
  anomalies: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<{ items: Anomaly[]; total: number; page: number; page_size: number }>("/api/alerts/anomalies", { params, signal }),
  acknowledge: (id: string) => api.post<Anomaly>(`/api/alerts/anomalies/${id}/acknowledge`),
};

// ── public dashboard links ──────────────────────────────────────────────

export interface DashboardLink {
  id: string;
  dashboard_id: string;
  token: string;
  path: string;
  label: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  has_password: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  allow_embed: boolean;
  allowed_origins: string[];
  view_count: number;
  last_viewed_at: string | null;
  created_by: string | null;
  created_at: string | null;
}

export type LinkInput = Partial<{
  label: string | null;
  password: string | null;
  expires_at: string | null;
  allow_embed: boolean;
  allowed_origins: string[];
}>;

export const linksApi = {
  list: (dashboardId: string, signal?: AbortSignal) =>
    api.get<{ items: DashboardLink[]; can_publish: boolean; dashboard: { id: string; name: string } }>(
      `/api/dashboards/${dashboardId}/links`, { signal }),
  create: (dashboardId: string, body: LinkInput) => api.post<DashboardLink>(`/api/dashboards/${dashboardId}/links`, body),
  update: (dashboardId: string, id: string, body: LinkInput) =>
    api.put<DashboardLink>(`/api/dashboards/${dashboardId}/links/${id}`, body),
  revoke: (dashboardId: string, id: string) => api.delete<DashboardLink>(`/api/dashboards/${dashboardId}/links/${id}`),
};

export type PublicWidgetData =
  | { type: "metrics"; gauge: boolean; strip: boolean; metric: string | null;
      metrics: { key: string; label: string; value: number | null; format?: string }[] }
  | { type: "chart"; chart: string; result: AnalysisResult }
  | { type: "rows"; table: boolean; columns: { name: string; label: string }[]; title_field: string;
      status_field: string; items: Record<string, unknown>[] }
  | { type: "private" | "empty" | "error"; message: string };

export interface PublicDashboard {
  dashboard: { name: string; description: string | null; icon: string | null; columns: number; period: string;
    owner: string | null; updated_at: string | null };
  widgets: { id: string; kind: string; title: string; subtitle: string | null; x: number; y: number;
    width: number; height: number; data: PublicWidgetData }[];
  link: { label: string | null; expires_at: string | null; embedded: boolean };
  generated_at: string;
}

/**
 * The public side runs with no session, so it does not use `api` — no bearer
 * token, no unauthorised handler that would bounce a stranger to a sign-in.
 */
async function anonymous<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: "invalid_response", message: text.slice(0, 200) };
  }
  if (!response.ok) {
    const body = (parsed && typeof parsed === "object" && "error" in parsed
      ? parsed
      : { error: "error", message: `Request failed with ${response.status}` }) as ApiErrorBody;
    throw new ApiError(response.status, body, response.headers.get("X-Correlation-ID") ?? "");
  }
  return parsed as T;
}

export const publicApi = {
  meta: (token: string) =>
    anonymous<{ name: string; has_password: boolean; allow_embed: boolean; expires_at: string | null }>(
      `/public/dashboards/${encodeURIComponent(token)}`),
  unlock: (token: string, password: string) =>
    anonymous<{ grant: string | null; expires_in: number | null }>(`/public/dashboards/${encodeURIComponent(token)}/unlock`, {
      method: "POST", body: JSON.stringify({ password }),
    }),
  view: (token: string, grant: string | null, embedOrigin: string | null) =>
    anonymous<PublicDashboard>(
      `/public/dashboards/${encodeURIComponent(token)}/view${embedOrigin ? `?embed_origin=${encodeURIComponent(embedOrigin)}` : ""}`,
      { headers: grant ? { "X-Share-Grant": grant } : {} },
    ),
};

// ── formatting shared by the pages ──────────────────────────────────────

export function money(value: number | null | undefined, currency = "EUR"): string {
  const amount = Number(value ?? 0);
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
  if (Math.abs(amount) >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(amount) >= 10_000) return `${symbol}${Math.round(amount / 1000)}k`;
  return `${symbol}${Math.round(amount).toLocaleString()}`;
}

// ── the bulk-edit grid ──────────────────────────────────────────────────

export interface GridRowResult {
  id: string;
  title: string;
  status: "applied" | "unchanged" | "failed";
  changed?: string[];
  problems: { field: string; message: string }[];
  error?: string;
  message?: string;
  updated_at?: string | null;
}

export interface GridSaveResult {
  resource_type: string;
  requested: number;
  applied: number;
  unchanged: number;
  failed: GridRowResult[];
  results: GridRowResult[];
  message: string;
}

export const gridApi = {
  /** Many rows, each with its own changes, through the records bulk API (§18). */
  save: (resourceType: string, rows: { id: string; changes: Record<string, unknown>; expected_updated_at?: string | null }[]) =>
    api.post<GridSaveResult>(`/api/records/${resourceType}/bulk`, { rows }),
};
