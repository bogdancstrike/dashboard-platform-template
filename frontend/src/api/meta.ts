/**
 * The metadata endpoints, typed.
 *
 * `/meta/app` is fetched before anything else: it carries the OIDC coordinates
 * the SPA needs to *start* a login, which by definition it cannot have obtained
 * by logging in.
 */

import { api } from "./client";

export interface AppMeta {
  name: string;
  description: string;
  version: string;
  build: string;
  environment: string;
  api_prefix: string;
  server_time: string;
  auth: {
    issuer: string;
    url: string;
    realm: string;
    client_id: string;
    audience: string;
  };
  features: {
    cache: boolean;
    tracing: boolean;
    auto_provision_users: boolean;
  };
  limits: { max_upload_mb: number };
}

export interface PermissionGroup {
  name: string;
  permissions: { code: string; label: string }[];
}

export interface PermissionCatalogue {
  groups: PermissionGroup[];
  total: number;
}

export interface RoleDefinition {
  code: string;
  name: string;
  description: string;
  rank: number;
  color: string;
  permissions: string[];
  permission_labels: string[];
}

export interface RouteDescriptor {
  operation: string;
  namespace: string;
  url: string;
  methods: string[];
  description: string;
  handler: string;
}

export const metaApi = {
  app: (signal?: AbortSignal) => api.get<AppMeta>("/meta/app", { signal }),
  permissions: (signal?: AbortSignal) =>
    api.get<PermissionCatalogue>("/meta/permissions", { signal }),
  roles: (signal?: AbortSignal) =>
    api.get<{ items: RoleDefinition[]; total: number }>("/meta/roles", { signal }),
  routes: (signal?: AbortSignal) =>
    api.get<{ prefix: string; items: RouteDescriptor[]; total: number }>("/meta/routes", {
      signal,
    }),
};

export interface HealthSnapshot {
  status: "healthy" | "degraded" | "unhealthy";
  degraded: string[];
  service: string;
  environment: string;
  version: string;
  uptime_seconds: number;
  checked_at: string;
  checks: Record<string, { status: string; latency_ms: number | null; error?: string }>;
}

/**
 * What one dependency was doing across a window (§24).
 *
 * The snapshot answers "is it working now", which is what a deploy pipeline
 * asks. This answers the question a person on the health page is almost
 * always asking instead: **was it working at four o'clock**, when the thing
 * they are investigating happened.
 */
export interface HealthPoint {
  at: string;
  status: string;
  latency_ms: number;
}

/** A run of not-healthy, as a period rather than as three separate points. */
export interface HealthIncident {
  status: string;
  started_at: string;
  ended_at: string;
  points: number;
}

export interface ServiceHistory {
  key: string;
  name: string;
  category: string;
  status: string;
  latency_ms: number;
  /** The lifetime figure on the row, which is not the window's. */
  uptime_percent: number;
  message: string | null;
  last_checked_at: string | null;
  series: HealthPoint[];
  incidents: HealthIncident[];
  /** Over the window asked for, and named as such so the two cannot be confused. */
  window_uptime_percent: number;
}

export interface HealthHistory {
  period: string;
  from: string;
  to: string;
  periods: string[];
  services: ServiceHistory[];
  counts: { services: number; healthy_now: number; incidents: number };
}

export const healthApi = {
  live: (signal?: AbortSignal) => api.get<{ status: string }>("/health/live", { signal }),
  ready: (signal?: AbortSignal) => api.get<{ status: string }>("/health/ready", { signal }),
  status: (signal?: AbortSignal) => api.get<HealthSnapshot>("/health/status", { signal }),
  /** Needs `health.view`, unlike the probes: a history is operational detail. */
  history: (
    params: { period?: string; from?: string; to?: string } = {},
    signal?: AbortSignal,
  ) => api.get<HealthHistory>("/health/history", { params, signal }),
};
