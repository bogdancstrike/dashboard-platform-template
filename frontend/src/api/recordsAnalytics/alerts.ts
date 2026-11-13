/** Metric anomaly watches (§22): watches, their points and the anomalies they raise. */

import { api } from "../client";

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
