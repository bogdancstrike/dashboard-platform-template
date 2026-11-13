/**
 * Records & analytics (§12, §13, §17, §18, §22, §25), mocked in memory so a
 * test can drag a contract, restore a version, paste into the grid, fire an
 * anomaly and unlock a public dashboard and see the result come back.
 * `resetRecordsAnalytics()` puts the fixtures back; tests call it in `beforeEach`.
 */
import { http, HttpResponse } from "msw";

import type {
  Anomaly,
  ContractCard,
  ContractDetail,
  ContractStage,
  DashboardLink,
  HealthModel,
  MetricWatch,
  PortfolioEntry,
  PublicDashboard,
  VersionHistory,
} from "@/api/recordsAnalytics";

const P = "/platform";
const STAGES: ContractStage[] = ["UPCOMING", "NEGOTIATION", "COMMITTED", "RENEWED", "CHURNED"];
const LABEL: Record<ContractStage, string> = {
  UPCOMING: "Upcoming", NEGOTIATION: "In negotiation", COMMITTED: "Committed", RENEWED: "Renewed", CHURNED: "Churned",
};
const PROB: Record<ContractStage, number> = { UPCOMING: 50, NEGOTIATION: 65, COMMITTED: 90, RENEWED: 100, CHURNED: 0 };

export function contract(partial: Partial<ContractDetail> & { id: string; reference: string }): ContractDetail {
  return {
    title: `${partial.reference} subscription`,
    customer: { id: "cus-1", name: "Acme Logistics", code: "CUS-00001" },
    owner: { id: "u-1", name: "Ada Administrator" },
    value: 120000, weighted: 60000, currency: "EUR",
    start_date: "2026-01-01", end_date: "2026-12-31", days_to_end: 48,
    stage: "UPCOMING", stage_label: "Upcoming", probability: 50, rank: 1024, auto_renew: false,
    health_band: "HEALTHY", health_score: 72, at_risk: false, updated_at: "2026-09-01T10:00:00Z",
    term_months: 12, billing: "ANNUAL", notice_days: 60, notice_by: "2026-11-01", terms: "Annual terms", notes: null,
    churn_reason: null, stage_changed_at: "2026-08-01T10:00:00Z", closed_at: null, folder_id: null,
    created_at: "2025-12-15T10:00:00Z", can_edit: true,
    ...partial,
  };
}

function entry(partial: Partial<PortfolioEntry> & { id: string; name: string }): PortfolioEntry {
  return {
    code: "CUS-1", segment: "SMB", score: 50, band: "AT_RISK", previous_band: null,
    delta_7d: 0, delta_30d: 0, lifetime_value: 25000, band_changed_at: null, ...partial,
  };
}

const MODEL: HealthModel = {
  id: "m-1", name: "Default",
  weights: { tickets: 30, orders: 30, usage: 25, renewal: 15 },
  thresholds: {
    bands: { healthy: 65, at_risk: 40 }, tickets: { open: 5, escalated: 15, breached: 12 },
    orders: { recency_days: 180, window_days: 90 }, usage: { contact_days: 120 }, renewal: { window_days: 120 },
  },
  signals: [
    { key: "tickets", label: "Support tickets" }, { key: "orders", label: "Orders" },
    { key: "usage", label: "Usage" }, { key: "renewal", label: "Renewal" },
  ],
  bands: [{ key: "HEALTHY", label: "Healthy" }, { key: "AT_RISK", label: "At risk" }, { key: "CRITICAL", label: "Critical" }],
  updated_at: "2026-09-01T10:00:00Z",
  can_configure: true,
};

