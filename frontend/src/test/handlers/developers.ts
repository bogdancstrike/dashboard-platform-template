/** The developer portal (§31), mocked: a two-group reference, usage, and captures. */

import { http, HttpResponse } from "msw";

import type { ApiReference, ApiUsage } from "@/api/developers";

export const devState = { captured: [] as unknown[], referenceFails: false };

export function resetDevelopers() {
  devState.captured = [];
  devState.referenceFails = false;
}

const reference: ApiReference = {
  base_path: "/platform",
  total: 3,
  documented: 1,
  auth: { bearer: "Authorization: Bearer <token>", api_key: "X-Api-Key: nuc_…" },
  swagger_url: "/swagger.json",
  can_capture: true,
  can_view_usage: true,
  changelog: [{ version: "1.9", date: "2026-11-13", title: "Workflows as graphs", items: ["`/api/automations` graphs", "Keys"] }],
  groups: [
    {
      key: "automations", label: "Automations", endpoints: [
        {
          id: "GET /api/automations/rules", method: "GET", route: "/api/automations/rules", path: "/platform/api/automations/rules",
          operation: "automations_rules", summary: "Every automation.", description: "Every automation, or a new one.",
          access: "permission", permissions: ["automations.manage"], allowed: true, parameters: [],
          swagger: { operation_id: "get_automations_rules", parameters: [] }, body: false,
          example: { status_code: 200, path: "/platform/api/automations/rules", request_body: null,
            response: { items: [], total: 0 }, schema: { type: "object", properties: { total: { type: "integer" } } },
            duration_ms: 31, captured_at: "2026-11-12T10:00:00Z" },
        },
        {
          id: "PUT /api/automations/rules/<uuid:rule_id>/graph", method: "PUT", route: "/api/automations/rules/<uuid:rule_id>/graph",
          path: "/platform/api/automations/rules/<uuid:rule_id>/graph", operation: "automations_rule_graph",
          summary: "Save the draft.", description: "", access: "permission", permissions: ["automations.manage"], allowed: false,
          parameters: [{ name: "rule_id", in: "path", type: "uuid" }], swagger: null, body: true, example: null,
        },
      ],
    },
    {
      key: "me", label: "Me", endpoints: [
        {
          id: "GET /api/me", method: "GET", route: "/api/me", path: "/platform/api/me", operation: "me", summary: "Who I am.",
          description: "Who I am.", access: "authenticated", permissions: [], allowed: true, parameters: [], swagger: null,
          body: false, example: null,
        },
        {
          id: "GET /public/forms/<string:slug>", method: "GET", route: "/public/forms/<string:slug>", path: "/platform/public/forms/<string:slug>",
          operation: "public_form", summary: "A public form.", description: "", access: "public", permissions: [], allowed: true,
          parameters: [{ name: "slug", in: "path", type: "string" }], swagger: null, body: false, example: null,
        },
      ],
    },
  ],
};

const usage = (client: string | null): ApiUsage => ({
  days: 14,
  client: client ? { id: client, name: "Billing sync" } : null,
  totals: { requests: 1200, errors: 84, error_rate: 0.07, p95_ms: 412.4 },
  series: [
    { day: "2026-11-12", requests: 600, errors: 40, p50_ms: 52, p95_ms: 400 },
    { day: "2026-11-13", requests: 600, errors: 44, p50_ms: 55, p95_ms: 412.4 },
  ],
  top_endpoints: [{ method: "GET", path: "/platform/api/explorer/catalog", requests: 300, errors: 2, avg_ms: 61.2 }],
  status_codes: [{ code: 200, count: 1000 }, { code: 404, count: 70 }, { code: 500, count: 14 }],
  clients: [
    { id: "c1", name: "Billing sync", client_id: "billing-sync", status: "ACTIVE", requests: 900, errors: 60, p95_ms: 420, last_used_at: "2026-11-13T03:00:00Z" },
    { id: "c2", name: "Quiet bot", client_id: "quiet", status: "ACTIVE", requests: 0, errors: 0, p95_ms: 0, last_used_at: null },
  ],
});

export const developerHandlers = [
  http.get("/platform/api/developers/reference", () =>
    devState.referenceFails
      ? HttpResponse.json({ error: "server_error", message: "The reference broke." }, { status: 500 })
      : HttpResponse.json(reference)),
  http.get("/platform/api/developers/usage", ({ request }) => {
    const client = new URL(request.url).searchParams.get("client");
    return HttpResponse.json(usage(client));
  }),
  http.post("/platform/api/developers/examples", async ({ request }) => {
    const body = await request.json();
    devState.captured.push(body);
    return HttpResponse.json({ method: "GET", route: "/api/me", example: { status_code: 200 } }, { status: 201 });
  }),
];
