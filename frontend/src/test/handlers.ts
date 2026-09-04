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

export const currentUser = {
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@nucleus.example",
    username: "admin",
    full_name: "Ada Administrator",
    first_name: "Ada",
    last_name: "Administrator",
    avatar_url: null,
    initials: "AA",
    phone: null,
    job_title: "Platform Administrator",
    status: "ACTIVE",
    locale: "en-US",
    timezone: "Europe/Bucharest",
    joined_at: "2025-01-01T00:00:00Z",
    last_seen_at: "2026-09-03T12:00:00Z",
    profile_completeness: 100,
    mfa_enabled: true,
  },
  role: {
    code: "ADMINISTRATOR",
    name: "Administrator",
    description: "Unrestricted access.",
    color: "#dc2626",
  },
  organization: { id: "org-1", name: "Northwind Partners", slug: "northwind" },
  department: { id: "dep-1", name: "Operations", code: "OPS" },
  team: { id: "team-1", name: "Team Atlas", slug: "atlas" },
  groups: [],
  permissions: ["admin.access", "records.view", "users.view", "health.view"],
  preferences: {
    appearance: {
      theme: "system" as const,
      density: "middle" as const,
      sidebar_collapsed: false,
    },
    formats: {
      date: "YYYY-MM-DD" as const,
      time: "24h" as const,
      number: "1,234.56" as const,
    },
    defaults: { page_size: 25 as const, landing_page: "dashboard" },
  },
  session: {
    id: "session-1",
    impersonating: false,
    impersonator_id: null,
    impersonator_label: null,
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

export const explorerCatalogue = {
  items: [{
    key: "task",
    label: "Tasks",
    description: "Work items, ownership, priority and delivery state.",
    permission: "records.view",
    record_count: 500,
    default_columns: ["reference", "title", "status", "priority", "due_date"],
    default_sort: "updated_at",
    path: "/tasks",
    title_field: "title",
    subtitle_field: "reference",
    status_field: "status",
    fields: [
      { name: "reference", label: "Reference", kind: "text", sortable: true, filterable: true, searchable: true, facet: false, operators: ["eq", "contains", "starts"], choices: [] },
      { name: "title", label: "Title", kind: "text", sortable: true, filterable: true, searchable: true, facet: false, operators: ["eq", "contains", "not"], choices: [] },
      { name: "status", label: "Status", kind: "enum", sortable: true, filterable: true, searchable: false, facet: true, operators: ["eq", "ne", "in", "not_in", "empty", "not_empty"], choices: ["NEW", "IN_PROGRESS", "DONE"] },
      { name: "priority", label: "Priority", kind: "enum", sortable: true, filterable: true, searchable: false, facet: true, operators: ["eq", "ne", "in", "not_in"], choices: ["NORMAL", "HIGH", "CRITICAL"] },
      { name: "due_date", label: "Due date", kind: "datetime", sortable: true, filterable: true, searchable: false, facet: false, operators: ["before", "after", "between", "empty"], choices: [] },
      { name: "updated_at", label: "Updated", kind: "datetime", sortable: true, filterable: true, searchable: false, facet: false, operators: ["before", "after"], choices: [] },
    ],
  }],
  view_modes: ["table", "list", "cards", "compact"],
};

export const explorerResult = {
  items: [{ id: "task-1", reference: "TSK-001", title: "Review customer migration", status: "IN_PROGRESS", priority: "HIGH", due_date: "2026-09-10T12:00:00Z" }],
  total: 1,
  page: 1,
  page_size: 25,
  pages: 1,
  sort: "updated_at",
  order: "desc",
  resource_type: "task",
  columns: ["reference", "title", "status", "priority", "due_date"],
  fields: explorerCatalogue.items[0]!.fields,
  facets: {
    status: [{ value: "IN_PROGRESS", count: 1 }],
    priority: [{ value: "HIGH", count: 1 }],
  },
  condition_text: "",
  rule_count: 0,
  query_text: "",
  searchable: ["reference", "title"],
};

/** Global search, so the explorer's box has something to offer beside the dataset. */
export const globalResults = {
  query: "",
  total: 0,
  groups: [],
  truncated: false,
};


/** Six notifications for the signed-in user, three of them unread. */
export const notificationRows = [
  {
    id: "n1", category: "ASSIGNMENT", severity: "INFO",
    title: "Mara Manager assigned you TSK-00042", body: "Migrate the billing exports",
    icon: "user-check", is_read: false, read_at: null, link: "/tasks/task-1",
    resource_type: "task", resource_id: "task-1",
    actor_id: "u2", actor_label: "Mara Manager",
    group_key: "assignment:task", created_at: "2026-09-03T11:40:00Z",
  },
  {
    id: "n2", category: "SECURITY", severity: "CRITICAL",
    title: "New sign-in from an unrecognised device", body: "Bucharest, Chrome on Linux",
    icon: "shield", is_read: false, read_at: null, link: "/settings/security",
    resource_type: "user", resource_id: "u1",
    actor_id: null, actor_label: null,
    group_key: "security:user", created_at: "2026-09-03T09:15:00Z",
  },
  {
    id: "n3", category: "APPROVAL", severity: "WARNING",
    title: "Approval requested for ORD-00311", body: "18 400 EUR — awaiting your sign-off",
    icon: "check-circle", is_read: true, read_at: "2026-09-03T10:00:00Z",
    link: "/orders/order-1", resource_type: "order", resource_id: "order-1",
    actor_id: "u3", actor_label: "Otto Operator",
    group_key: "approval:order", created_at: "2026-09-02T16:05:00Z",
  },
];

export const notificationCounts = {
  unread: 2,
  by_category: { ASSIGNMENT: 1, SECURITY: 1 },
};

export function notificationPage(items = notificationRows, extra: Record<string, unknown> = {}) {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 25,
    pages: 1,
    sort: "created_at",
    order: "desc",
    grouped: false,
    ...notificationCounts,
    ...extra,
  };
}


