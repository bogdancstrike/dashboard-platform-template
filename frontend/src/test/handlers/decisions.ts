/**
 * Time & decisions, mocked with in-memory state: a timer that starts and
 * stops, a week whose cells and submission change it, an approvals queue that
 * decisions shrink, SLA policies and calendars, and intake forms with
 * submissions. `resetDecisions()` puts everything back between tests.
 */

import { http, HttpResponse } from "msw";

import type { Approval, ApprovalDetail, ChangeRule } from "@/api/approvals";
import type { FormDetail, FormField, Submission } from "@/api/forms";
import type { BusinessCalendar, SlaPolicy } from "@/api/sla";
import type { TimeEntry, Week } from "@/api/time";

const DAYS = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const at = "2026-11-12T10:00:00Z";

function timeEntry(partial: Partial<TimeEntry> & { id: string }): TimeEntry {
  return {
    user_id: "user-1", user_name: "Ada Administrator", subject_type: "task", subject_id: "task-1",
    subject_label: "TSK-00001 · Ship the thing", link: "/tasks/task-1", project_id: null, customer_id: null,
    work_date: DAYS[0]!, started_at: null, ended_at: null, minutes: 60, elapsed_seconds: null, running: false,
    note: "", billable: true, source: "MANUAL", ...partial,
  };
}

function approval(partial: Partial<Approval> & { id: string }): Approval {
  return {
    reference: `APR-${partial.id.padStart(5, "0")}`, kind: "access", kind_label: "Access requests", icon: "key",
    status: "PENDING", title: "Access: View audit logs", summary: "I investigate complaints",
    requester: { id: "user-9", name: "Uma User", avatar_url: null, job_title: "Support" }, assignee: null,
    decided_by: null, subject_type: "permission", subject_id: "audit.view", subject_label: "View audit logs",
    link: "/admin/audit", created_at: at, due_at: "2026-11-13T10:00:00Z", decided_at: null, decision_comment: "",
    age_hours: 3, due_in_hours: 21, standing: "ok", can_decide: true, can_withdraw: false, mine: false, ...partial,
  };
}

const state = {
  running: null as TimeEntry | null,
  entries: [] as TimeEntry[],
  sheet: "DRAFT" as Week["timesheet"]["status"],
  approvals: [] as Approval[],
  rules: [] as ChangeRule[],
  policies: [] as SlaPolicy[],
  calendars: [] as BusinessCalendar[],
  forms: [] as FormDetail[],
  submissions: [] as Submission[],
};

export const decisionCalls: { method: string; path: string; body: unknown }[] = [];

