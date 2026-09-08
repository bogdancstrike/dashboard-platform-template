import { api } from "./client";

/**
 * API clients and their credentials (§25).
 *
 * Three things to keep in mind reading these types.
 *
 * **`secret` appears on exactly two responses and nowhere else, ever.**
 * `create` and `rotate` return it; the platform stores only a hash, so there is
 * no call that can fetch it again. Both carry `secret_shown_once: true` so the
 * page can say so at the moment it matters rather than leaving somebody to find
 * out. A `Credential` has no `secret` field at all — the type is the
 * documentation.
 *
 * **`state` is derived, `status` is not sent.** A key whose `expires_at` passed
 * last Tuesday is expired whatever a stored column says, so the server computes
 * it and the browser never has to.
 *
 * **`requests_total` and `recent_requests` answer different questions.** The
 * first is a lifetime counter the gateway maintains; the second is a recent
 * window it keeps. Three point seven million against twelve rows is not a
 * contradiction — but a screen that put them together unlabelled would read as
 * one answer.
 *
 * See `services/api_clients.py`.
 */

export type ApiClientStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";
export type CredentialState = "ACTIVE" | "EXPIRED" | "REVOKED";

export interface Credential {
  id: string;
  label: string;
  /** The only part of a key ever shown twice: enough to tell two apart. */
  prefix: string;
  /** Computed from the dates, not read from a column. */
  state: CredentialState;
  created_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  /** The key this one replaced, so a rotation chain is readable. */
  rotated_from_id: string | null;
}

export interface ApiClientRow {
  id: string;
  name: string;
  client_id: string;
  description: string | null;
  status: ApiClientStatus;
  scopes: string[];
  rate_limit_per_minute: number;
  quota_per_day: number;
  /** Lifetime counters the gateway keeps. Not the request log. */
  requests_today: number;
  requests_total: number;
  error_rate: number;
  last_used_at: string | null;
  allowed_ips: string[];
  credential_count: number;
  /** Neither revoked nor expired. */
  live_credentials: number;
  created_at: string | null;
}

export interface ApiRequestRow {
  id: string;
  requested_at: string | null;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  ip_address: string | null;
  bytes_out: number;
}

export interface ApiClientDetail extends ApiClientRow {
  credentials: Credential[];
  recent_requests: ApiRequestRow[];
  /** How many rows the window holds — said, because the counter above is a lifetime. */
  recent_window: number;
  recent_failures: number;
}

export interface ApiClientsPage {
  items: ApiClientRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
  columns: string[];
}

export interface ApiClientCatalogue {
  fields: Array<{ name: string; label: string; kind: string }>;
  default_columns: string[];
  statuses: ApiClientStatus[];
  /** Only what *this caller* may grant — a client cannot exceed its creator. */
  scopes: Array<{ code: string; label: string }>;
  /** What the caller cannot grant, so the page can say why it is not offered. */
  withheld_scopes: string[];
  rotation_grace_days: number;
  total: number;
}

/** The one shape that carries a plaintext secret. */
export interface Minted {
  credential: Credential;
  secret: string;
  secret_shown_once: true;
}

export interface Rotated extends Minted {
  /** The key that was rotated out, now on a deadline. */
  replaced: Credential | null;
  grace_days: number | null;
}

export interface ApiClientQuery {
  [key: string]: unknown;
  q?: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export const apiClientsApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<ApiClientCatalogue>("/admin/api-clients/catalogue", { signal }),
  list: (params: ApiClientQuery = {}, signal?: AbortSignal) =>
    api.get<ApiClientsPage>("/admin/api-clients", { params, signal }),
  entry: (id: string, signal?: AbortSignal) =>
    api.get<ApiClientDetail>(`/admin/api-clients/${id}`, { signal }),
  /** Returns the plaintext secret. Once. */
  create: (body: {
    name: string;
    description?: string;
    scopes?: string[];
    rate_limit_per_minute?: number;
    quota_per_day?: number;
    allowed_ips?: string[];
  }) => api.post<ApiClientRow & Minted>("/admin/api-clients", body),
  update: (
    id: string,
    body: Partial<{
      name: string;
      description: string;
      scopes: string[];
      status: ApiClientStatus;
      rate_limit_per_minute: number;
      quota_per_day: number;
      allowed_ips: string[];
    }>,
  ) => api.put<ApiClientRow>(`/admin/api-clients/${id}`, body),
  /**
   * Mint a new credential. The old one keeps working for the grace period —
   * killing it immediately would be an outage with extra steps.
   */
  rotate: (id: string, body: { credential_id?: string; label?: string } = {}) =>
    api.post<Rotated>(`/admin/api-clients/${id}/rotate`, body),
  /** Immediate and permanent. The row is kept: a leak needs a when and a who. */
  revoke: (credentialId: string) =>
    api.delete<Credential>(`/admin/api-credentials/${credentialId}`),
  /** Retires the client and revokes every live key it holds. */
  remove: (id: string) =>
    api.delete<{ deleted: boolean; name: string; credentials_revoked: number }>(
      `/admin/api-clients/${id}`,
    ),
};