export const auditCatalogue = {
  fields: [
    { name: "occurred_at", label: "When", kind: "datetime", sortable: true, filterable: true, searchable: false, facet: false, operators: ["before", "after", "between"], choices: [] },
    { name: "action", label: "Action", kind: "enum", sortable: true, filterable: true, searchable: false, facet: true, operators: ["eq", "ne", "in", "not_in"], choices: [] },
    { name: "actor_label", label: "Actor", kind: "text", sortable: true, filterable: true, searchable: true, facet: true, operators: ["eq", "contains"], choices: [] },
  ],
  default_columns: ["occurred_at", "actor_label", "action", "resource_type", "resource_label", "result"],
  default_sort: "occurred_at",
  actions: ["CREATE", "UPDATE", "DELETE", "EXPORT", "IMPERSONATE"],
  results: ["SUCCESS", "FAILURE", "DENIED", "PARTIAL"],
  total: 1000,
};

export const auditRows = [
  {
    id: "audit-1", occurred_at: "2026-09-03T11:00:00Z", action: "UPDATE", result: "SUCCESS",
    resource_type: "ticket", resource_id: "ticket-1", resource_label: "TIC-00042",
    actor_id: "u2", actor_label: "Mara Manager", actor_role: "MANAGER",
    impersonated: false, impersonator_label: "", correlation_id: "abc123",
    message: "", changed_field_count: 2,
  },
  {
    id: "audit-2", occurred_at: "2026-09-03T10:30:00Z", action: "DELETE", result: "DENIED",
    resource_type: "project", resource_id: "project-9", resource_label: "Atlas rollout",
    actor_id: "u5", actor_label: "Uma User", actor_role: "VIEWER",
    impersonated: true, impersonator_label: "Ada Administrator", correlation_id: "def456",
    message: "delete refused", changed_field_count: 0,
  },
];

export const auditEntry = {
  ...auditRows[0]!,
  ip_address: "10.4.2.19",
  user_agent: "Mozilla/5.0",
  organization_id: "org-1",
  metadata: { source: "ui" },
  state_before: { status: "OPEN", assignee: "Ana Pop", note: null },
  state_after: { status: "CLOSED", assignee: null, note: "resolved on call" },
  changed_fields: ["assignee", "note", "status"],
  changes: [
    { field: "assignee", from: "Ana Pop", to: null, kind: "cleared" },
    { field: "note", from: null, to: "resolved on call", kind: "added" },
    { field: "status", from: "OPEN", to: "CLOSED", kind: "changed" },
  ],
};

export function auditPage(items = auditRows) {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 25,
    pages: 1,
    sort: "occurred_at",
    order: "desc",
    fields: auditCatalogue.fields,
    facets: {
      action: [{ value: "UPDATE", count: 1 }, { value: "DELETE", count: 1 }],
      resource_type: [{ value: "ticket", count: 1 }, { value: "project", count: 1 }],
    },
    columns: auditCatalogue.default_columns,
  };
}