export function resetDecisions(): void {
  decisionCalls.length = 0;
  state.running = null;
  state.sheet = "DRAFT";
  state.entries = [
    timeEntry({ id: "e1", work_date: DAYS[0], minutes: 90, source: "TIMER", started_at: "2026-11-09T08:00:00Z", ended_at: "2026-11-09T09:30:00Z", note: "Pairing" }),
    timeEntry({ id: "e2", work_date: DAYS[1], minutes: 120, subject_type: "ticket", subject_id: "ticket-1", subject_label: "TIC-00001 · Login fails", link: "/tickets/ticket-1", billable: false }),
    timeEntry({ id: "e3", work_date: DAYS[2], minutes: 45, source: "GRID" }),
  ];
  state.approvals = [
    approval({ id: "1" }),
    approval({ id: "2", kind: "timesheet", kind_label: "Timesheets", icon: "clock", title: "Timesheet · week of 02 Nov 2026 · 38.0 h", standing: "overdue", due_in_hours: -30 }),
    approval({ id: "3", kind: "change", kind_label: "Change requests", icon: "pen", title: "Change ORD-00001: total", standing: "due_soon", due_in_hours: 2 }),
    approval({ id: "4", title: "Mine", mine: true, can_decide: false, can_withdraw: true, requester: { id: "user-1", name: "Ada Administrator", avatar_url: null, job_title: null } }),
  ];
  state.rules = [{ id: "r1", name: "Critical needs a lead", description: "", resource_type: "ticket", field: "priority", operator: "EQUALS", value: "CRITICAL", active: true, created_at: at }];
  state.calendars = [{
    id: "cal-1", name: "Berlin office hours", timezone: "Europe/Berlin", is_default: true, weekly_minutes: 2400, used_by: 1, updated_at: at,
    hours: { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]], sat: [], sun: [] },
    holidays: [{ date: "2026-12-25", name: "Christmas Day" }],
  }];
  state.policies = [
    {
      id: "pol-1", name: "Strategic accounts", description: "Fastest answers", position: 1, active: true,
      conditions: { segments: ["STRATEGIC"], customer_ids: ["cus-1"] }, calendar_id: null, calendar_name: null,
      targets: { CRITICAL: { first_response: 15, resolution: 240 }, NORMAL: { first_response: 120, resolution: 1440 } },
      pause_statuses: ["WAITING_CUSTOMER"], escalations: [{ at_percent: 75, action: "NOTIFY", target: "assignee" }, { at_percent: 150, action: "RAISE_PRIORITY" }],
      covered_open: 12, breached_open: 3, updated_at: at,
    },
    {
      id: "pol-2", name: "Standard support", description: "Everything else", position: 2, active: true,
      conditions: {}, calendar_id: "cal-1", calendar_name: "Berlin office hours",
      targets: { NORMAL: { first_response: 480, resolution: 4800 } }, pause_statuses: [], escalations: [],
      covered_open: 40, breached_open: 0, updated_at: at,
    },
  ];
  const fields: FormField[] = [
    { id: "intro", type: "heading", label: "About you" },
    { id: "email", type: "email", label: "Your email", required: true },
    { id: "subject", type: "text", label: "What is wrong?", required: true, map_to: "subject" },
    { id: "area", type: "select", label: "Area", options: ["Billing", "Other"] },
    { id: "other", type: "text", label: "Which area?", visible_when: { field: "area", equals: "Other" } },
  ];
  state.forms = [{
    id: "form-1", name: "Customer support request", slug: "support", description: "Tell us", target: "ticket",
    status: "PUBLISHED", visibility: "PUBLIC", submission_count: 2, owner: "Mara Manager", public_path: "/f/support",
    updated_at: at, created_at: at, field_count: 4, last_week: 2, failed: 1, fields,
    settings: { visibility: "PUBLIC", confirmation: "Thanks!", notify_user_ids: [], captcha: true, rate_limit_per_hour: 10, defaults: { priority: "HIGH" }, submit_label: "Send request" },
    targets: TARGETS, can_manage: true,
  }];
  state.submissions = [
    { id: "s1", reference: "SUB-00001", status: "CONVERTED", created_at: at, record_type: "ticket", record_id: "ticket-1", record_label: "TIC-00001", record_path: "/tickets/ticket-1", error: "", submitter_email: "dana@example.com", answers: [{ id: "email", label: "Your email", value: "dana@example.com" }, { id: "tags", label: "Tags", value: ["a", "b"] }] },
    { id: "s2", reference: "SUB-00002", status: "FAILED", created_at: at, record_type: null, record_id: null, record_label: null, record_path: null, error: "Subject is required.", submitter_email: null, answers: [] },
  ];
}

const TARGETS = [
  { key: "ticket", label: "Tickets", fields: [
    { name: "subject", label: "Subject", kind: "text", required: true, choices: [], references: "" },
    { name: "description", label: "Description", kind: "text", required: false, choices: [], references: "" },
    { name: "priority", label: "Priority", kind: "enum", required: false, choices: ["LOW", "NORMAL", "HIGH", "CRITICAL"], references: "" },
  ] },
  { key: "task", label: "Tasks", fields: [
    { name: "title", label: "Title", kind: "text", required: true, choices: [], references: "" },
  ] },
];

resetDecisions();

