/** Public dashboard links (§25): the owner's side and the anonymous viewer's side. */

import { API_PREFIX } from "@/config";

import type { AnalysisResult } from "../analysis";
import { api, ApiError, type ApiErrorBody } from "../client";

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