export const recordDetail = {
  id: "task-1",
  resource_type: "task",
  resource_label: "Tasks",
  path: "/tasks",
  title: "Review customer migration",
  subtitle: "TSK-001",
  status: "IN_PROGRESS",
  title_field: "title",
  status_field: "status",
  fields: [
    { name: "reference", label: "Reference", kind: "text", value: "TSK-001" },
    { name: "title", label: "Title", kind: "text", value: "Review customer migration" },
    { name: "status", label: "Status", kind: "enum", value: "IN_PROGRESS" },
    { name: "progress", label: "Progress", kind: "number", value: 45 },
    { name: "due_date", label: "Due date", kind: "datetime", value: "2026-09-10T12:00:00Z" },
    { name: "description", label: "Description", kind: "text", value: null },
    { name: "assignee_id", label: "Assignee ID", kind: "uuid", value: "11111111-2222-3333-4444-555555555555" },
    { name: "created_at", label: "Created", kind: "datetime", value: "2026-08-01T09:00:00Z" },
    { name: "updated_at", label: "Updated", kind: "datetime", value: "2026-09-03T09:00:00Z" },
  ],
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-09-03T09:00:00Z",
};


export const connectionMap = {
  nodes: [
    { key: "ticket", table: "tickets", label: "Tickets", count: 600, explorable: true },
    { key: "customer", table: "customers", label: "Customers", count: 300, explorable: true },
    { key: "order", table: "orders", label: "Orders", count: 800, explorable: true },
    { key: "users", table: "users", label: "Users", count: 150, explorable: false },
  ],
  edges: [
    {
      relation: "customer_id", label: "Customer",
      source: "order", source_label: "Orders",
      target: "customer", target_label: "Customers",
      count: 780, coverage: 97.5, source_total: 800,
    },
    {
      relation: "customer_id", label: "Customer",
      source: "ticket", source_label: "Tickets",
      target: "customer", target_label: "Customers",
      count: 310, coverage: 51.7, source_total: 600,
    },
  ],
  hubs: [
    {
      id: "customer-1", label: "Northwind Partners", summary: "ENTERPRISE",
      entity: "customer", explorable: true, updated_at: null,
      resource_type: "customer", connections: 42,
      via: "Customer", via_label: "Orders · as customer",
    },
  ],
  totals: { records: 1850, entities: 4, relations: 2, links: 1090 },
};


export const roleMatrix = {
  items: [
    {
      id: "role-admin", code: "ADMINISTRATOR", name: "Administrator",
      description: "Unrestricted access.", rank: 100, color: "#dc2626",
      is_system: true, is_default: false,
      permissions: ["admin.access", "roles.manage", "records.view", "audit.view"],
      permission_labels: ["Administration area", "Manage roles", "View records", "View audit logs"],
      user_count: 3,
      default_permissions: ["admin.access", "roles.manage", "records.view", "audit.view"],
      customised: false, is_yours: true,
    },
    {
      id: "role-viewer", code: "VIEWER", name: "Viewer",
      description: "Read-only.", rank: 20, color: "#64748b",
      is_system: true, is_default: true,
      permissions: ["records.view"],
      permission_labels: ["View records"],
      user_count: 42,
      default_permissions: ["records.view", "reports.view"],
      customised: true, is_yours: false,
    },
  ],
  total: 2,
  permissions: {
    groups: [
      {
        name: "Records",
        permissions: [
          { code: "records.view", label: "View records" },
          { code: "audit.view", label: "View audit logs" },
        ],
      },
      {
        name: "Administration",
        permissions: [
          { code: "admin.access", label: "Administration area" },
          { code: "roles.manage", label: "Manage roles" },
        ],
      },
    ],
    total: 4,
  },
  your_role: "ADMINISTRATOR",
};