export function watch(partial: Partial<MetricWatch> & { id: string; name: string }): MetricWatch {
  return {
    description: null, dataset: "ticket", measure: "count", measure_field: null, date_field: null, filters: {},
    granularity: "day", method: "zscore", sensitivity: "medium", threshold: null, direction: "both", window: 14,
    channels: ["in_app"], recipient_ids: [], enabled: true, muted: false, snoozed_until: null,
    owner: { id: "u-1", name: "Ada Administrator" }, last_evaluated_at: "2026-09-03T09:00:00Z", last_status: "OK",
    last_value: 4, last_error: null, threshold_effective: 3, can_edit: true, open_anomalies: 0,
    last_anomaly_at: null, sparkline: [3, 4, 5, 4, 3, 5, 4], ...partial,
  };
}

export function anomaly(partial: Partial<Anomaly> & { id: string; watch_id: string }): Anomaly {
  return {
    watch_name: "New tickets per day", bucket_at: "2026-09-02T00:00:00+00:00", value: 40, expected: 4, stddev: 1.5,
    zscore: 24, direction: "up", severity: "CRITICAL", status: "OPEN", notified: true, suppressed_reason: null,
    acknowledged_at: null, created_at: "2026-09-02T01:00:00Z",
    series: [{ at: "2026-09-01T00:00:00+00:00", value: 4 }, { at: "2026-09-02T00:00:00+00:00", value: 40 }],
    granularity: "day", ...partial,
  };
}

interface State {
  contracts: ContractDetail[];
  model: HealthModel;
  watches: MetricWatch[];
  anomalies: Anomaly[];
  links: DashboardLink[];
  versions: VersionHistory;
  restored: { version: number; fields?: string[] }[];
  gridSaves: { id: string; changes: Record<string, unknown> }[][];
}

function versions(): VersionHistory {
  const base = { title: "Probe task", priority: "LOW", progress: 10, assignee_id: "u-1" };
  return {
    resource_type: "task", record_id: "tsk-1", title: "Probe task",
    fields: [
      { name: "title", label: "Title", kind: "text", references: "" },
      { name: "priority", label: "Priority", kind: "enum", references: "" },
      { name: "progress", label: "Progress", kind: "number", references: "" },
      { name: "assignee_id", label: "Assignee", kind: "uuid", references: "user" },
    ],
    versions: [
      { id: "a1", number: 1, at: "2026-09-01T10:00:00Z", action: "CREATE", actor: "Ada Administrator", actor_id: "u-1",
        message: "created", changed: ["title", "priority", "progress", "assignee_id"], restored_from: null, state: base },
      { id: "a2", number: 2, at: "2026-09-02T10:00:00Z", action: "UPDATE", actor: "Mara Manager", actor_id: "u-2",
        message: "updated", changed: ["priority"], restored_from: null, state: { ...base, priority: "HIGH" } },
      { id: "a3", number: 3, at: "2026-09-03T10:00:00Z", action: "UPDATE", actor: "Mara Manager", actor_id: "u-2",
        message: "updated", changed: ["title", "progress"], restored_from: null,
        state: { ...base, priority: "HIGH", title: "Probe task, renamed", progress: 60 } },
    ],
    current: 3, as_of: null, references: { user: { "u-1": "Ada Administrator" } }, can_restore: true,
    updated_at: "2026-09-03T10:00:00Z",
  };
}

