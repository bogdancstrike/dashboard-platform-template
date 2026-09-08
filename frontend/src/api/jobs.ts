import { api } from "./client";

/**
 * The background job queue (§23).
 *
 * The thing to keep in mind reading these types: **`can_retry` and `can_cancel`
 * are the server's answer**, carried on every row. They are not booleans the
 * page derives — the rules live in `services/jobs.py` (`JOB_TERMINAL`,
 * `JOB_CANCELLABLE`, `max_attempts`), and a browser that re-derived them would
 * eventually offer a button the endpoint refuses. Which is worse than no
 * button.
 *
 * There is no `create`. Nothing in the platform enqueues a job yet — that
 * belongs with `/exports` (§30) — and a "New job" control would only ever
 * write a row no worker reads.
 *
 * See `services/jobs.py`.
 */

export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRYING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export interface Job {
  id: string;
  reference: string;
  name: string;
  kind: string;
  queue: string;
  status: JobStatus;
  priority: string;
  progress: number;
  total_units: number;
  processed_units: number;
  failed_units: number;
  /** `attempt` of `max_attempts` — "failed" and "failed three times" differ. */
  attempt: number;
  max_attempts: number;
  started_at: string | null;
  finished_at: string | null;
  scheduled_for: string | null;
  duration_ms: number | null;
  initiated_by_label: string | null;
  error_message: string | null;
  created_at: string | null;
  /** Terminal, and within its attempts. The server's answer, not a guess. */
  can_retry: boolean;
  /** Not yet finished. Likewise. */
  can_cancel: boolean;
  /**
   * Spent its attempts, and below the ceiling — so granting more would change
   * something. Offered exactly where the retry refusal points at it.
   */
  can_allow_attempts: boolean;
}

export interface JobDetail extends Job {
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  log_lines: Array<{ at: string | null; level: string; message: string }>;
  /** A drawer is not a log viewer — `/admin/logs` is. */
  log_truncated: boolean;
  scheduled_task_id: string | null;
  correlation_hint: string;
}

export interface JobFacetValue {
  value: string;
  count: number;
}

export interface JobsPage {
  items: Job[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, JobFacetValue[]>;
  columns: string[];
  can_manage: boolean;
}

export interface JobCatalogue {
  fields: Array<{ name: string; label: string; kind: string }>;
  default_columns: string[];
  default_sort: string;
  /** Every declared status, including the ones at nought. */
  statuses: Array<{ key: JobStatus; count: number }>;
  kinds: string[];
  total: number;
  /** Decided once here rather than per row. */
  can_manage: boolean;
}

export interface JobQuery {
  [key: string]: unknown;
  q?: string;
  status?: string;
  kind?: string;
  queue?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  order?: string;
}

export const jobsApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<JobCatalogue>("/admin/jobs/catalogue", { signal }),
  list: (params: JobQuery = {}, signal?: AbortSignal) =>
    api.get<JobsPage>("/admin/jobs", { params, signal }),
  entry: (id: string, signal?: AbortSignal) =>
    api.get<JobDetail>(`/admin/jobs/${id}`, { signal }),
  /** The same row, next attempt — never a new job. */
  retry: (id: string) => api.post<Job>(`/admin/jobs/${id}/retry`, {}),
  /** Keeps the row: a cancelled job that vanished would answer nothing. */
  cancel: (id: string) => api.post<Job>(`/admin/jobs/${id}/cancel`, {}),
  /**
   * Grant a spent job more attempts. Only upward, and bounded on the server —
   * the action the retry refusal has always pointed at.
   */
  allowAttempts: (id: string, maxAttempts: number) =>
    api.put<Job>(`/admin/jobs/${id}/attempts`, { max_attempts: maxAttempts }),
};
