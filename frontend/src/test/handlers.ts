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

export const handlers = [
  http.get("/platform/meta/app", ({ request }) => echo(request, appMeta)),
  http.get("/platform/health/status", ({ request }) => echo(request, healthSnapshot)),
];