function fresh(): State {
  return {
    contracts: [
      contract({ id: "ctr-1", reference: "CTR-00001", stage: "UPCOMING" }),
      contract({ id: "ctr-2", reference: "CTR-00002", stage: "NEGOTIATION", stage_label: "In negotiation", probability: 65,
        customer: { id: "cus-2", name: "Brightpath Works", code: "CUS-00002" }, at_risk: true, health_band: "CRITICAL",
        health_score: 31, rank: 2048 }),
      contract({ id: "ctr-3", reference: "CTR-00003", stage: "RENEWED", stage_label: "Renewed", probability: 100,
        days_to_end: -20, end_date: "2026-08-14", closed_at: "2026-08-10T10:00:00Z" }),
    ],
    model: JSON.parse(JSON.stringify(MODEL)) as HealthModel,
    watches: [
      watch({ id: "w-1", name: "New tickets per day", last_status: "ANOMALY", open_anomalies: 1, last_anomaly_at: "2026-09-02T00:00:00Z" }),
      watch({ id: "w-2", name: "Order revenue per week", dataset: "order", measure: "sum", measure_field: "total",
        granularity: "week", muted: true, snoozed_until: "2026-09-05T10:00:00Z", last_status: "NO_DATA" }),
    ],
    anomalies: [anomaly({ id: "an-1", watch_id: "w-1" }),
      anomaly({ id: "an-2", watch_id: "w-1", direction: "down", status: "ACKNOWLEDGED", value: 0, zscore: -3.2,
        notified: false, suppressed_reason: "snoozed", bucket_at: "2026-08-20T00:00:00+00:00" })],
    links: [{
      id: "l-1", dashboard_id: "d-1", token: "tok-open-123456", path: "/share/dashboards/tok-open-123456",
      label: "Board pack", status: "ACTIVE", has_password: false, expires_at: null, revoked_at: null, allow_embed: true,
      allowed_origins: ["https://intranet.example"], view_count: 3, last_viewed_at: "2026-09-02T10:00:00Z",
      created_by: "Ada Administrator", created_at: "2026-09-01T10:00:00Z",
    }],
    versions: versions(),
    restored: [],
    gridSaves: [],
  };
}

export let ra: State = fresh();
export function resetRecordsAnalytics(): void {
  ra = fresh();
}

function board() {
  const columns = STAGES.map((stage) => {
    const cards = ra.contracts.filter((c) => c.stage === stage).sort((a, b) => a.rank - b.rank) as ContractCard[];
    return {
      stage, label: LABEL[stage], probability: PROB[stage], count: cards.length,
      value: cards.reduce((s, c) => s + c.value, 0), weighted: cards.reduce((s, c) => s + c.weighted, 0),
      at_risk: cards.filter((c) => c.at_risk).length, cards,
    };
  });
  return { columns, summary: summary(), can_manage: true };
}

function summary() {
  const open = ra.contracts.filter((c) => ["UPCOMING", "NEGOTIATION", "COMMITTED"].includes(c.stage));
  return {
    open: open.length, pipeline: open.reduce((s, c) => s + c.value, 0), weighted: open.reduce((s, c) => s + c.weighted, 0),
    at_risk: open.filter((c) => c.at_risk).length, at_risk_value: open.filter((c) => c.at_risk).reduce((s, c) => s + c.value, 0),
    due_90: open.length,
  };
}