function week(): Week {
  const rows = new Map<string, Week["rows"][number]>();
  const totals: Record<string, number> = Object.fromEntries(DAYS.map((d) => [d, 0]));
  for (const entry of state.entries) {
    const key = `${entry.subject_type}:${entry.subject_id}`;
    const row = rows.get(key) ?? { subject_type: entry.subject_type, subject_id: entry.subject_id!, label: entry.subject_label, link: entry.link,
      cells: Object.fromEntries(DAYS.map((d) => [d, 0])), fixed: Object.fromEntries(DAYS.map((d) => [d, 0])), total: 0, billable_minutes: 0 };
    row.cells[entry.work_date!] = (row.cells[entry.work_date!] ?? 0) + entry.minutes;
    if (entry.source !== "GRID") row.fixed[entry.work_date!] = (row.fixed[entry.work_date!] ?? 0) + entry.minutes;
    row.total += entry.minutes;
    if (entry.billable) row.billable_minutes += entry.minutes;
    totals[entry.work_date!] = (totals[entry.work_date!] ?? 0) + entry.minutes;
    rows.set(key, row);
  }
  const total = state.entries.reduce((sum, e) => sum + e.minutes, 0);
  const locked = state.sheet === "SUBMITTED" || state.sheet === "APPROVED";
  return {
    user: { id: "user-1", name: "Ada Administrator" }, week_start: DAYS[0]!, previous_week: "2026-11-02", next_week: "2026-11-16",
    days: DAYS, rows: [...rows.values()], day_totals: totals, total_minutes: total,
    billable_minutes: state.entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0), entries: state.entries,
    timesheet: { id: "sheet-1", week_start: DAYS[0]!, status: state.sheet, submitted_at: state.sheet === "DRAFT" ? null : at, decided_at: null,
      decision_comment: state.sheet === "REJECTED" ? "Split the review" : "", approval_id: state.sheet === "DRAFT" ? null : "2" },
    locked, can_edit: !locked, can_submit: !locked && total > 0,
  };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try { return (await request.json()) as Record<string, unknown>; } catch { return {}; }
}

function record(method: string, path: string, payload: unknown) {
  decisionCalls.push({ method, path, body: payload });
}

function detail(item: Approval): ApprovalDetail {
  return {
    ...item,
    history: [{ at, action: "SUBMITTED", actor_id: "user-9", actor_label: item.requester?.name ?? "", comment: item.summary },
      ...(item.status !== "PENDING" ? [{ at, action: item.status, actor_id: "user-1", actor_label: "Ada Administrator", comment: item.decision_comment }] : [])],
    payload: {},
    details: item.kind === "timesheet"
      ? { facts: [{ label: "Total", value: "38.0 h" }], days: DAYS.map((date, i) => ({ date, minutes: i < 5 ? 450 : 0 })), subjects: [{ label: "TSK-1", minutes: 600 }] }
      : item.kind === "change" ? { changes: [{ field: "total", before: 1000, after: 60000 }] }
      : { facts: [{ label: "Permission", value: "View audit logs" }] },
  };
}

