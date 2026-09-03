/**
 * The mocked API.
 *
 * Mocked at the network boundary rather than by stubbing modules, so a test
 * exercises the real client — the correlation header, the error envelope, the
 * query-string building — instead of a hand-written stand-in that agrees with
 * the code because the same person wrote both.
 *
 * The shapes here are copied from what the backend actually returns; the
 * contract test (planned) asserts they still match `/swagger.json`.
 */

import { http, HttpResponse } from "msw";

import { CORRELATION_HEADER } from "@/config";

export const appMeta = {
  name: "Nucleus",
  description: "Enterprise Application Template Platform",
  version: "1.0.0",
  build: "dev",
  environment: "test",
  api_prefix: "/platform",
  server_time: "2026-09-03T12:00:00Z",
  auth: {
    issuer: "http://localhost:8080/realms/template",
    url: "http://localhost:8080",
    realm: "template",
    client_id: "template-spa",
    audience: "template-api",
  },
  features: { cache: true, tracing: false, auto_provision_users: true },
  limits: { max_upload_mb: 25 },
};

export const healthSnapshot = {
  status: "degraded" as const,
  degraded: ["identity"],
  service: "platform-api",
  environment: "test",
  version: "1.0.0",
  host: "test",
  pid: 1,
  python: "3.12.3",
  started_at: "2026-09-03T11:00:00Z",
  uptime_seconds: 3600,
  checked_at: "2026-09-03T12:00:00Z",
  checks: {
    database: { status: "healthy", latency_ms: 1.4 },
    cache: { status: "disabled", latency_ms: null },
    identity: { status: "unavailable", latency_ms: null, error: "connection refused" },
  },
};

/** Echoes the correlation id back, exactly as the real server does. */
function echo<T extends object>(request: Request, body: T, status = 200) {
  return HttpResponse.json(body, {
    status,
    headers: { [CORRELATION_HEADER]: request.headers.get(CORRELATION_HEADER) ?? "" },
  });
}

export const dashboardSummary = {
  period: {
    key: "last_30_days",
    from: "2026-08-04T00:00:00Z",
    to: "2026-09-03T00:00:00Z",
    previous_from: "2026-07-05T00:00:00Z",
    previous_to: "2026-08-04T00:00:00Z",
    options: [
      { key: "last_7_days", label: "Last 7 days" },
      { key: "last_30_days", label: "Last 30 days" },
      { key: "custom", label: "Custom range" },
    ],
  },
  kpis: [
    {
      key: "revenue", label: "Revenue", value: 38137905.7, unit: "EUR",
      previous: 14990574.89, change_percent: 154.4, trend: "up", polarity: "up_is_good",
      icon: "euro", accent: "success", link: "/orders?status=PAID",
      hint: "Excludes cancelled and refunded orders",
    },
    {
      key: "sla_breached", label: "SLA breaches", value: 326, unit: "",
      previous: 143, change_percent: 128, trend: "up", polarity: "down_is_good",
      icon: "alert-triangle", accent: "danger", link: "/tickets?sla_breached=true", hint: "",
    },
  ],
  charts: {
    grain: "day",
    revenue_over_time: {
      kind: "area", title: "Revenue over time",
      series: [
        { bucket: "2026-08-04T00:00:00Z", value: 1200 },
        { bucket: "2026-08-05T00:00:00Z", value: 2400 },
      ],
    },
    tasks_by_status: {
      kind: "bar", title: "Tasks by status",
      series: [{ name: "DONE", value: 141 }, { name: "BLOCKED", value: 33 }],
    },
  },
  alerts: [
    {
      key: "sla_breaches", severity: "CRITICAL", count: 310,
      message: "310 open tickets have breached their SLA",
      link: "/tickets?sla_breached=true", icon: "alert-triangle",
    },
  ],
  activity: [
    {
      id: "a1", kind: "RECORD", action: "CREATE", actor: "Ada Administrator",
      summary: "created ticket File upload fails above 10 MB",
      resource_type: "ticket", resource_id: "t1", resource_label: "TIC-00001",
      occurred_at: "2026-09-03T09:00:00Z",
    },
  ],
  generated_at: "2026-09-03T12:00:00Z",
};

export const handlers = [
  http.get("/platform/meta/app", ({ request }) => echo(request, appMeta)),
  http.get("/platform/health/status", ({ request }) => echo(request, healthSnapshot)),
  http.get("/platform/dashboard/summary", ({ request }) => echo(request, dashboardSummary)),
];
