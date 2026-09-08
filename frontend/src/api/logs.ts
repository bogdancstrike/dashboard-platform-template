import { api } from "./client";

/**
 * The system log (§22).
 *
 * Two things to keep in mind reading these types.
 *
 * `min_level` is **severity, not equality**: asking for `ERROR` returns errors
 * *and* criticals, because somebody who filters for errors is looking for
 * trouble and CRITICAL is more trouble. The server slices its ordered level
 * vocabulary, so the page never has to know the ranking.
 *
 * The tail is a **poll with a cursor**, not a socket. `cursor` is the id of the
 * newest line delivered; handing it back returns only what has arrived since,
 * which makes pausing honest — paused is simply not asking, and resuming asks
 * from where it stopped. A line id rather than a timestamp because two lines
 * can share a millisecond, and a timestamp cursor either repeats them or drops
 * one.
 *
 * See `services/logs.py`.
 */

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface LogLine {
  id: string;
  logged_at: string | null;
  level: LogLevel;
  service: string;
  logger: string | null;
  message: string;
  correlation_id: string | null;
  trace_id: string | null;
  user_id: string | null;
  host: string | null;
  environment: string;
  /** Milliseconds, as a number — a duration that sorted as text would put 9 after 1000. */
  duration_ms: number | null;
  status_code: number | null;
  /** So the table can mark which rows are worth opening without fetching either. */
  has_context: boolean;
  has_stack_trace: boolean;
}

/** One line in full. The heavy fields, fetched only when a line is opened. */
export interface LogEntry extends LogLine {
  context: Record<string, unknown>;
  stack_trace: string | null;
  span_id: string | null;
  /** The other lines from the same request — one failure is rarely one line. */
  related: LogLine[];
}

export interface LogFacetValue {
  value: string;
  count: number;
}

export interface LogsPage {
  items: LogLine[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sort: string;
  order: string;
  facets: Record<string, LogFacetValue[]>;
  columns: string[];
}

export interface LogCatalogue {
  fields: Array<{ name: string; label: string; kind: string }>;
  default_columns: string[];
  default_sort: string;
  /** Every level, including the ones at nought — see `LevelChips`. */
  levels: Array<{ key: LogLevel; count: number }>;
  /** What `retention.log_days` says, so the page cannot lie about its own data. */
  retention_days: number | null;
  total: number;
}

export interface LogTail {
  /** Oldest first, so a client appends without sorting. */
  items: LogLine[];
  cursor: string | null;
  /** More than one poll's worth was waiting — the viewer says so. */
  more: boolean;
}

export interface LogQuery {
  [key: string]: unknown;
  q?: string;
  min_level?: LogLevel | "";
  level?: string;
  service?: string;
  environment?: string;
  logger?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  order?: string;
}

export const logsApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<LogCatalogue>("/admin/logs/catalogue", { signal }),
  list: (params: LogQuery = {}, signal?: AbortSignal) =>
    api.get<LogsPage>("/admin/logs", { params, signal }),
  /** `after` omitted on the first poll: the server returns the latest page and the cursor. */
  tail: (params: LogQuery & { after?: string } = {}, signal?: AbortSignal) =>
    api.get<LogTail>("/admin/logs/tail", { params, signal }),
  entry: (id: string, signal?: AbortSignal) =>
    api.get<LogEntry>(`/admin/logs/${id}`, { signal }),
  /**
   * Apply the retention policy now. Takes no `days`: the bound is
   * `retention.log_days`, and a parameter here would make this an arbitrary
   * delete wearing a retention policy's name.
   */
  prune: () =>
    api.post<{ removed: number; retention_days: number; kept: number }>(
      "/admin/logs/prune",
      {},
    ),
};
