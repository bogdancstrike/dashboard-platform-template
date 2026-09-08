import { api } from "./client";

/**
 * Exports somebody asked for and can come back to (§30).
 *
 * Four things worth knowing before reading the types.
 *
 * **A download and a queued export are the same question, asked two ways.**
 * Below `streams_up_to` rows the file comes back in the response; above it the
 * server refuses with `queue_instead: true` and this is where it goes instead.
 * `estimate` is what decides which, and it exists so a page never queues a
 * background job for forty rows.
 *
 * **`rows` and `size_bytes` describe the file, not the request.** They are read
 * off the object that was actually stored. The seeded exports used to report a
 * progress counter over a random total for a file nobody had written, which is
 * the defect this whole module was built out of.
 *
 * **`stalled` is a state, and not the same as failed.** Work runs off the
 * request inside the API process, so a deployment mid-export leaves a row that
 * says QUEUED and that nothing will ever pick up. A spinner that never stops
 * is the wrong way to render that; `stalled` is how the page says so and
 * offers `again` instead.
 *
 * **Letting one go takes two presses.** `expires_at` is derived from
 * `retention.export_days`; `forget` is the manual version, and the first call
 * drops the file while the second removes the record. `removed` in the answer
 * says which happened, so a page knows whether to redraw the row or take it
 * away. Two presses because the acts are different sizes — one removes a copy
 * of production data from object storage, the other tidies away a note — and
 * the audit trail keeps the history of both.
 *
 * See `services/exports.py`.
 */

export type ExportStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRYING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

/** One line of an export's own log, shown without a second request. */
export interface ExportLogLine {
  at: string | null;
  level: string;
  message: string;
}

export interface ExportRow {
  id: string;
  reference: string;
  name: string;
  status: ExportStatus;
  resource_type: string;
  format: string;
  /** The stored query in a sentence, re-derived from the field catalogue. */
  description: string;
  columns: string[];
  /** How many rows are in the file. `null` until there is a file. */
  rows: number | null;
  size_bytes: number | null;
  checksum: string | null;
  requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  progress: number;
  attempt: number;
  max_attempts: number;
  error_message: string | null;
  /** Which of the platform's background mechanisms produced it. */
  ran_as: string;
  expires_at: string | null;
  expired: boolean;
  /** Pending for longer than anything could still plausibly be running. */
  stalled: boolean;
  /** Whether asking for the file now would give one. */
  downloadable: boolean;
  /**
   * Whether there is a file at all — a different question from
   * `downloadable`, and the one that decides which of `forget`'s two presses
   * the next one is. Said by the server rather than inferred, because `rows`
   * and `size_bytes` survive a discard: they are the history the record keeps.
   */
  has_file: boolean;
  log_lines: ExportLogLine[];
}

export interface ExportsPage {
  items: ExportRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
  columns: string[];
}

/** A dataset this person may export, with the columns it ships with. */
export interface ExportDataset {
  key: string;
  label: string;
  description: string;
  columns: string[];
  fields: Array<{ name: string; label: string; kind: string }>;
}

export interface ExportFormat {
  key: string;
  label: string;
  content_type: string;
  /** The ceiling for *this* format — XLSX is lower, and the setting cannot raise it. */
  maximum: number;
}

export interface ExportCatalogue {
  datasets: ExportDataset[];
  formats: ExportFormat[];
  /** `limits.max_export_rows`, read from the settings table. */
  max_rows: number;
  /** Above this a download is refused and has to be queued. */
  streams_up_to: number;
  /** `retention.export_days` — how long a finished file is kept. */
  retention_days: number;
  pending_limit: number;
  pending: number;
  stalled: number;
  statuses: Array<{ key: ExportStatus; count: number }>;
  total: number;
  expired: number;
  ready: number;
}

/** What a query would cost, and what the page should therefore offer. */
export interface ExportEstimate {
  resource_type: string;
  format: string;
  description: string;
  columns: string[];
  rows: number;
  maximum: number;
  streams_up_to: number;
  /** Small enough to come back in the response. */
  can_stream: boolean;
  can_queue: boolean;
  too_large: boolean;
}

/** A short-lived URL for the finished file. The bytes never pass through the API. */
export interface ExportLink {
  url: string;
  method: string;
  expires_in: number;
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  rows: number | null;
}

/** The question an export asks. The same shape the explorer's download takes. */
export interface ExportRequest {
  [key: string]: unknown;
  resource_type: string;
  format?: string;
  columns?: string[];
  filters?: Record<string, unknown>;
  query_text?: string;
  condition_tree?: Record<string, unknown> | null;
  sort?: string;
  order?: string;
}

export interface ExportQuery {
  [key: string]: unknown;
  q?: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export const exportsApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<ExportCatalogue>("/exports/catalogue", { signal }),
  list: (params: ExportQuery = {}, signal?: AbortSignal) =>
    api.get<ExportsPage>("/exports", { params, signal }),
  entry: (id: string, signal?: AbortSignal) =>
    api.get<ExportRow>(`/exports/${id}`, { signal }),
  /** How many rows, and whether it streams. Asked before anything is committed. */
  estimate: (request: ExportRequest, signal?: AbortSignal) =>
    api.post<ExportEstimate>("/exports/estimate", request, { signal }),
  queue: (request: ExportRequest) => api.post<ExportRow>("/exports", request),
  /**
   * Ask the same question again, as a new export. Not a retry: the rows have
   * moved on, so this leaves the old record alone and produces a new file.
   */
  again: (id: string) => api.post<ExportRow>(`/exports/${id}/again`, {}),
  download: (id: string) => api.get<ExportLink>(`/exports/${id}/download`),
  /**
   * Drop the file; on an export that has none already, remove the record.
   * `removed` says which happened.
   */
  forget: (id: string) => api.delete<ExportRow & { removed?: boolean }>(`/exports/${id}`),
};