export const decisionHandlers = [
  http.get("/platform/meta/permissions", () => HttpResponse.json({
    groups: [
      { name: "Operations", permissions: [{ code: "audit.view", label: "View audit logs" }, { code: "logs.view", label: "View system logs" }] },
      { name: "Time & decisions", permissions: [{ code: "time.track", label: "Track and submit own time" }] },
    ],
    total: 3,
  })),
  // ── time ──
  http.get("/platform/api/time/timer", () => HttpResponse.json({ running: state.running, today_minutes: 135 })),
  http.post("/platform/api/time/timer", async ({ request }) => {
    const payload = await body(request);
    record("POST", "timer", payload);
    const stopped = state.running ? { ...state.running, running: false, minutes: 12 } : null;
    state.running = timeEntry({ id: "run-1", running: true, source: "TIMER", subject_type: payload["subject_type"] as never,
      subject_id: payload["subject_id"] as string, subject_label: "TSK-00001 · Ship the thing", started_at: new Date(Date.now() - 65_000).toISOString(), elapsed_seconds: 65 });
    return HttpResponse.json({ running: state.running, stopped });
  }),
  http.post("/platform/api/time/timer/stop", async ({ request }) => {
    record("POST", "stop", await body(request));
    if (!state.running) return HttpResponse.json({ error: "not_found", message: "No timer is running." }, { status: 404 });
    const stopped = { ...state.running, running: false, minutes: 12 };
    state.running = null;
    return HttpResponse.json({ running: null, stopped });
  }),
  http.get("/platform/api/time/week", () => HttpResponse.json(week())),
  http.put("/platform/api/time/cell", async ({ request }) => {
    const payload = await body(request);
    record("PUT", "cell", payload);
    if (Number(payload["minutes"]) === 999) return HttpResponse.json({ error: "conflict", message: "Too low" }, { status: 409 });
    state.entries.push(timeEntry({ id: `g${state.entries.length}`, work_date: payload["date"] as string, minutes: Number(payload["minutes"]), source: "GRID" }));
    return HttpResponse.json(week());
  }),
  http.post("/platform/api/time/submit", async ({ request }) => {
    record("POST", "submit", await body(request));
    state.sheet = "SUBMITTED";
    return HttpResponse.json(week());
  }),
  http.get("/platform/api/time/entries", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const billable = params.get("billable");
    const items = state.entries.filter((e) => !billable || String(e.billable) === billable);
    return HttpResponse.json({ items, total: items.length, page: 1, page_size: 25, total_minutes: items.reduce((s, e) => s + e.minutes, 0) });
  }),
  http.post("/platform/api/time/entries", async ({ request }) => {
    const payload = await body(request);
    record("POST", "entries", payload);
    const created = timeEntry({ id: `m${state.entries.length}`, ...(payload as Partial<TimeEntry>), minutes: Number(payload["minutes"] ?? 60) });
    state.entries.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.put("/platform/api/time/entries/:id", async ({ request, params }) => {
    const payload = await body(request);
    record("PUT", `entries/${String(params["id"])}`, payload);
    const found = state.entries.find((e) => e.id === params["id"]);
    if (found) Object.assign(found, payload);
    return HttpResponse.json(found);
  }),
  http.delete("/platform/api/time/entries/:id", ({ params }) => {
    record("DELETE", `entries/${String(params["id"])}`, null);
    state.entries = state.entries.filter((e) => e.id !== params["id"]);
    return HttpResponse.json({ id: params["id"], removed: true });
  }),
  http.get("/platform/api/time/team", () => HttpResponse.json({
    week_start: "2026-11-02", previous_week: "2026-10-26", next_week: "2026-11-09",
    items: [
      { user: { id: "user-2", name: "Otto Operator", avatar_url: null, job_title: "Operator" }, total_minutes: 2160, billable_minutes: 1500, status: "SUBMITTED", approval_id: "2", submitted_at: at },
      { user: { id: "user-3", name: "Ana Analyst", avatar_url: null, job_title: "Analyst" }, total_minutes: 1800, billable_minutes: 1200, status: "APPROVED", approval_id: null, submitted_at: at },
    ],
    counts: { SUBMITTED: 1, APPROVED: 1 },
  })),
  http.get("/platform/api/time/report", ({ request }) => {
    const group = new URL(request.url).searchParams.get("group_by") ?? "project";
    return HttpResponse.json({
      group_by: group, can_see_everyone: true, people: null, total_minutes: 600, billable_minutes: 420,
      items: [{ key: "p1", label: "Atlas migration", minutes: 400, billable_minutes: 300, entries: 6 }, { key: null, label: "Unassigned", minutes: 200, billable_minutes: 120, entries: 2 }],
    });
  }),
  http.get("/platform/api/time/export", ({ request }) => {
    record("GET", "export", new URL(request.url).searchParams.get("format"));
    return new HttpResponse("Date,Hours\n", { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="time.csv"' } });
  }),
  http.get("/platform/api/time/subjects", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return HttpResponse.json({ items: [
      { subject_type: "task", subject_id: "task-1", label: "TSK-00001 · Ship the thing", recent: !q },
      { subject_type: "ticket", subject_id: "ticket-1", label: "TIC-00001 · Login fails", recent: false },
    ] });
  }),
  http.get("/platform/api/time/on", () => HttpResponse.json({ total_minutes: 300, my_minutes: 90, entries: state.entries.slice(0, 2) })),

  // ── approvals ──
  http.get("/platform/api/approvals", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const scope = params.get("scope") ?? "inbox";
    const kind = params.get("kind");
    let items = state.approvals.filter((a) =>
      scope === "inbox" ? a.status === "PENDING" && a.can_decide : scope === "mine" ? a.mine : scope === "history" ? a.status !== "PENDING" : true);
    if (kind) items = items.filter((a) => a.kind === kind);
    return HttpResponse.json({
      items, total: items.length, page: 1, page_size: 20, pages: 1, scope,
      facets: { kind: { access: 2, timesheet: 1, change: 1 }, requester: [{ id: "user-9", name: "Uma User", count: 3 }] },
      kinds: [
        { kind: "access", label: "Access requests", icon: "key", can_decide: true, sla_hours: 24 },
        { kind: "timesheet", label: "Timesheets", icon: "clock", can_decide: true, sla_hours: 48 },
      ],
      counts: { inbox: state.approvals.filter((a) => a.status === "PENDING" && a.can_decide).length, overdue: 1, mine_pending: 1 },
    });
  }),
  http.get("/platform/api/approvals/rules", () => HttpResponse.json({
    items: state.rules, operators: ["ANY", "EQUALS", "IN", "GT", "LT"], can_manage: true,
    catalogue: [{ resource_type: "ticket", label: "Tickets", fields: [{ name: "priority", label: "Priority", kind: "enum", choices: ["LOW", "HIGH", "CRITICAL"] }, { name: "subject", label: "Subject", kind: "text", choices: [] }] },
      { resource_type: "order", label: "Orders", fields: [{ name: "total", label: "Total", kind: "number", choices: [] }] }],
  })),
  http.post("/platform/api/approvals/rules", async ({ request }) => {
    const payload = await body(request);
    record("POST", "rules", payload);
    const rule = { id: `r${state.rules.length + 1}`, description: "", active: true, created_at: at, ...(payload as Partial<ChangeRule>) } as ChangeRule;
    state.rules.push(rule);
    return HttpResponse.json(rule, { status: 201 });
  }),
  http.put("/platform/api/approvals/rules/:id", async ({ request, params }) => {
    const payload = await body(request);
    record("PUT", `rules/${String(params["id"])}`, payload);
    const rule = state.rules.find((r) => r.id === params["id"])!;
    Object.assign(rule, payload);
    return HttpResponse.json(rule);
  }),
  http.delete("/platform/api/approvals/rules/:id", ({ params }) => {
    record("DELETE", `rules/${String(params["id"])}`, null);
    state.rules = state.rules.filter((r) => r.id !== params["id"]);
    return HttpResponse.json({ id: params["id"], removed: true });
  }),
  http.post("/platform/api/approvals/access", async ({ request }) => {
    const payload = await body(request);
    record("POST", "access", payload);
    return HttpResponse.json({ ...approval({ id: "9", mine: true }), already_pending: false }, { status: 201 });
  }),
  http.post("/platform/api/approvals/bulk", async ({ request }) => {
    const payload = await body(request);
    record("POST", "bulk", payload);
    const ids = payload["ids"] as string[];
    for (const item of state.approvals) if (ids.includes(item.id)) item.status = payload["decision"] === "approve" ? "APPROVED" : "REJECTED";
    return HttpResponse.json({ decided: ids.length - 1, failed: 1, results: [...ids.slice(1).map((id) => ({ id, ok: true })), { id: ids[0], ok: false, error: "Already decided" }] });
  }),
  http.get("/platform/api/approvals/:id", ({ params }) => {
    const item = state.approvals.find((a) => a.id === params["id"]);
    return item ? HttpResponse.json(detail(item)) : HttpResponse.json({ error: "not_found", message: "Nope" }, { status: 404 });
  }),
  http.post("/platform/api/approvals/:id/decision", async ({ request, params }) => {
    const payload = await body(request);
    record("POST", `decision/${String(params["id"])}`, payload);
    const item = state.approvals.find((a) => a.id === params["id"])!;
    item.status = payload["decision"] === "approve" ? "APPROVED" : "REJECTED";
    item.decision_comment = typeof payload["comment"] === "string" ? payload["comment"] : "";
    item.can_decide = false;
    item.standing = "decided";
    return HttpResponse.json(detail(item));
  }),
  http.post("/platform/api/approvals/:id/withdraw", ({ params }) => {
    record("POST", `withdraw/${String(params["id"])}`, null);
    const item = state.approvals.find((a) => a.id === params["id"])!;
    item.status = "WITHDRAWN";
    item.can_withdraw = false;
    return HttpResponse.json(detail(item));
  }),

  // ── SLA ──
  http.get("/platform/api/sla/catalogue", () => HttpResponse.json({
    priorities: ["LOW", "NORMAL", "HIGH", "CRITICAL"], categories: ["SUPPORT", "BUG", "BILLING"], channels: ["EMAIL", "PORTAL"],
    segments: ["SMB", "ENTERPRISE", "STRATEGIC"], statuses: ["OPEN", "WAITING_CUSTOMER", "RESOLVED"], actions: ["NOTIFY", "ASSIGN", "RAISE_PRIORITY"],
    notify_targets: ["assignee", "manager", "user"], days: ["mon"], timezones: ["UTC", "Europe/Berlin"],
    customers: [{ id: "cus-1", name: "Acme", segment: "STRATEGIC" }], can_manage: true,
  })),
  http.get("/platform/api/sla/policies", () => HttpResponse.json({ items: state.policies, calendars: state.calendars, uncovered_open: 2, can_manage: true })),
  http.post("/platform/api/sla/policies", async ({ request }) => {
    const payload = await body(request);
    record("POST", "policies", payload);
    return HttpResponse.json({ ...state.policies[1], ...payload, id: "pol-new" }, { status: 201 });
  }),
  http.put("/platform/api/sla/policies/order", async ({ request }) => {
    const payload = await body(request);
    record("PUT", "order", payload);
    const ids = payload["ids"] as string[];
    state.policies = ids.map((id) => state.policies.find((p) => p.id === id)!);
    return HttpResponse.json({ items: state.policies, calendars: state.calendars, uncovered_open: 2, can_manage: true });
  }),
  http.put("/platform/api/sla/policies/:id", async ({ request, params }) => {
    const payload = await body(request);
    record("PUT", `policies/${String(params["id"])}`, payload);
    const policy = state.policies.find((p) => p.id === params["id"])!;
    Object.assign(policy, payload);
    return HttpResponse.json(policy);
  }),
  http.delete("/platform/api/sla/policies/:id", ({ params }) => {
    record("DELETE", `policies/${String(params["id"])}`, null);
    state.policies = state.policies.filter((p) => p.id !== params["id"]);
    return HttpResponse.json({ removed: true });
  }),
  http.post("/platform/api/sla/calendars", async ({ request }) => {
    const payload = await body(request);
    record("POST", "calendars", payload);
    return HttpResponse.json({ ...state.calendars[0], ...payload, id: "cal-new" }, { status: 201 });
  }),
  http.put("/platform/api/sla/calendars/:id", async ({ request, params }) => {
    const payload = await body(request);
    record("PUT", `calendars/${String(params["id"])}`, payload);
    return HttpResponse.json({ ...state.calendars[0], ...payload });
  }),
  http.delete("/platform/api/sla/calendars/:id", ({ params }) => {
    record("DELETE", `calendars/${String(params["id"])}`, null);
    return HttpResponse.json({ removed: true });
  }),
  http.post("/platform/api/sla/apply", () => {
    record("POST", "apply", null);
    return HttpResponse.json({ tickets: 600, covered: 590, escalations: { fired: 3 } });
  }),
  http.get("/platform/api/sla/tickets/:id", ({ params }) => params["id"] !== "ticket-sla" ? HttpResponse.json({
    ticket_id: params["id"], policy: null, calendar: null, priority: "NORMAL", targets: {}, first_response: null, resolution: null,
    paused: false, paused_since: null, paused_minutes: 0, pause_statuses: [], percent_elapsed: null, in_business_hours: true,
    escalations: [], computed_at: at,
  }) : HttpResponse.json({
    ticket_id: params["id"], policy: { id: "pol-1", name: "Strategic accounts", description: "" },
    calendar: { id: "cal-1", name: "Berlin office hours", timezone: "Europe/Berlin" }, priority: "CRITICAL",
    targets: { first_response: 15, resolution: 240 },
    first_response: { due_at: at, met: true, breached: false, done_at: at, business_minutes_left: null },
    resolution: { due_at: "2026-11-12T14:00:00Z", met: false, breached: false, done_at: null, business_minutes_left: 95 },
    paused: false, paused_since: null, paused_minutes: 30, pause_statuses: ["WAITING_CUSTOMER"], percent_elapsed: 60.5,
    in_business_hours: true, escalations: [{ at_percent: 50, action: "NOTIFY", target: "assignee", fired: true }, { at_percent: 150, action: "RAISE_PRIORITY", fired: false }],
    computed_at: at,
  })),

  // ── forms ──
  http.get("/platform/api/forms", () => HttpResponse.json({
    items: state.forms.map(({ fields: _f, settings: _s, targets: _t, can_manage: _c, ...rest }) => rest),
    targets: TARGETS, field_types: ["text", "email"], can_manage: true,
  })),
  http.post("/platform/api/forms", async ({ request }) => {
    const payload = await body(request);
    record("POST", "forms", payload);
    const created = { ...state.forms[0]!, ...(payload as Partial<FormDetail>), id: "form-new", submission_count: 0 };
    state.forms.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get("/platform/api/forms/:id", ({ params }) => {
    const form = state.forms.find((f) => f.id === params["id"]);
    return form ? HttpResponse.json(form) : HttpResponse.json({ error: "not_found", message: "That form does not exist." }, { status: 404 });
  }),
  http.put("/platform/api/forms/:id", async ({ request, params }) => {
    const payload = await body(request);
    record("PUT", `forms/${String(params["id"])}`, payload);
    const form = state.forms.find((f) => f.id === params["id"])!;
    Object.assign(form, payload, { settings: { ...form.settings, ...(payload["settings"] as object) } });
    return HttpResponse.json(form);
  }),
  http.delete("/platform/api/forms/:id", ({ params }) => {
    record("DELETE", `forms/${String(params["id"])}`, null);
    return HttpResponse.json({ removed: true });
  }),
  http.get("/platform/api/forms/:id/submissions", ({ request }) => {
    const status = new URL(request.url).searchParams.get("status");
    const items = state.submissions.filter((s) => !status || s.status === status);
    return HttpResponse.json({ items, total: items.length, page: 1, page_size: 25, counts: { CONVERTED: 1, FAILED: 1 } });
  }),
  http.post("/platform/api/forms/:id/submissions/:sid/retry", ({ params }) => {
    record("POST", `retry/${String(params["sid"])}`, null);
    const item = state.submissions.find((s) => s.id === params["sid"])!;
    item.status = "CONVERTED";
    return HttpResponse.json(item);
  }),
  http.get("/platform/public/forms/:slug", ({ params }) => {
    const form = state.forms.find((f) => f.slug === params["slug"]);
    if (!form) return HttpResponse.json({ error: "not_found", message: "This form does not exist." }, { status: 404 });
    return HttpResponse.json({
      name: form.name, slug: form.slug, description: form.description, status: form.status, open: form.status === "PUBLISHED",
      fields: form.fields, submit_label: form.settings.submit_label, visibility: "PUBLIC",
      challenge: { question: "What is 3 + 4?", token: "tok" }, honeypot: "website",
    });
  }),
  http.post("/platform/public/forms/:slug/submit", async ({ request }) => {
    const payload = await body(request);
    record("POST", "public-submit", payload);
    if (payload["captcha_answer"] !== "7") {
      return HttpResponse.json({ error: "validation_error", message: "That answer is not right — try again.", details: { field: "captcha" } }, { status: 400 });
    }
    return HttpResponse.json({ ok: true, message: "Thanks!", reference: "SUB-00003" }, { status: 201 });
  }),
];