const PUBLIC: PublicDashboard = {
  dashboard: { name: "Board pack", description: "Weekly numbers", icon: null, columns: 12, period: "last_30_days",
    owner: "Ada Administrator", updated_at: "2026-09-01T10:00:00Z" },
  widgets: [
    { id: "pw-1", kind: "KPI", title: "Open tickets", subtitle: null, x: 0, y: 0, width: 3, height: 2,
      data: { type: "metrics", gauge: false, strip: false, metric: null, metrics: [{ key: "total", label: "Tickets", value: 600, format: "number" }] } },
    { id: "pw-2", kind: "ANALYTICS", title: "Orders", subtitle: null, x: 3, y: 0, width: 6, height: 2,
      data: { type: "metrics", gauge: false, strip: true, metric: null, metrics: [
        { key: "total", label: "Orders", value: 800, format: "number" }, { key: "revenue", label: "Revenue", value: 1200000, format: "currency" }] } },
    { id: "pw-3", kind: "GAUGE", title: "Progress", subtitle: null, x: 9, y: 0, width: 3, height: 2,
      data: { type: "metrics", gauge: true, strip: false, metric: null, metrics: [{ key: "p", label: "Average progress", value: 42, format: "percent" }] } },
    { id: "pw-4", kind: "BAR_CHART", title: "By status", subtitle: null, x: 0, y: 2, width: 6, height: 3,
      data: { type: "chart", chart: "bar", result: {
        resource_type: "ticket", resource_label: "Tickets", path: "/tickets",
        dimensions: [{ field: "status", label: "Status", kind: "enum", granularity: "" }],
        measures: [{ key: "count", label: "Count", aggregation: "count", field: "", format: "number" }],
        rows: [{ keys: ["OPEN"], labels: ["Open"], values: { count: 12 } }], totals: { count: 12 }, matched: 12,
        truncated: false, other: null, period: { key: "all_time", field: "created_at", from: null, to: null },
        description: "Tickets by status", generated_at: "2026-09-03T10:00:00Z" } as never } },
    { id: "pw-5", kind: "TABLE", title: "Latest", subtitle: null, x: 6, y: 2, width: 6, height: 3,
      data: { type: "rows", table: true, columns: [{ name: "code", label: "Code" }, { name: "status", label: "Status" }],
        title_field: "name", status_field: "status", items: [{ id: "r1", code: "CUS-1", status: "ACTIVE" }] } },
    { id: "pw-6", kind: "LIST", title: "Newest", subtitle: null, x: 0, y: 5, width: 4, height: 2,
      data: { type: "rows", table: false, columns: [], title_field: "title", status_field: "status",
        items: [{ id: "t1", title: "Fix the importer", status: "NEW" }] } },
    { id: "pw-7", kind: "MAIL", title: "My mail", subtitle: null, x: 4, y: 5, width: 4, height: 2,
      data: { type: "private", message: "This widget shows a personal workspace and is not published." } },
    { id: "pw-8", kind: "KPI", title: "Broken", subtitle: null, x: 8, y: 5, width: 4, height: 2,
      data: { type: "error", message: "Unknown dataset." } },
  ],
  link: { label: "Board pack", expires_at: "2026-10-01T00:00:00Z", embedded: false },
  generated_at: "2026-09-03T10:00:00Z",
};

