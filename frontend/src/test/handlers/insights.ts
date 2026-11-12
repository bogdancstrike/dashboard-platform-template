/**
 * Insights (§43), mocked: a gallery, suggestions, drafts from a question or a
 * suggestion, and the saved-insight actions — in memory so a test sees changes.
 */

import { http, HttpResponse } from "msw";

import type { InsightDraft, InsightSummary, SavedInsight } from "@/api/insights";

const at = "2026-09-03T11:00:00Z";

export const BOUND_BLOCKS = [
  { type: "kpi", label: "Revenue", format: "currency", width: "third", compare: true,
    data: { value: 1250000, previous: 1000000, delta: 25, path: "/orders" } },
  { type: "kpi", label: "Orders", width: "third", data: { value: 241 } },
  { type: "bar", title: "By channel", width: "half",
    data: { categories: ["DIRECT", "PORTAL"], series: [{ name: "Count", values: [12, 7] }] } },
  { type: "table", title: "Latest", width: "full",
    data: { columns: [{ key: "reference", label: "Reference" }, { key: "total", label: "Total" }],
            rows: [{ id: "o1", reference: "ORD-1", total: 120.5, href: "/orders/o1" }] } },
  { type: "hologram", title: "From the future" },
];

function draft(partial: Partial<InsightDraft> = {}): InsightDraft {
  return {
    id: null,
    question: "How are sales?",
    title: "Sales this year",
    summary: "Revenue and orders.",
    spec: { version: 1, title: "Sales this year", summary: "", blocks: [] },
    rendered: { version: 1, title: "Sales this year", summary: "", blocks: BOUND_BLOCKS },
    warnings: [],
    source: "ai",
    model: "gpt-6-luna",
    usage: null,
    refreshed_at: at,
    ...partial,
  };
}

function saved(id: string, partial: Partial<SavedInsight> = {}): SavedInsight {
  const base = draft();
  return {
    ...base,
    id,
    datasets: ["order"],
    scope: "PRIVATE",
    pinned: false,
    owner: { id: "u-1", name: "Ada Administrator" },
    can_edit: true,
    created_at: at,
    updated_at: at,
    kinds: ["kpi", "kpi", "bar", "table"],
    members: [],
    ...partial,
  };
}

function seed() {
  return {
    items: [
      saved("in-1", { title: "Sales this year", pinned: true, scope: "PUBLIC" }),
      saved("in-2", { title: "Support at a glance", question: "How is support?", can_edit: false,
                      owner: { id: "u-2", name: "Maya Ionescu" } }),
    ],
  };
}

export let insightsState = seed();
export const insightsFlags = { generateStatus: 200 };

export function resetInsights(): void {
  insightsState = seed();
  insightsFlags.generateStatus = 200;
}

const summary = (item: SavedInsight): InsightSummary => {
  const { spec: _spec, rendered: _rendered, warnings: _warnings, members: _members, ...rest } = item;
  return rest;
};

export const insightsHandlers = [
  http.get("/platform/api/insights", () =>
    HttpResponse.json({
      items: insightsState.items.map(summary),
      suggestions: [
        { key: "order-1", dataset: "order", dataset_label: "Orders", question: "How are sales trending this year?", title: "Sales this year" },
        { key: "ticket-1", dataset: "ticket", dataset_label: "Tickets", question: "How is support keeping up?", title: "Support" },
      ],
      datasets: [{ key: "order", label: "Orders" }],
      can_share: true,
    }),
  ),
  http.post("/platform/api/insights/generate", async ({ request }) => {
    if (insightsFlags.generateStatus !== 200) {
      return HttpResponse.json({ message: "busy" }, { status: insightsFlags.generateStatus });
    }
    const body = (await request.json()) as { question: string };
    return HttpResponse.json(draft({ question: body.question, warnings: ["block 5: unknown component 'hologram', skipped."] }));
  }),
  http.post("/platform/api/insights/suggestions/:key", ({ params }) =>
    HttpResponse.json(draft({ question: `Suggested ${String(params["key"])}`, source: "suggested", model: null })),
  ),
  http.post("/platform/api/insights", async ({ request }) => {
    const body = (await request.json()) as InsightDraft;
    const row = saved(`in-${insightsState.items.length + 1}`, { title: body.title, question: body.question });
    insightsState.items.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.get("/platform/api/insights/:id", ({ params }) => {
    const row = insightsState.items.find((item) => item.id === String(params["id"]));
    return row ? HttpResponse.json(row) : HttpResponse.json({ message: "not found" }, { status: 404 });
  }),
  http.put("/platform/api/insights/:id", async ({ request, params }) => {
    const row = insightsState.items.find((item) => item.id === String(params["id"]))!;
    Object.assign(row, (await request.json()) as Record<string, unknown>);
    return HttpResponse.json(row);
  }),
  http.post("/platform/api/insights/:id/refresh", ({ params }) => {
    const row = insightsState.items.find((item) => item.id === String(params["id"]))!;
    row.refreshed_at = "2026-09-04T11:00:00Z";
    return HttpResponse.json(row);
  }),
  http.delete("/platform/api/insights/:id", ({ params }) => {
    insightsState.items = insightsState.items.filter((item) => item.id !== String(params["id"]));
    return HttpResponse.json({ id: params["id"], deleted: true });
  }),
];