export const handlers = [
  http.get("/platform/meta/app", ({ request }) => echo(request, appMeta)),
  http.get("/platform/api/search/global", ({ request }) =>
    echo(request, { ...globalResults, query: new URL(request.url).searchParams.get("q") ?? "" }),
  ),
  http.get("/platform/api/me", ({ request }) => echo(request, currentUser)),
  http.put("/platform/api/me", async ({ request }) => {
    const body = (await request.json()) as { preferences: Record<string, unknown> };
    return echo(request, { preferences: { ...currentUser.preferences, ...body.preferences } });
  }),
  http.get("/platform/health/status", ({ request }) => echo(request, healthSnapshot)),
  http.get("/platform/dashboard/summary", ({ request }) => echo(request, dashboardSummary)),
  http.get("/platform/api/explorer/catalog", ({ request }) => echo(request, explorerCatalogue)),
  http.post("/platform/api/explorer/query", ({ request }) => echo(request, explorerResult)),
  http.get("/platform/api/saved-searches", ({ request }) => echo(request, { items: [], total: 0 })),

  http.get("/platform/notifications/counts", ({ request }) => echo(request, notificationCounts)),
  http.get("/platform/notifications", ({ request }) => {
    // The handler honours the filters the page sends, so a test that asserts
    // "unread only shows two rows" is asserting the request the page made
    // rather than a fixture that happens to be short.
    const query = new URL(request.url).searchParams;
    const read = query.get("read") ?? "all";
    const grouped = query.get("group") === "true";
    const category = query.get("category")?.split(",").filter(Boolean) ?? [];

    let items = notificationRows.filter((row) => {
      if (read === "unread" && row.is_read) return false;
      if (read === "read" && !row.is_read) return false;
      if (category.length && !category.includes(row.category)) return false;
      return true;
    });

    if (grouped) {
      items = items.map((row) => ({ ...row, group_count: 4, group_unread: 2 }));
    }
    return echo(request, notificationPage(items, { grouped }));
  }),
  http.put("/platform/notifications/:id", async ({ request, params }) => {
    const body = (await request.json()) as { is_read?: boolean };
    const row = notificationRows.find((item) => item.id === params["id"]) ?? notificationRows[0]!;
    return echo(request, { ...row, is_read: body.is_read !== false });
  }),
  http.delete("/platform/notifications/:id", ({ request, params }) =>
    echo(request, { deleted: String(params["id"]) }),
  ),
  http.post("/platform/notifications/read-all", ({ request }) =>
    echo(request, { marked: 2, read_at: "2026-09-03T12:00:00Z" }),
  ),

  http.get("/platform/admin/roles", ({ request }) => echo(request, roleMatrix)),
  http.put("/platform/admin/roles/:code", async ({ request, params }) => {
    const body = (await request.json()) as { permissions?: string[] };
    const role =
      roleMatrix.items.find((item) => item.code === params["code"]) ?? roleMatrix.items[0]!;
    return echo(request, { ...role, permissions: body.permissions ?? role.permissions });
  }),
  http.get("/platform/api/relationships/overview", ({ request }) => echo(request, connectionMap)),
  http.get("/platform/api/records/:type/:id", ({ request }) => echo(request, recordDetail)),
  http.get("/platform/admin/audit/catalog", ({ request }) => echo(request, auditCatalogue)),
  // Before the `:id` rule: MSW matches path segments loosely, so `:id`
  // would swallow "export". Flask's typed <uuid:> converter would not.
  http.get("/platform/admin/audit/export", ({ request }) =>
    HttpResponse.text("\ufeffWhen,Actor\n2026-09-03T11:00:00Z,Mara Manager\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="audit-log-2026-09-03-1200.csv"',
        [CORRELATION_HEADER]: request.headers.get(CORRELATION_HEADER) ?? "",
      },
    }),
  ),
  http.get("/platform/admin/audit/:id", ({ request }) => echo(request, auditEntry)),
  http.get("/platform/admin/audit", ({ request }) => {
    // Honours the filters the page sends, so a test asserting "one row after
    // filtering" asserts the request rather than a conveniently short fixture.
    const query = new URL(request.url).searchParams;
    const actions = query.get("action")?.split(",").filter(Boolean) ?? [];
    const items = auditRows.filter((row) => !actions.length || actions.includes(row.action));
    return echo(request, auditPage(items));
  }),
  http.post("/platform/api/explorer/export", ({ request }) =>
    HttpResponse.text("\ufeffReference,Title\nTSK-001,Review\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="task-2026-09-03-1200.csv"',
        [CORRELATION_HEADER]: request.headers.get(CORRELATION_HEADER) ?? "",
      },
    }),
  ),
  http.get("/platform/api/audit/timeline", ({ request }) => {
    const query = new URL(request.url).searchParams;
    return echo(request, {
      items: [auditEntry],
      total: 1,
      resource_type: query.get("resource_type") ?? "",
      resource_id: query.get("resource_id") ?? "",
      limit: Number(query.get("limit") ?? 50),
    });
  }),
];