export const recordsAnalyticsHandlers = [
  // ── health ──────────────────────────────────────────────────────────
  http.get(`${P}/api/customer-health`, ({ request }) => {
    const url = new URL(request.url);
    const band = url.searchParams.get("band");
    const all = [
      entry({ id: "cus-1", name: "Acme Logistics", score: 78, band: "HEALTHY", delta_30d: 6 }),
      entry({ id: "cus-2", name: "Brightpath Works", score: 31, band: "CRITICAL", previous_band: "AT_RISK", delta_30d: -22,
        band_changed_at: "2026-09-01T02:15:00Z" }),
      entry({ id: "cus-3", name: "Cobalt Group", score: 52, band: "AT_RISK", delta_30d: -3 }),
    ];
    const items = band ? all.filter((e) => e.band === band) : all;
    return HttpResponse.json({
      total: 3, average: 54,
      distribution: [{ band: "HEALTHY", label: "Healthy", count: 1 }, { band: "AT_RISK", label: "At risk", count: 1 }, { band: "CRITICAL", label: "Critical", count: 1 }],
      histogram: Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 9, count: i === 3 || i === 5 || i === 7 ? 1 : 0 })),
      movers: { period: url.searchParams.get("period") === "7d" ? "7d" : "30d", up: [all[0]], down: [all[1], all[2]] },
      drops: [all[1]], items, matching: items.length, page: 1, page_size: 12, computed_at: "2026-09-03T02:15:00Z",
      thresholds: { healthy: 65, at_risk: 40 }, can_configure: true,
    });
  }),
  http.get(`${P}/api/customer-health/customers/:id`, ({ params }) =>
    HttpResponse.json({
      customer: { id: String(params.id), name: "Brightpath Works", code: "CUS-00002" },
      score: 31, band: "CRITICAL", band_label: "Critical", previous_band: "AT_RISK", band_changed_at: "2026-09-01T02:15:00Z",
      delta_7d: -4, delta_30d: -22, computed_at: "2026-09-03T02:15:00Z",
      components: [
        { key: "tickets", label: "Support tickets", score: 43, weight: 30, share: 30, contribution: 12.9,
          facts: [{ text: "3 open tickets", impact: -15 }, { text: "1 SLA breach in 90 days", impact: -12 }], inputs: {} },
        { key: "orders", label: "Orders", score: 18, weight: 30, share: 30, contribution: 5.4,
          facts: [{ text: "No orders yet", impact: -40 }], inputs: {} },
        { key: "usage", label: "Usage", score: 70, weight: 25, share: 25, contribution: 17.5,
          facts: [{ text: "8 of 10 devices online", impact: 12 }], inputs: {} },
        { key: "renewal", label: "Renewal", score: 0, weight: 15, share: 15, contribution: 0,
          facts: [{ text: "CTR-00002 churned", impact: -100 }], inputs: {} },
      ],
      trend: [{ day: "2026-09-01", score: 40, band: "AT_RISK", components: {} }, { day: "2026-09-02", score: 35, band: "CRITICAL", components: {} },
        { day: "2026-09-03", score: 31, band: "CRITICAL", components: {} }],
      thresholds: { healthy: 65, at_risk: 40 },
    }),
  ),
  http.get(`${P}/api/customer-health/model`, () => HttpResponse.json(ra.model)),
  http.put(`${P}/api/customer-health/model`, async ({ request }) => {
    const body = (await request.json()) as Partial<HealthModel>;
    ra.model = { ...ra.model, ...body, weights: { ...ra.model.weights, ...(body.weights ?? {}) } } as HealthModel;
    return HttpResponse.json({ ...ra.model, recomputed: { customers: 3 } });
  }),
  http.post(`${P}/api/customer-health/recompute`, () => HttpResponse.json({ status: "SUCCEEDED", customers: 3, dropped: 1 })),

  // ── contracts ───────────────────────────────────────────────────────
  http.get(`${P}/api/contracts/board`, () => HttpResponse.json(board())),
  http.get(`${P}/api/contracts/forecast`, () =>
    HttpResponse.json({
      quarters: [
        { key: "2026-Q2", label: "Q2 2026", current: false, past: true, pipeline: 0, weighted: 80000, committed: 0, renewed: 80000, churned: 20000, at_risk: 0, count: 2 },
        { key: "2026-Q3", label: "Q3 2026", current: true, past: false, pipeline: 240000, weighted: 138000, committed: 0, renewed: 0, churned: 0, at_risk: 120000, count: 2 },
        { key: "2026-Q4", label: "Q4 2026", current: false, past: false, pipeline: 0, weighted: 0, committed: 0, renewed: 0, churned: 0, at_risk: 0, count: 0 },
      ],
      totals: { pipeline: 240000, weighted: 218000, committed: 0, renewed: 80000, churned: 20000, at_risk: 120000 },
    }),
  ),
  http.get(`${P}/api/contracts/calendar`, ({ request }) => {
    const month = new URL(request.url).searchParams.get("month") ?? "2026-09";
    return HttpResponse.json({
      month, from: `${month}-01`, to: `${month}-30`,
      events: [
        { day: `${month}-15`, kind: "END", contract: ra.contracts[0] },
        { day: `${month}-10`, kind: "NOTICE", contract: ra.contracts[1] },
      ],
    });
  }),
  http.get(`${P}/api/contracts`, () =>
    HttpResponse.json({ items: ra.contracts, total: ra.contracts.length, page: 1, page_size: 200, summary: summary(),
      stages: STAGES.map((key) => ({ key, label: LABEL[key] })), can_manage: true }),
  ),
  http.post(`${P}/api/contracts`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const made = contract({ id: `ctr-${ra.contracts.length + 1}`, reference: `CTR-0000${ra.contracts.length + 1}`, title: String(body.title ?? "New") });
    ra.contracts.push(made);
    return HttpResponse.json(made, { status: 201 });
  }),
  http.get(`${P}/api/contracts/:id/files`, ({ params }) =>
    HttpResponse.json({
      folder_id: params.id === "ctr-1" ? "fld-1" : null,
      items: params.id === "ctr-1" ? [{ id: "f-1", name: "signed.pdf", extension: "pdf", kind: "DOCUMENT", size_bytes: 20480, status: "READY", owner: "Ada Administrator", created_at: "2026-09-01T10:00:00Z" }] : [],
      can_upload: true,
    }),
  ),
  http.post(`${P}/api/contracts/:id/files`, () => HttpResponse.json({ folder_id: "fld-1" })),
  http.post(`${P}/api/contracts/:id/move`, async ({ params, request }) => {
    const body = (await request.json()) as { stage: ContractStage; before_id?: string | null };
    const row = ra.contracts.find((c) => c.id === params.id);
    if (!row) return HttpResponse.json({ error: "not_found", message: "No contract" }, { status: 404 });
    if (body.stage === ("CHURNED" as ContractStage) && params.id === "ctr-3") {
      return HttpResponse.json({ error: "forbidden", message: "nope", details: { missing: ["contracts.manage"] } }, { status: 403 });
    }
    Object.assign(row, { stage: body.stage, stage_label: LABEL[body.stage], probability: PROB[body.stage] });
    return HttpResponse.json(row);
  }),
  http.get(`${P}/api/contracts/:id`, ({ params }) => {
    const row = ra.contracts.find((c) => c.id === params.id);
    return row ? HttpResponse.json(row) : HttpResponse.json({ error: "not_found", message: "That contract does not exist." }, { status: 404 });
  }),
  http.put(`${P}/api/contracts/:id`, async ({ params, request }) => {
    const row = ra.contracts.find((c) => c.id === params.id)!;
    Object.assign(row, await request.json());
    return HttpResponse.json(row);
  }),
  http.delete(`${P}/api/contracts/:id`, ({ params }) => {
    ra.contracts = ra.contracts.filter((c) => c.id !== params.id);
    return HttpResponse.json({ id: params.id, deleted: true });
  }),

  // ── versions ────────────────────────────────────────────────────────
  http.get(`${P}/api/records/:type/:id/versions`, ({ request }) => {
    const at = new URL(request.url).searchParams.get("at");
    if (at === "2001-01-01") return HttpResponse.json({ error: "not_found", message: "There is no version of this record that early." }, { status: 404 });
    return HttpResponse.json({ ...ra.versions, as_of: at ? 2 : null });
  }),
  http.post(`${P}/api/records/:type/:id/versions/restore`, async ({ request }) => {
    const body = (await request.json()) as { version: number; fields?: string[] };
    ra.restored.push(body);
    const target = ra.versions.versions[body.version - 1]!;
    const latest = ra.versions.versions[ra.versions.versions.length - 1]!;
    const fields = body.fields ?? ra.versions.fields.map((f) => f.name).filter((n) => target.state[n] !== latest.state[n]);
    const state = { ...latest.state, ...Object.fromEntries(fields.map((n) => [n, target.state[n]])) };
    ra.versions = {
      ...ra.versions,
      versions: [...ra.versions.versions, { id: `r${ra.versions.versions.length + 1}`, number: ra.versions.versions.length + 1,
        at: "2026-09-03T11:00:00Z", action: "RESTORE", actor: "Ada Administrator", actor_id: "u-1", message: "restored",
        changed: fields, restored_from: body.version, state }],
      current: ra.versions.versions.length + 1,
    };
    return HttpResponse.json({ restored: fields, version: body.version, message: `Restored ${fields.length} field${fields.length === 1 ? "" : "s"} from version ${body.version}.`, history: ra.versions });
  }),

  // ── grid save (the records bulk API's rows mode) ────────────────────
  http.post(`${P}/api/records/:type/bulk`, async ({ request }) => {
    const body = (await request.json()) as { rows?: { id: string; changes: Record<string, unknown> }[] };
    if (!body.rows) return undefined;
    ra.gridSaves.push(body.rows);
    const results = body.rows.map((row) =>
      row.changes.name === "REFUSE"
        ? { id: row.id, title: row.id, status: "failed", error: "validation_failed", message: "1 value refused.",
            problems: [{ field: "name", message: "That name is taken." }] }
        : { id: row.id, title: row.id, status: "applied", changed: Object.keys(row.changes), problems: [], updated_at: "2026-09-03T12:00:00Z" },
    );
    const failed = results.filter((r) => r.status === "failed");
    return HttpResponse.json({
      resource_type: "customer", requested: results.length, applied: results.length - failed.length, unchanged: 0,
      failed, results, message: failed.length ? `Updated ${results.length - failed.length}; ${failed.length} could not be updated.` : `Updated ${results.length} customers.`,
    });
  }),

  // ── alerts ──────────────────────────────────────────────────────────
  http.get(`${P}/api/alerts/catalogue`, () =>
    HttpResponse.json({
      datasets: [
        { key: "ticket", label: "Tickets", default_date: "created_at", dates: [{ name: "created_at", label: "Created" }],
          numbers: [{ name: "reopen_count", label: "Reopens" }],
          filters: [{ name: "priority", label: "Priority", kind: "enum", choices: ["LOW", "HIGH", "CRITICAL"] }] },
        { key: "order", label: "Orders", default_date: "placed_at", dates: [{ name: "placed_at", label: "Placed" }],
          numbers: [{ name: "total", label: "Total" }], filters: [] },
      ],
      measures: ["count", "sum", "avg"], granularities: ["hour", "day", "week"], methods: ["zscore", "seasonal"],
      sensitivities: [{ key: "low", threshold: 4 }, { key: "medium", threshold: 3 }, { key: "high", threshold: 2.2 }],
      directions: ["both", "up", "down"], channels: ["in_app", "email"], can_manage: true,
    }),
  ),
  http.post(`${P}/api/alerts/preview`, () =>
    HttpResponse.json({ points: [{ at: "2026-09-01T00:00:00+00:00", value: 3 }, { at: "2026-09-02T00:00:00+00:00", value: 30, expected: 3, upper: 8, lower: 0, unusual: true }], flagged: 1, threshold: 3 }),
  ),
  http.get(`${P}/api/alerts/watches`, () =>
    HttpResponse.json({ items: ra.watches, total: ra.watches.length, open_anomalies: 1, can_manage: true }),
  ),
  http.post(`${P}/api/alerts/watches`, async ({ request }) => {
    const body = (await request.json()) as Partial<MetricWatch>;
    const made = watch({ id: `w-${ra.watches.length + 1}`, name: String(body.name), ...body } as MetricWatch);
    ra.watches.push(made);
    return HttpResponse.json(made, { status: 201 });
  }),
  http.get(`${P}/api/alerts/watches/:id/chart`, ({ params }) => {
    const row = ra.watches.find((w) => w.id === params.id);
    if (!row) return HttpResponse.json({ error: "not_found", message: "That watch does not exist." }, { status: 404 });
    return HttpResponse.json({
      watch: row,
      points: [{ at: "2026-09-01T00:00:00+00:00", value: 4, expected: 4, upper: 8, lower: 0 }, { at: "2026-09-02T00:00:00+00:00", value: 40, expected: 4, upper: 8, lower: 0, unusual: true }],
      anomalies: ra.anomalies.filter((a) => a.watch_id === row.id),
    });
  }),
  http.post(`${P}/api/alerts/watches/:id/evaluate`, ({ params }) => {
    const row = ra.watches.find((w) => w.id === params.id)!;
    const made = anomaly({ id: `an-${ra.anomalies.length + 1}`, watch_id: row.id });
    ra.anomalies.unshift(made);
    row.last_status = "ANOMALY";
    return HttpResponse.json({ status: "ANOMALY", new: 1, anomalies: [made], watch: row });
  }),
  http.post(`${P}/api/alerts/watches/:id/silence`, async ({ params, request }) => {
    const row = ra.watches.find((w) => w.id === params.id)!;
    const body = (await request.json()) as { hours?: number; muted?: boolean; clear?: boolean };
    if (body.clear) Object.assign(row, { muted: false, snoozed_until: null });
    if (body.muted !== undefined) row.muted = body.muted;
    if (body.hours) row.snoozed_until = "2026-09-04T10:00:00Z";
    return HttpResponse.json(row);
  }),
  http.get(`${P}/api/alerts/watches/:id`, ({ params }) => HttpResponse.json(ra.watches.find((w) => w.id === params.id))),
  http.put(`${P}/api/alerts/watches/:id`, async ({ params, request }) => {
    const row = ra.watches.find((w) => w.id === params.id)!;
    Object.assign(row, await request.json());
    return HttpResponse.json(row);
  }),
  http.delete(`${P}/api/alerts/watches/:id`, ({ params }) => {
    ra.watches = ra.watches.filter((w) => w.id !== params.id);
    return HttpResponse.json({ id: params.id, deleted: true });
  }),
  http.get(`${P}/api/alerts/anomalies`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const watchId = url.searchParams.get("watch_id");
    const items = ra.anomalies.filter((a) => (!status || a.status === status) && (!watchId || a.watch_id === watchId));
    return HttpResponse.json({ items, total: items.length, page: 1, page_size: 20 });
  }),
  http.post(`${P}/api/alerts/anomalies/:id/acknowledge`, ({ params }) => {
    const row = ra.anomalies.find((a) => a.id === params.id)!;
    row.status = "ACKNOWLEDGED";
    return HttpResponse.json(row);
  }),

  // ── public links ────────────────────────────────────────────────────
  http.get(`${P}/api/dashboards/:id/links`, ({ params }) =>
    HttpResponse.json({ items: ra.links, can_publish: true, dashboard: { id: String(params.id), name: "Board" } }),
  ),
  http.post(`${P}/api/dashboards/:id/links`, async ({ params, request }) => {
    const body = (await request.json()) as { label?: string; password?: string | null; allow_embed?: boolean };
    const made: DashboardLink = {
      ...ra.links[0]!, id: `l-${ra.links.length + 1}`, dashboard_id: String(params.id), token: `tok-new-${ra.links.length}`,
      path: `/share/dashboards/tok-new-${ra.links.length}`, label: body.label ?? null, has_password: Boolean(body.password),
      allow_embed: Boolean(body.allow_embed), allowed_origins: [], view_count: 0, last_viewed_at: null,
    };
    ra.links.unshift(made);
    return HttpResponse.json(made, { status: 201 });
  }),
  http.delete(`${P}/api/dashboards/:id/links/:linkId`, ({ params }) => {
    const row = ra.links.find((l) => l.id === params.linkId)!;
    row.status = "REVOKED";
    return HttpResponse.json(row);
  }),
  http.get(`${P}/public/dashboards/:token/view`, ({ params, request }) => {
    const token = String(params.token);
    if (token === "tok-gone") return HttpResponse.json({ error: "link_unavailable", message: "This link has expired.", details: { reason: "expired" } }, { status: 410 });
    if (token === "tok-missing") return HttpResponse.json({ error: "not_found", message: "This link does not exist." }, { status: 404 });
    if (token === "tok-locked" && request.headers.get("X-Share-Grant") !== "grant-ok") {
      return HttpResponse.json({ error: "unauthorized", message: "Protected", details: { reason: "password_required" } }, { status: 401 });
    }
    return HttpResponse.json(PUBLIC);
  }),
  http.get(`${P}/public/dashboards/:token`, () => HttpResponse.json({ name: "Investors", has_password: true, allow_embed: false, expires_at: null })),
  http.post(`${P}/public/dashboards/:token/unlock`, async ({ request }) => {
    const body = (await request.json()) as { password: string };
    if (body.password !== "opensesame") {
      return HttpResponse.json({ error: "unauthorized", message: "That password is not right.", details: { reason: "wrong_password" } }, { status: 401 });
    }
    return HttpResponse.json({ grant: "grant-ok", expires_in: 3600 });
  }),
];
