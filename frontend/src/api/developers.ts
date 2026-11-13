import { api } from "./client";

/**
 * The developer portal (§31): the API reference read from the platform itself,
 * captured examples, and API usage per client. See `services/developer_portal.py`.
 */

export interface ApiExampleSample {
  status_code: number;
  path: string | null;
  request_body: unknown;
  response: unknown;
  schema: Record<string, unknown> | null;
  duration_ms: number | null;
  captured_at: string | null;
}

export interface ApiEndpoint {
  /** `METHOD route`, unique. */
  id: string;
  method: string;
  /** As the endpoint map spells it: `/api/tasks/<uuid:task_id>`. */
  route: string;
  /** With the API prefix: `/platform/api/tasks/<uuid:task_id>`. */
  path: string;
  operation: string;
  summary: string;
  description: string;
  access: "public" | "authenticated" | "permission" | "unknown";
  permissions: string[];
  /** Whether the reader may call it. */
  allowed: boolean;
  parameters: Array<{ name: string; in: "path"; type: string }>;
  swagger: { operation_id: string | null; parameters: string[] } | null;
  body: boolean;
  example: ApiExampleSample | null;
}

export interface ApiGroup {
  key: string;
  label: string;
  endpoints: ApiEndpoint[];
}

export interface ApiReference {
  base_path: string;
  groups: ApiGroup[];
  total: number;
  documented: number;
  auth: { bearer: string; api_key: string };
  swagger_url: string;
  changelog: Array<{ version: string; date: string; title: string; items: string[] }>;
  can_capture: boolean;
  can_view_usage: boolean;
}

export interface ApiUsage {
  days: number;
  client: { id: string; name: string } | null;
  totals: { requests: number; errors: number; error_rate: number; p95_ms: number };
  series: Array<{ day: string; requests: number; errors: number; p50_ms: number; p95_ms: number }>;
  top_endpoints: Array<{ method: string; path: string; requests: number; errors: number; avg_ms: number }>;
  status_codes: Array<{ code: number; count: number }>;
  clients: Array<{ id: string; name: string; client_id: string; status: string; requests: number; errors: number;
    p95_ms: number; last_used_at: string | null }>;
}

export const developersApi = {
  reference: (signal?: AbortSignal) => api.get<ApiReference>("/api/developers/reference", { signal }),
  usage: (params: { client?: string; days?: number }, signal?: AbortSignal) =>
    api.get<ApiUsage>("/api/developers/usage", { params, signal }),
  capture: (body: { method: string; route: string; status_code: number; path: string; request_body?: unknown;
    response: unknown; duration_ms: number }) =>
    api.post<{ method: string; route: string; example: ApiExampleSample }>("/api/developers/examples", body),
};
