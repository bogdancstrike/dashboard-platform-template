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

import type { ExplorerCatalogue, ExplorerField, FieldKind } from "@/api/explorer";
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

export const explorerCatalogue: ExplorerCatalogue = {
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
    can_create: true,
    can_edit: true,
    can_delete: true,
    fields: [
      { name: "reference", label: "Reference", kind: "text", sortable: true, filterable: true, searchable: true, facet: false, operators: ["eq", "contains", "starts"], choices: [] },
      { name: "title", label: "Title", kind: "text", sortable: true, filterable: true, searchable: true, facet: false, operators: ["eq", "contains", "not"], choices: [], editable: true, required: true },
      { name: "status", label: "Status", kind: "enum", sortable: true, filterable: true, searchable: false, facet: true, operators: ["eq", "ne", "in", "not_in", "empty", "not_empty"], choices: ["NEW", "IN_PROGRESS", "DONE"], editable: true },
      { name: "priority", label: "Priority", kind: "enum", sortable: true, filterable: true, searchable: false, facet: true, operators: ["eq", "ne", "in", "not_in"], choices: ["NORMAL", "HIGH", "CRITICAL"], editable: true },
      { name: "due_date", label: "Due date", kind: "datetime", sortable: true, filterable: true, searchable: false, facet: false, operators: ["before", "after", "between", "empty"], choices: [] },
      { name: "updated_at", label: "Updated", kind: "datetime", sortable: true, filterable: true, searchable: false, facet: false, operators: ["before", "after"], choices: [] },
    ],
  }],
  view_modes: ["table", "list", "cards", "compact"],
};

/**
 * The other five datasets, in the shape the catalogue publishes them.
 *
 * Written out rather than generated, because the six entity pages each read a
 * *different* subset of fields, and a fixture that invents them from a loop
 * would let a page ask for a column the real catalogue never declares.
 */
function field(
  name: string,
  label: string,
  kind: FieldKind,
  extra: Partial<{ facet: boolean; searchable: boolean; choices: string[]; editable: boolean }> = {},
): ExplorerField {
  return {
    name,
    label,
    kind,
    sortable: true,
    filterable: true,
    searchable: extra.searchable ?? false,
    facet: extra.facet ?? false,
    operators: ["eq", "ne"],
    choices: extra.choices ?? [],
    editable: extra.editable ?? false,
  };
}

explorerCatalogue.items.push(
  {
    key: "project", label: "Projects", description: "Portfolio delivery, budget and health.",
    permission: "records.view", record_count: 50,
    default_columns: ["code", "name", "status", "health", "progress", "due_date"],
    default_sort: "start_date", path: "/projects",
    title_field: "name", subtitle_field: "code", status_field: "status",
    can_create: true, can_edit: true, can_delete: true,
    fields: [
      field("code", "Code", "text", { searchable: true }),
      field("name", "Name", "text", { searchable: true }),
      field("status", "Status", "enum", { facet: true, choices: ["ACTIVE", "COMPLETED"] }),
      field("phase", "Phase", "enum", { facet: true, choices: ["BUILD", "DISCOVERY"] }),
      field("health", "Health", "enum", { facet: true, choices: ["ON_TRACK", "AT_RISK", "OFF_TRACK"] }),
      field("priority", "Priority", "enum", { facet: true, choices: ["HIGH", "NORMAL"] }),
      field("start_date", "Start date", "datetime"),
      field("due_date", "Due date", "datetime"),
      field("completed_at", "Completed", "datetime"),
      field("budget", "Budget", "number"),
      field("spent", "Spent", "number"),
      field("currency", "Currency", "enum", { facet: true, choices: ["EUR", "USD"] }),
      field("progress", "Progress", "number"),
      field("owner_id", "Owner ID", "uuid"),
      field("customer_id", "Customer ID", "uuid"),
    ],
  },
  {
    key: "customer", label: "Customers", description: "Accounts, lifecycle and value.",
    permission: "records.view", record_count: 300,
    default_columns: ["code", "name", "status", "segment", "lifetime_value"],
    default_sort: "updated_at", path: "/customers",
    title_field: "name", subtitle_field: "code", status_field: "status",
    can_create: true, can_edit: true, can_delete: true,
    fields: [
      field("code", "Code", "text", { searchable: true }),
      field("name", "Name", "text", { searchable: true }),
      field("email", "Email", "text", { searchable: true }),
      field("status", "Status", "enum", { facet: true, choices: ["ACTIVE", "CHURNED"] }),
      field("segment", "Segment", "enum", { facet: true, choices: ["ENTERPRISE", "SMB"] }),
      field("industry", "Industry", "text", { facet: true }),
      field("lifecycle_stage", "Lifecycle stage", "enum", { facet: true, choices: ["CUSTOMER", "LEAD"] }),
      field("country", "Country", "text", { facet: true }),
      field("city", "City", "text", { searchable: true }),
      field("lifetime_value", "Lifetime value", "number"),
      field("satisfaction", "Satisfaction", "number"),
      field("last_contact_at", "Last contact", "datetime"),
    ],
  },
  {
    key: "order", label: "Orders", description: "Commercial transactions and payment state.",
    permission: "records.view", record_count: 800,
    default_columns: ["reference", "status", "total", "placed_at"],
    default_sort: "placed_at", path: "/orders",
    title_field: "reference", subtitle_field: "", status_field: "status",
    can_create: true, can_edit: true, can_delete: true,
    fields: [
      field("reference", "Reference", "text", { searchable: true }),
      field("status", "Status", "enum", { facet: true, choices: ["CONFIRMED", "CANCELLED"] }),
      field("payment_status", "Payment status", "enum", { facet: true, choices: ["PAID", "UNPAID"] }),
      field("fulfilment_status", "Fulfilment status", "enum", { facet: true, choices: ["SHIPPED", "PENDING"] }),
      field("channel", "Channel", "enum", { facet: true, choices: ["PORTAL", "DIRECT"] }),
      field("total", "Total", "number"),
      field("currency", "Currency", "enum", { facet: true, choices: ["EUR"] }),
      field("item_count", "Items", "number"),
      field("placed_at", "Placed", "datetime"),
    ],
  },
  {
    key: "ticket", label: "Tickets", description: "Support demand, SLA health and ownership.",
    permission: "records.view", record_count: 600,
    default_columns: ["reference", "subject", "status", "severity"],
    default_sort: "updated_at", path: "/tickets",
    title_field: "subject", subtitle_field: "reference", status_field: "status",
    can_create: true, can_edit: true, can_delete: true,
    fields: [
      field("reference", "Reference", "text", { searchable: true }),
      field("subject", "Subject", "text", { searchable: true }),
      field("description", "Description", "text", { searchable: true }),
      field("status", "Status", "enum", { facet: true, choices: ["OPEN", "RESOLVED"] }),
      field("priority", "Priority", "enum", { facet: true, choices: ["HIGH", "NORMAL"] }),
      field("severity", "Severity", "enum", { facet: true, choices: ["CRITICAL", "MAJOR", "MINOR"] }),
      field("category", "Category", "enum", { facet: true, choices: ["BILLING", "TECHNICAL"] }),
      field("channel", "Channel", "enum", { facet: true, choices: ["EMAIL", "PORTAL"] }),
      field("due_at", "Due", "datetime"),
      field("sla_breached", "SLA breached", "bool", { facet: true }),
      field("resolution_minutes", "Resolution minutes", "number"),
      field("first_response_at", "First response", "datetime"),
      field("resolved_at", "Resolved", "datetime"),
      field("reopen_count", "Reopens", "number"),
      field("satisfaction", "Satisfaction", "number"),
      field("assignee_id", "Assignee ID", "uuid"),
      field("customer_id", "Customer ID", "uuid"),
      field("project_id", "Project ID", "uuid"),
      field("created_at", "Created", "datetime"),
    ],
  },
  {
    key: "device", label: "Devices", description: "Managed hardware and telemetry.",
    permission: "records.view", record_count: 250,
    default_columns: ["serial", "name", "status", "last_seen_at"],
    default_sort: "last_seen_at", path: "/devices",
    title_field: "name", subtitle_field: "serial", status_field: "status",
    can_create: true, can_edit: true, can_delete: true,
    fields: [
      field("serial", "Serial", "text", { searchable: true }),
      field("name", "Name", "text", { searchable: true }),
      field("kind", "Kind", "enum", { facet: true, choices: ["GATEWAY", "SENSOR"] }),
      field("model", "Model", "text", { searchable: true }),
      field("manufacturer", "Manufacturer", "text", { facet: true }),
      field("status", "Status", "enum", { facet: true, choices: ["ONLINE", "OFFLINE", "DEGRADED"] }),
      field("location", "Location", "text", { facet: true }),
      field("last_seen_at", "Last seen", "datetime"),
      field("battery_percent", "Battery", "number"),
      field("signal_strength", "Signal", "number"),
      field("uptime_hours", "Uptime", "number"),
      field("error_count", "Errors", "number"),
    ],
  },
);

/** One row per dataset, enough to prove the page drew the right thing. */
export const entityRows: Record<string, Record<string, unknown>[]> = {
  task: [
    { id: "task-1", reference: "TSK-001", title: "Review customer migration", status: "IN_PROGRESS", priority: "HIGH", kind: "FEATURE", due_date: "2026-09-10T12:00:00Z", progress: 45, estimate_hours: 8, logged_hours: 3, updated_at: "2026-09-03T09:00:00Z" },
  ],
  project: [
    { id: "project-1", code: "PRJ-0001", name: "Billing replatform", status: "ACTIVE", phase: "BUILD", health: "AT_RISK", priority: "HIGH", start_date: "2026-01-05T00:00:00Z", due_date: "2026-11-30T00:00:00Z", budget: 400000, spent: 380000, progress: 62 },
    { id: "project-2", code: "PRJ-0002", name: "Warehouse rollout", status: "ACTIVE", phase: "DISCOVERY", health: "ON_TRACK", priority: "NORMAL", start_date: "2026-03-01T00:00:00Z", due_date: "2026-08-01T00:00:00Z", budget: 120000, spent: 30000, progress: 20 },
  ],
  customer: [
    { id: "customer-1", code: "CUS-0001", name: "Northwind Partners", email: "ops@northwind.example", status: "ACTIVE", segment: "ENTERPRISE", industry: "Logistics", lifecycle_stage: "CUSTOMER", country: "DE", city: "Berlin", lifetime_value: 480000, satisfaction: 8.2, last_contact_at: "2026-09-01T10:00:00Z" },
  ],
  order: [
    { id: "order-1", reference: "ORD-00311", status: "CONFIRMED", payment_status: "UNPAID", fulfilment_status: "PENDING", channel: "PORTAL", total: 18400, currency: "EUR", item_count: 6, placed_at: "2026-09-02T16:05:00Z" },
  ],
  ticket: [
    { id: "ticket-1", reference: "TIC-00042", subject: "Login fails after password reset", description: "Customer cannot sign in.", status: "OPEN", priority: "HIGH", severity: "CRITICAL", category: "TECHNICAL", channel: "EMAIL", due_at: "2026-09-04T09:00:00Z", sla_breached: true, resolution_minutes: 0, created_at: "2026-09-03T08:00:00Z" },
    { id: "ticket-2", reference: "TIC-00043", subject: "Invoice shows the wrong VAT", description: "Billing question.", status: "OPEN", priority: "NORMAL", severity: "MINOR", category: "BILLING", channel: "PORTAL", due_at: "2026-09-09T09:00:00Z", sla_breached: false, resolution_minutes: 0, created_at: "2026-09-02T08:00:00Z" },
  ],
  device: [
    { id: "device-1", serial: "SN-000123", name: "Gateway Berlin 04", kind: "GATEWAY", model: "GW-8", manufacturer: "Acme", status: "DEGRADED", location: "Berlin DC", last_seen_at: "2026-09-03T11:00:00Z", battery_percent: 18, signal_strength: 71, uptime_hours: 900, error_count: 4 },
  ],
};

/** Facets keyed by dataset, so a page's filter menu has something to offer. */
const entityFacets: Record<string, Record<string, { value: string; count: number }[]>> = {
  task: {
    status: [{ value: "IN_PROGRESS", count: 1 }, { value: "NEW", count: 4 }, { value: "DONE", count: 9 }],
    priority: [{ value: "HIGH", count: 1 }],
  },
  project: {
    health: [{ value: "AT_RISK", count: 1 }, { value: "ON_TRACK", count: 1 }],
    phase: [{ value: "BUILD", count: 1 }],
    status: [{ value: "ACTIVE", count: 2 }],
    priority: [{ value: "HIGH", count: 1 }],
  },
  customer: {
    segment: [{ value: "ENTERPRISE", count: 1 }],
    lifecycle_stage: [{ value: "CUSTOMER", count: 1 }],
    industry: [{ value: "Logistics", count: 1 }],
    country: [{ value: "DE", count: 1 }],
  },
  order: {
    status: [{ value: "CONFIRMED", count: 1 }],
    payment_status: [{ value: "UNPAID", count: 1 }],
    fulfilment_status: [{ value: "PENDING", count: 1 }],
    channel: [{ value: "PORTAL", count: 1 }],
    currency: [{ value: "EUR", count: 1 }],
  },
  ticket: {
    severity: [{ value: "CRITICAL", count: 1 }, { value: "MINOR", count: 1 }],
    status: [{ value: "OPEN", count: 2 }],
    category: [{ value: "TECHNICAL", count: 1 }],
  },
  device: {
    status: [{ value: "DEGRADED", count: 1 }, { value: "ONLINE", count: 8 }],
    kind: [{ value: "GATEWAY", count: 1 }],
    manufacturer: [{ value: "Acme", count: 1 }],
    location: [{ value: "Berlin DC", count: 1 }],
  },
};

/** The query response for any dataset, honouring the status filter a board sends. */
export function entityResult(body: {
  resource_type?: string;
  filters?: Record<string, unknown>;
  columns?: string[];
}) {
  const key = String(body.resource_type ?? "task");
  const resource = explorerCatalogue.items.find((item) => item.key === key);
  const status = body.filters?.["status"];
  const items = (entityRows[key] ?? []).filter(
    (row) => !status || row["status"] === status,
  );
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 25,
    pages: 1,
    sort: resource?.default_sort ?? "updated_at",
    order: "desc",
    resource_type: key,
    columns: body.columns ?? resource?.default_columns ?? [],
    fields: resource?.fields ?? [],
    facets: entityFacets[key] ?? {},
    condition_text: "",
    rule_count: 0,
    query_text: "",
    searchable: [],
  };
}

/** The declared metrics, breakdowns and trend for any dataset. */
export function entityInsights(resourceType = "task") {
  const facets = entityFacets[resourceType] ?? {};
  return {
    resource_type: resourceType,
    total: (entityRows[resourceType] ?? []).length,
    metrics: [
      { key: "total", label: "Records", value: 42, format: "number", hint: "", filter: {} },
      { key: "revenue", label: "Revenue", value: 1250000, format: "currency", hint: "", filter: {} },
      { key: "share", label: "Breached", value: 12.5, format: "percent", hint: "", filter: {} },
      { key: "open", label: "Open", value: 7, format: "number", hint: "", filter: { status: ["OPEN"] } },
    ],
    breakdowns: Object.entries(facets).map(([name, values]) => ({
      field: name,
      label: name,
      series: values.map((facet) => ({ name: facet.value, value: facet.count })),
      distinct: values.length,
    })),
    trend: {
      field: "created_at",
      label: "Created",
      measure: "count",
      series: [
        { name: "2026-09-01", value: 3 },
        { name: "2026-09-02", value: 5 },
        { name: "2026-09-03", value: 4 },
      ],
    },
  };
}

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
  by_severity: { INFO: 1, CRITICAL: 1 },
  recent: 2,
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


/** The colleagues a picker can offer, as the directory publishes them. */
export const people = [
  {
    id: "11111111-2222-3333-4444-555555555555",
    name: "Ada Administrator",
    email: "admin@nucleus.example",
    username: "admin",
    job_title: "Platform lead",
    avatar_url: null,
    initials: "AA",
    is_me: true,
  },
  {
    id: "22222222-3333-4444-5555-666666666666",
    name: "Otto Operator",
    email: "operator@nucleus.example",
    username: "operator",
    job_title: "Support engineer",
    avatar_url: null,
    initials: "OO",
    is_me: false,
  },
];

/**
 * The map's catalogue and one answer, in the shape `services/maps.py`
 * publishes them (§44, §61).
 *
 * Two datasets, because the interesting difference between them is how they
 * reach a place: a customer carries its own city and an order borrows its
 * customer's — which is what decides where a click on the map leads.
 */
export const mapCatalogue = {
  datasets: [
    {
      key: "customer",
      label: "Customers",
      path: "/customers",
      placed_by: "own city",
      metrics: [
        { key: "count", label: "Accounts", field: "" },
        { key: "value", label: "Lifetime value", field: "lifetime_value" },
      ],
    },
    {
      key: "order",
      label: "Orders",
      path: "/orders",
      placed_by: "the customer's city",
      metrics: [
        { key: "count", label: "Orders", field: "" },
        { key: "revenue", label: "Revenue", field: "total" },
      ],
    },
  ],
  places: [
    { city: "Berlin", country: "Germany", map_name: "Germany", region: "WEU", region_name: "Western Europe", latitude: 52.52, longitude: 13.4 },
    { city: "Paris", country: "France", map_name: "France", region: "WEU", region_name: "Western Europe", latitude: 48.86, longitude: 2.35 },
    { city: "New York", country: "United States", map_name: "United States of America", region: "NAM", region_name: "North America", latitude: 40.71, longitude: -74.01 },
  ],
};

/** One answer, with rows the gazetteer could not place — which is the point. */
export function mapPlaces(dataset = "customer") {
  const entry = mapCatalogue.datasets.find((item) => item.key === dataset) ?? mapCatalogue.datasets[0]!;
  const points = [
    { city: "Berlin", country: "Germany", map_name: "Germany", region: "WEU", region_name: "Western Europe", latitude: 52.52, longitude: 13.4, rows: 12, value: 480000 },
    { city: "Paris", country: "France", map_name: "France", region: "WEU", region_name: "Western Europe", latitude: 48.86, longitude: 2.35, rows: 7, value: 260000 },
    { city: "New York", country: "United States", map_name: "United States of America", region: "NAM", region_name: "North America", latitude: 40.71, longitude: -74.01, rows: 5, value: 310000 },
  ];
  return {
    dataset: entry.key,
    dataset_label: entry.label,
    path: entry.path,
    metric: entry.metrics[1]!,
    period: { key: "all_time", from: null, to: null },
    points,
    countries: [
      { name: "Germany", rows: 12, value: 480000, cities: 1 },
      { name: "United States of America", rows: 5, value: 310000, cities: 1 },
      { name: "France", rows: 7, value: 260000, cities: 1 },
    ],
    regions: [
      { name: "Western Europe", rows: 19, value: 740000, cities: 2 },
      { name: "North America", rows: 5, value: 310000, cities: 1 },
    ],
    total: 27,
    measured: 1050000,
    // Three rows name somewhere the gazetteer does not know. A map that drew
    // 24 dots and said nothing would answer a different question.
    unplaced: { rows: 3, value: 90000 },
  };
}

/**
 * Dashboards and their widgets, in the shape `services/dashboards.py`
 * publishes them (§45, §67).
 *
 * Mutable, because the interesting assertions are about *writing* a layout:
 * adding a widget, dragging one, marking a dashboard home. A fixture that
 * answered the same rows whatever was sent would let a broken save pass.
 */
export const savedDashboards: Record<string, unknown>[] = [];

const DASHBOARD_KINDS = [
  "ACTIVITY", "ALERTS", "AREA_CHART", "BAR_CHART", "GAUGE", "HEATMAP",
  "KPI", "LINE_CHART", "LIST", "PIE_CHART", "TABLE",
];

function seedDashboards(): void {
  savedDashboards.length = 0;
  savedDashboards.push(
    {
      id: "dash-1",
      name: "Support desk",
      slug: "support-desk",
      description: "What the desk is carrying today.",
      scope: "PRIVATE",
      icon: null,
      is_home: true,
      is_default: true,
      columns: 12,
      filters: { period: "last_30_days" },
      owner: { id: "user-1", name: "Ada Administrator", email: "admin@nucleus.example" },
      can_edit: true,
      members: [],
      widget_count: 2,
      created_at: "2026-08-01T09:00:00Z",
      updated_at: "2026-09-04T09:00:00Z",
      widgets: [
        {
          id: "widget-1",
          kind: "KPI",
          title: "Open tickets",
          subtitle: null,
          x: 0, y: 0, width: 3, height: 1, position: 0,
          config: { entity: "ticket", metric: "open" },
        },
        {
          id: "widget-2",
          kind: "BAR_CHART",
          title: "Tickets by severity",
          subtitle: "Last 30 days",
          x: 3, y: 0, width: 6, height: 2, position: 1,
          config: { entity: "ticket", dimension: "severity" },
        },
      ],
    },
    {
      id: "dash-2",
      name: "Delivery health",
      slug: "delivery-health",
      description: null,
      scope: "PUBLIC",
      icon: null,
      is_home: false,
      is_default: false,
      columns: 12,
      filters: {},
      owner: { id: "user-2", name: "Mara Manager", email: "manager@nucleus.example" },
      // Somebody else's: readable, and the controls say so rather than hiding.
      can_edit: false,
      members: [],
      widget_count: 0,
      created_at: "2026-08-11T09:00:00Z",
      updated_at: "2026-09-01T09:00:00Z",
      widgets: [],
    },
  );
}

seedDashboards();

export function resetDashboards(): void {
  seedDashboards();
}

function dashboardById(id: string): Record<string, unknown> {
  return savedDashboards.find((item) => item["id"] === id) ?? savedDashboards[0]!;
}

export const recordDetail = {
  content_fields: ["description"],
  metadata: { source: "Customer portal", tags: ["migration", "enterprise"] },
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
    { name: "title", label: "Title", kind: "text", value: "Review customer migration", editable: true, required: true },
    { name: "status", label: "Status", kind: "enum", value: "IN_PROGRESS", editable: true },
    { name: "progress", label: "Progress", kind: "number", value: 45, editable: true, minimum: 0, maximum: 100 },
    { name: "due_date", label: "Due date", kind: "datetime", value: "2026-09-10T12:00:00Z" },
    { name: "description", label: "Description", kind: "text", value: null, editable: true },
    { name: "kind", label: "Kind", kind: "enum", value: "FEATURE", editable: true },
    { name: "priority", label: "Priority", kind: "enum", value: "HIGH", editable: true },
    { name: "checklist", label: "Checklist", kind: "json", editable: true, value: [
      { text: "Export the old rows", done: true },
      { text: "Load them", done: false },
    ] },
    { name: "assignee_id", label: "Assignee ID", kind: "uuid", value: "11111111-2222-3333-4444-555555555555" },
    { name: "created_at", label: "Created", kind: "datetime", value: "2026-08-01T09:00:00Z" },
    { name: "updated_at", label: "Updated", kind: "datetime", value: "2026-09-03T09:00:00Z" },
  ],
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-09-03T09:00:00Z",
  can_edit: true,
  can_delete: true,
};


/**
 * The two records whose detail pages have a shape of their own (§8).
 *
 * Written out rather than derived from `entityRows`, because a list row
 * carries the columns that page drew and a detail carries every declared
 * field — which is the whole reason the detail is fetched separately. The
 * numbers are chosen so the interesting answer does not depend on the clock:
 * the project has spent 95% of its budget to deliver 62%, and the ticket is
 * marked breached, so both pages say the same thing on any day.
 */
export const projectRecord = {
  id: "project-1",
  resource_type: "project",
  resource_label: "Projects",
  path: "/projects",
  title: "Billing replatform",
  subtitle: "PRJ-0001",
  status: "ACTIVE",
  title_field: "name",
  status_field: "status",
  content_fields: ["description"],
  metadata: {},
  fields: [
    { name: "code", label: "Code", kind: "text", value: "PRJ-0001" },
    { name: "name", label: "Name", kind: "text", value: "Billing replatform", editable: true, required: true },
    { name: "description", label: "Description", kind: "text", value: "Replace the billing engine.", editable: true },
    { name: "status", label: "Status", kind: "enum", value: "ACTIVE", editable: true },
    { name: "phase", label: "Phase", kind: "enum", value: "BUILD", editable: true },
    { name: "health", label: "Health", kind: "enum", value: "AT_RISK", editable: true },
    { name: "priority", label: "Priority", kind: "enum", value: "HIGH", editable: true },
    { name: "start_date", label: "Start date", kind: "datetime", value: "2026-01-05T00:00:00Z" },
    { name: "due_date", label: "Due date", kind: "datetime", value: "2026-11-30T00:00:00Z" },
    { name: "completed_at", label: "Completed", kind: "datetime", value: null },
    { name: "budget", label: "Budget", kind: "number", value: 400000, editable: true },
    { name: "spent", label: "Spent", kind: "number", value: 380000, editable: true },
    { name: "currency", label: "Currency", kind: "enum", value: "EUR", editable: true },
    { name: "progress", label: "Progress", kind: "number", value: 62, editable: true, minimum: 0, maximum: 100 },
    { name: "owner_id", label: "Owner ID", kind: "uuid", value: "11111111-2222-3333-4444-555555555555", editable: true, references: "user" },
    { name: "customer_id", label: "Customer ID", kind: "uuid", value: "customer-1", editable: true, references: "customer" },
    { name: "created_at", label: "Created", kind: "datetime", value: "2026-01-02T09:00:00Z" },
    { name: "updated_at", label: "Updated", kind: "datetime", value: "2026-09-03T09:00:00Z" },
  ],
  created_at: "2026-01-02T09:00:00Z",
  updated_at: "2026-09-03T09:00:00Z",
  can_edit: true,
  can_delete: true,
};

export const ticketRecord = {
  id: "ticket-1",
  resource_type: "ticket",
  resource_label: "Tickets",
  path: "/tickets",
  title: "Login fails after password reset",
  subtitle: "TIC-00042",
  status: "OPEN",
  title_field: "subject",
  status_field: "status",
  content_fields: ["description"],
  metadata: {},
  fields: [
    { name: "reference", label: "Reference", kind: "text", value: "TIC-00042" },
    { name: "subject", label: "Subject", kind: "text", value: "Login fails after password reset", editable: true, required: true },
    { name: "description", label: "Description", kind: "text", value: "Customer cannot sign in after resetting.", editable: true },
    { name: "status", label: "Status", kind: "enum", value: "OPEN", editable: true },
    { name: "priority", label: "Priority", kind: "enum", value: "HIGH", editable: true },
    { name: "severity", label: "Severity", kind: "enum", value: "CRITICAL", editable: true },
    { name: "category", label: "Category", kind: "enum", value: "TECHNICAL", editable: true },
    { name: "channel", label: "Channel", kind: "enum", value: "EMAIL", editable: true },
    { name: "due_at", label: "Due", kind: "datetime", value: "2026-09-04T09:00:00Z", editable: true },
    { name: "sla_breached", label: "SLA breached", kind: "bool", value: true, editable: true },
    { name: "resolution_minutes", label: "Resolution minutes", kind: "number", value: null },
    { name: "first_response_at", label: "First response", kind: "datetime", value: "2026-09-03T08:45:00Z" },
    { name: "resolved_at", label: "Resolved", kind: "datetime", value: null },
    { name: "reopen_count", label: "Reopens", kind: "number", value: 2 },
    { name: "satisfaction", label: "Satisfaction", kind: "number", value: null },
    { name: "assignee_id", label: "Assignee ID", kind: "uuid", value: "11111111-2222-3333-4444-555555555555", editable: true, references: "user" },
    { name: "customer_id", label: "Customer ID", kind: "uuid", value: "customer-1", editable: true, references: "customer" },
    { name: "project_id", label: "Project ID", kind: "uuid", value: null, editable: true, references: "project" },
    { name: "created_at", label: "Created", kind: "datetime", value: "2026-09-03T08:00:00Z" },
    { name: "updated_at", label: "Updated", kind: "datetime", value: "2026-09-03T09:00:00Z" },
  ],
  created_at: "2026-09-03T08:00:00Z",
  updated_at: "2026-09-03T09:00:00Z",
  can_edit: true,
  can_delete: true,
};

export const customerRecord = {
  ...projectRecord,
  id: "customer-1",
  resource_type: "customer",
  resource_label: "Customers",
  path: "/customers",
  title: "Northwind Partners",
  subtitle: "CUS-0001",
  status: "ACTIVE",
  fields: [
    { name: "code", label: "Code", kind: "text", value: "CUS-0001" },
    { name: "name", label: "Name", kind: "text", value: "Northwind Partners", editable: true },
    { name: "status", label: "Status", kind: "enum", value: "ACTIVE", editable: true },
    { name: "segment", label: "Segment", kind: "enum", value: "ENTERPRISE", editable: true },
  ],
};

/** Every record fixture, by the type the route asks for. */
export const recordsByType: Record<string, unknown> = {
  task: recordDetail,
  project: projectRecord,
  ticket: ticketRecord,
  customer: customerRecord,
};


/**
 * The analysis catalogue and one result, in the shape `services/analysis.py`
 * publishes them (§2, §28, §44).
 *
 * Written from the same declarations the explorer fixture uses, so a test
 * cannot group by a column the real catalogue would never offer.
 */
export const analysisCatalogue = {
  datasets: [
    {
      key: "order",
      label: "Orders",
      description: "Commercial transactions and payment state.",
      path: "/orders",
      dimensions: [
        { name: "status", label: "Status", kind: "enum", choices: ["CONFIRMED", "PENDING"] },
        { name: "channel", label: "Channel", kind: "enum", choices: ["PORTAL", "DIRECT"] },
        { name: "placed_at", label: "Placed at", kind: "datetime", choices: [] },
      ],
      measures: [{ name: "total", label: "Total" }, { name: "item_count", label: "Items" }],
      dates: [{ name: "placed_at", label: "Placed at" }],
      default_date: "placed_at",
    },
    {
      key: "ticket",
      label: "Tickets",
      description: "Support demand and SLA health.",
      path: "/tickets",
      dimensions: [
        { name: "severity", label: "Severity", kind: "enum", choices: ["CRITICAL", "MINOR"] },
        { name: "status", label: "Status", kind: "enum", choices: ["OPEN", "RESOLVED"] },
      ],
      measures: [{ name: "resolution_minutes", label: "Resolution minutes" }],
      dates: [{ name: "created_at", label: "Created" }],
      default_date: "created_at",
    },
  ],
  aggregations: [
    { key: "count", label: "Count", format: "number" },
    { key: "sum", label: "Sum", format: "number" },
    { key: "avg", label: "Avg", format: "number" },
  ],
  granularities: ["day", "week", "month", "quarter", "year"],
  periods: [
    { key: "last_30_days", label: "Last 30 days", days: 30 },
    { key: "last_90_days", label: "Last 90 days", days: 90 },
    { key: "last_365_days", label: "Last 365 days", days: 365 },
  ],
};

/** One analysis result, shaped by the request so a test can assert the query. */
export function analysisResult(body: {
  resource_type?: string;
  dimensions?: (string | { field: string; granularity?: string })[];
  measures?: { aggregation: string; field?: string }[];
  period?: string;
}) {
  const dataset =
    analysisCatalogue.datasets.find((item) => item.key === body.resource_type) ??
    analysisCatalogue.datasets[0]!;
  const dimensions = (body.dimensions ?? []).map((entry) =>
    typeof entry === "string" ? { field: entry, granularity: "" } : { field: entry.field, granularity: entry.granularity ?? "" },
  );
  const measures = (body.measures ?? [{ aggregation: "count" }]).map((measure) =>
    measure.aggregation === "count"
      ? { key: "count", label: "record count", aggregation: "count", field: "", format: "number" }
      : {
          key: `${measure.aggregation}:${measure.field ?? ""}`,
          label: `total ${measure.field ?? ""}`,
          aggregation: measure.aggregation,
          field: measure.field ?? "",
          format: "number",
        },
  );
  const keysFor = (index: number) =>
    dimensions[0]?.granularity ? ["2026-08-01", "2026-09-01"][index]! : ["CONFIRMED", "PENDING"][index]!;
  const rows = dimensions.length
    ? [0, 1].map((index) => ({
        keys: [keysFor(index), ...(dimensions.length > 1 ? ["PORTAL"] : [])],
        values: Object.fromEntries(measures.map((m) => [m.key, index === 0 ? 120 : 80])),
      }))
    : [{ keys: [], values: Object.fromEntries(measures.map((m) => [m.key, 200])) }];

  return {
    resource_type: dataset.key,
    resource_label: dataset.label,
    path: dataset.path,
    dimensions: dimensions.map((item) => ({
      field: item.field,
      label: dataset.dimensions.find((d) => d.name === item.field)?.label ?? item.field,
      kind: "enum",
      granularity: item.granularity,
    })),
    measures,
    rows,
    totals: Object.fromEntries(measures.map((m) => [m.key, 200])),
    matched: 200,
    truncated: false,
    other: null,
    period: { key: body.period ?? "all_time", field: dataset.default_date, from: null, to: null },
    description: `record count of ${dataset.label.toLowerCase()}`,
    generated_at: "2026-09-06T12:00:00Z",
  };
}

/**
 * Saved reports, in a store the handlers actually mutate (§28).
 *
 * A fixed array would let a "create then see it in the list" test pass while
 * the page never re-read anything: the list has to change because the write
 * changed it, which is the behaviour worth asserting.
 */
export const savedReports: Record<string, unknown>[] = [
  {
    id: "report-1",
    name: "Revenue by channel",
    description: "Where the money comes from",
    resource_type: "order",
    scope: "PRIVATE",
    owner: { id: "user-1", name: "Ada Administrator", email: "admin@nucleus.example" },
    can_edit: true,
    members: [],
    dimensions: [{ field: "channel", granularity: "" }],
    metrics: [{ aggregation: "sum", field: "total" }],
    filters: {},
    condition_tree: null,
    period: "last_90_days",
    visualization: "bar",
    sort: null,
    order: "desc",
    schedule: null,
    is_favorite: false,
    run_count: 3,
    last_run_at: "2026-09-05T09:00:00Z",
    created_at: "2026-08-01T09:00:00Z",
    updated_at: "2026-09-05T09:00:00Z",
  },
  {
    id: "report-2",
    name: "Tickets by severity",
    description: null,
    resource_type: "ticket",
    scope: "PUBLIC",
    owner: { id: "user-2", name: "Mara Manager", email: "manager@nucleus.example" },
    can_edit: false,
    members: [],
    dimensions: [{ field: "severity", granularity: "" }],
    metrics: [{ aggregation: "count", field: "" }],
    filters: {},
    condition_tree: null,
    period: "all_time",
    visualization: "pie",
    sort: null,
    order: "desc",
    schedule: null,
    is_favorite: false,
    run_count: 0,
    last_run_at: null,
    created_at: "2026-08-02T09:00:00Z",
    updated_at: "2026-08-02T09:00:00Z",
  },
];

const REPORT_SEED = JSON.parse(JSON.stringify(savedReports)) as Record<string, unknown>[];

/** Puts the store back, so one test's write cannot decide another's list. */
export function resetReports(): void {
  savedReports.length = 0;
  savedReports.push(...(JSON.parse(JSON.stringify(REPORT_SEED)) as Record<string, unknown>[]));
}

/**
 * A conversation on the fixture task (§36), in a store the handlers mutate —
 * so "post a comment and see it appear" asserts a round trip rather than a
 * component's own state.
 */
export const recordComments: Record<string, unknown>[] = [
  {
    id: "comment-1",
    resource_type: "task",
    resource_id: "task-1",
    parent_id: null,
    body: "Blocked on the migration script.",
    author: { id: "user-2", name: "Mara Manager", avatar_url: null, job_title: "Delivery lead" },
    mentions: [],
    is_internal: false,
    is_pinned: false,
    edited_at: null,
    created_at: "2026-09-03T10:00:00Z",
    can_edit: false,
  },
  {
    id: "comment-2",
    resource_type: "task",
    resource_id: "task-1",
    parent_id: "comment-1",
    body: "Running it tonight.",
    author: { id: "user-1", name: "Ada Administrator", avatar_url: null, job_title: "Platform" },
    mentions: [],
    is_internal: false,
    is_pinned: false,
    edited_at: null,
    created_at: "2026-09-03T11:00:00Z",
    can_edit: true,
  },
];

const COMMENT_SEED = JSON.parse(JSON.stringify(recordComments)) as Record<string, unknown>[];

/** Puts the conversation back between tests. */
export function resetComments(): void {
  recordComments.length = 0;
  recordComments.push(...(JSON.parse(JSON.stringify(COMMENT_SEED)) as Record<string, unknown>[]));
}

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


/**
 * A small clustered network: two customer clusters joined by one shared
 * account manager. Small enough to assert on, structured enough that a
 * component which ignored the community field would visibly fail.
 */
export const recordNetwork = {
  focus: { key: "customer", label: "Customers" },
  available: [
    { key: "customer", label: "Customers" },
    { key: "project", label: "Projects" },
  ],
  nodes: [
    {
      key: "customer:c1", id: "c1", label: "Northwind Partners", summary: "ENTERPRISE",
      entity: "customer", entity_label: "Customers", explorable: true, status: "ACTIVE",
      anchor: true, community: "customer:c1", degree: 3, updated_at: null,
    },
    {
      key: "order:o1", id: "o1", label: "ORD-00001", summary: "",
      entity: "order", entity_label: "Orders", explorable: true, status: "PAID",
      anchor: false, community: "customer:c1", degree: 1, updated_at: null,
    },
    {
      key: "ticket:t1", id: "t1", label: "TIC-00001", summary: "Login fails",
      entity: "ticket", entity_label: "Tickets", explorable: true, status: "OPEN",
      anchor: false, community: "customer:c1", degree: 1, updated_at: null,
    },
    {
      key: "customer:c2", id: "c2", label: "Stonebridge Group", summary: "MID_MARKET",
      entity: "customer", entity_label: "Customers", explorable: true, status: "ACTIVE",
      anchor: true, community: "customer:c2", degree: 2, updated_at: null,
    },
    {
      key: "order:o2", id: "o2", label: "ORD-00002", summary: "",
      entity: "order", entity_label: "Orders", explorable: true, status: "PAID",
      anchor: false, community: "customer:c2", degree: 1, updated_at: null,
    },
    {
      key: "users:u1", id: "u1", label: "Ana Analyst", summary: "ana@nucleus.example",
      entity: "users", entity_label: "Users", explorable: false, status: "ACTIVE",
      anchor: false, community: "customer:c1", degree: 2, updated_at: null,
    },
  ],
  edges: [
    { source: "order:o1", target: "customer:c1", relation: "customer_id", label: "Customer", bridge: false },
    { source: "ticket:t1", target: "customer:c1", relation: "customer_id", label: "Customer", bridge: false },
    { source: "order:o2", target: "customer:c2", relation: "customer_id", label: "Customer", bridge: false },
    { source: "customer:c1", target: "users:u1", relation: "account_manager_id", label: "Account manager", bridge: false },
    { source: "customer:c2", target: "users:u1", relation: "account_manager_id", label: "Account manager", bridge: true },
  ],
  communities: [
    {
      id: "customer:c1", label: "Northwind Partners", entity: "customer", size: 4,
      mix: [
        { label: "Customers", count: 1 }, { label: "Orders", count: 1 },
        { label: "Tickets", count: 1 }, { label: "Users", count: 1 },
      ],
      members: [
        { key: "customer:c1", id: "c1", label: "Northwind Partners", entity: "customer", entity_label: "Customers", degree: 3, explorable: true },
        { key: "users:u1", id: "u1", label: "Ana Analyst", entity: "users", entity_label: "Users", degree: 2, explorable: false },
      ],
      internal_links: 3, external_links: 1,
    },
    {
      id: "customer:c2", label: "Stonebridge Group", entity: "customer", size: 2,
      mix: [{ label: "Customers", count: 1 }, { label: "Orders", count: 1 }],
      members: [
        { key: "customer:c2", id: "c2", label: "Stonebridge Group", entity: "customer", entity_label: "Customers", degree: 2, explorable: true },
      ],
      internal_links: 1, external_links: 1,
    },
  ],
  stats: { nodes: 6, edges: 5, communities: 2, modularity: 0.42, bridges: 1 },
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


export const userRows = [
  {
    id: "user-1", email: "ada@nucleus.example", username: "admin",
    full_name: "Ada Administrator", initials: "AA", avatar_url: null,
    job_title: "Platform Administrator", status: "ACTIVE",
    role_code: "ADMINISTRATOR", role_name: "Administrator", role_color: "#dc2626",
    mfa_enabled: true, last_login_at: "2026-09-03T08:00:00Z", login_count: 412,
    group_names: [], created_at: "2025-01-01T00:00:00Z", updated_at: "2026-09-03T08:00:00Z",
  },
  {
    id: "user-2", email: "uma@nucleus.example", username: "user",
    full_name: "Uma User", initials: "UU", avatar_url: null,
    job_title: "Support Analyst", status: "ACTIVE",
    role_code: "VIEWER", role_name: "Viewer", role_color: "#64748b",
    mfa_enabled: false, last_login_at: "2026-09-01T10:00:00Z", login_count: 12,
    group_names: ["On-call"], created_at: "2025-06-01T00:00:00Z", updated_at: "2026-09-01T10:00:00Z",
  },
];

export const userDetail = {
  ...userRows[1]!,
  phone: "",
  locale: "en-GB",
  timezone: "Europe/Bucharest",
  profile_completeness: 80,
  organization: { id: "org-1", name: "Northwind Partners" },
  department: { id: "dep-1", name: "Support" },
  manager: { id: "user-1", name: "Ada Administrator" },
  groups: [{ id: "grp-1", name: "On-call", kind: "TEAM", permissions: ["jobs.manage"] }],
  access: {
    role_permissions: ["records.view", "reports.view"],
    group_permissions: { "On-call": ["jobs.manage"] },
    effective: ["jobs.manage", "records.view", "reports.view"],
    effective_labels: ["Manage jobs", "View records", "View reports"],
    from_groups_only: ["jobs.manage"],
  },
  sessions: [
    {
      id: "s1", device: "Chrome on Linux", ip_address: "10.2.0.4", location: "Bucharest",
      last_seen_at: "2026-09-03T09:30:00Z", revoked: false, trusted: true,
    },
  ],
  sign_ins: [
    {
      id: "l1", result: "SUCCESS", reason: "", ip_address: "10.2.0.4",
      location: "Bucharest", device: "Chrome on Linux", method: "PASSWORD",
      at: "2026-09-03T09:30:00Z",
    },
  ],
  can_manage: true,
  can_impersonate: true,
  impersonation_blocked_because: "",
};

export function userPage(items = userRows) {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 25,
    pages: 1,
    sort: "full_name",
    order: "asc",
    fields: [],
    facets: {
      role_code: [
        { value: "ADMINISTRATOR", count: 1 },
        { value: "VIEWER", count: 1 },
      ],
      status: [{ value: "ACTIVE", count: 2 }],
    },
    columns: ["full_name", "email", "role_code", "status", "last_login_at", "mfa_enabled"],
    statuses: ["ACTIVE", "INVITED", "SUSPENDED", "DISABLED"],
    can_manage: true,
    can_impersonate: true,
  };
}

export const handlers = [
  http.get("/platform/meta/app", ({ request }) => echo(request, appMeta)),
  http.get("/platform/api/search/global", ({ request }) =>
    echo(request, { ...globalResults, query: new URL(request.url).searchParams.get("q") ?? "" }),
  ),
  http.get("/platform/api/me", ({ request }) => echo(request, currentUser)),
  http.put("/platform/api/me", async ({ request }) => {
    const body = (await request.json()) as {
      preferences: Record<string, Record<string, unknown>>;
    };
    // Merged per *section*, the way the server merges it: a page that sends
    // `{formats: {date: …}}` must get the other two formats back untouched,
    // and a handler that replaced the section would hide that bug.
    const merged = { ...currentUser.preferences } as Record<string, Record<string, unknown>>;
    for (const [section, values] of Object.entries(body.preferences)) {
      merged[section] = { ...merged[section], ...values };
    }
    return echo(request, { preferences: merged });
  }),
  http.get("/platform/health/status", ({ request }) => echo(request, healthSnapshot)),
  http.get("/platform/dashboard/summary", ({ request }) => echo(request, dashboardSummary)),
  http.get("/platform/api/explorer/catalog", ({ request }) => echo(request, explorerCatalogue)),
  http.get("/platform/api/dashboards", ({ request }) =>
    echo(request, {
      items: savedDashboards.map(({ widgets: _widgets, ...rest }) => rest),
      total: savedDashboards.length,
      widget_kinds: DASHBOARD_KINDS,
      columns: 12,
      datasets: explorerCatalogue.items.map((item) => ({
        key: item.key, label: item.label, path: item.path,
      })),
      can_create: true,
      can_share: true,
    }),
  ),
  http.post("/platform/api/dashboards", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      ...dashboardById("dash-1"),
      ...body,
      id: `dash-${savedDashboards.length + 1}`,
      widgets: [],
      widget_count: 0,
      can_edit: true,
    };
    savedDashboards.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get("/platform/api/dashboards/:id", ({ request, params }) =>
    echo(request, dashboardById(String(params["id"]))),
  ),
  http.put("/platform/api/dashboards/:id", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const found = dashboardById(String(params["id"]));
    // One home per person, as the server enforces it — a fixture that let two
    // stand would hide the bug the assertion is looking for.
    if (body["is_home"]) {
      for (const item of savedDashboards) item["is_home"] = item["id"] === found["id"];
    }
    Object.assign(found, body);
    return HttpResponse.json(found);
  }),
  http.delete("/platform/api/dashboards/:id", ({ params }) => {
    const index = savedDashboards.findIndex((item) => item["id"] === String(params["id"]));
    const [gone] = index >= 0 ? savedDashboards.splice(index, 1) : [dashboardById("dash-1")];
    return HttpResponse.json({ id: gone!["id"], deleted: true, name: gone!["name"] });
  }),
  http.post("/platform/api/dashboards/:id/widgets", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const found = dashboardById(String(params["id"]));
    const widgets = found["widgets"] as Record<string, unknown>[];
    widgets.push({
      id: `widget-${widgets.length + 1}`,
      subtitle: null,
      x: 0, y: 0, width: 3, height: 2,
      position: widgets.length,
      config: {},
      ...body,
    });
    found["widget_count"] = widgets.length;
    return HttpResponse.json(found, { status: 201 });
  }),
  http.put("/platform/api/dashboards/:id/widgets/:widgetId", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const found = dashboardById(String(params["id"]));
    const widgets = found["widgets"] as Record<string, unknown>[];
    const widget = widgets.find((item) => item["id"] === String(params["widgetId"]));
    if (widget) Object.assign(widget, body);
    return HttpResponse.json(found);
  }),
  http.delete("/platform/api/dashboards/:id/widgets/:widgetId", ({ params }) => {
    const found = dashboardById(String(params["id"]));
    const widgets = found["widgets"] as Record<string, unknown>[];
    const index = widgets.findIndex((item) => item["id"] === String(params["widgetId"]));
    if (index >= 0) widgets.splice(index, 1);
    found["widget_count"] = widgets.length;
    return HttpResponse.json(found);
  }),
  http.put("/platform/api/dashboards/:id/arrange", async ({ request, params }) => {
    const body = (await request.json()) as { widgets: Record<string, unknown>[] };
    const found = dashboardById(String(params["id"]));
    const widgets = found["widgets"] as Record<string, unknown>[];
    // Reordered *and* repositioned, because one drag produces both and a
    // fixture that only stored the geometry would let the order silently drop.
    found["widgets"] = body.widgets.map((placement, position) => ({
      ...widgets.find((item) => item["id"] === placement["id"]),
      ...placement,
      position,
    }));
    return HttpResponse.json(found);
  }),
  http.get("/platform/api/maps/catalog", ({ request }) => echo(request, mapCatalogue)),
  http.get("/platform/api/maps/places", ({ request }) => {
    const url = new URL(request.url);
    return echo(request, mapPlaces(url.searchParams.get("dataset") ?? "customer"));
  }),
  // Every "pick a person" control reads this — the assignee on a task, the
  // owner on a project, the members of a share. Filtered here the way the
  // server filters it, so a test can type a name and assert what came back
  // rather than only that a box exists.
  http.get("/platform/api/directory/people", ({ request }) => {
    const term = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
    const items = people.filter(
      (person) => !term || person.name.toLowerCase().includes(term),
    );
    return echo(request, { items, total: items.length, page: 1, page_size: 25, pages: 1 });
  }),
  http.get("/platform/api/analysis/catalog", ({ request }) => echo(request, analysisCatalogue)),
  http.get("/platform/api/reports", ({ request }) =>
    echo(request, {
      items: savedReports,
      total: savedReports.length,
      visualizations: ["bar", "hbar", "line", "area", "pie", "stacked-bar", "treemap", "table"],
      can_create: true,
      can_share: true,
    }),
  ),
  http.post("/platform/api/reports", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      ...savedReports[0],
      ...body,
      id: `report-${savedReports.length + 1}`,
      owner: { id: "user-1", name: "Ada Administrator", email: "admin@nucleus.example" },
      can_edit: true,
      members: [],
      run_count: 0,
      last_run_at: null,
    };
    savedReports.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post("/platform/api/reports/:id/run", async ({ params, request }) => {
    const report = savedReports.find((item) => item["id"] === params["id"]) ?? savedReports[0]!;
    const overrides = (await request.json().catch(() => ({}))) as { period?: string };
    return HttpResponse.json({
      report,
      result: analysisResult({
        resource_type: String(report["resource_type"]),
        dimensions: report["dimensions"] as { field: string }[],
        measures: report["metrics"] as { aggregation: string; field?: string }[],
        period: overrides.period ?? String(report["period"]),
      }),
    });
  }),
  http.post("/platform/api/reports/:id/duplicate", ({ params }) => {
    const source = savedReports.find((item) => item["id"] === params["id"]) ?? savedReports[0]!;
    const copy = {
      ...source,
      id: `${String(source["id"])}-copy`,
      name: `${String(source["name"])} (copy)`,
      scope: "PRIVATE",
      can_edit: true,
    };
    savedReports.push(copy);
    return HttpResponse.json(copy, { status: 201 });
  }),
  http.get("/platform/api/reports/:id", ({ request, params }) =>
    echo(request, savedReports.find((item) => item["id"] === params["id"]) ?? savedReports[0]!),
  ),
  http.put("/platform/api/reports/:id", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const index = savedReports.findIndex((item) => item["id"] === params["id"]);
    const updated = { ...savedReports[Math.max(index, 0)], ...body };
    if (index >= 0) savedReports[index] = updated;
    return HttpResponse.json(updated);
  }),
  http.delete("/platform/api/reports/:id", ({ params }) => {
    const index = savedReports.findIndex((item) => item["id"] === params["id"]);
    if (index >= 0) savedReports.splice(index, 1);
    return HttpResponse.json({ deleted: true, id: params["id"] });
  }),
  http.post("/platform/api/analysis/run", async ({ request }) =>
    HttpResponse.json(analysisResult((await request.json()) as Parameters<typeof analysisResult>[0]), {
      headers: { [CORRELATION_HEADER]: request.headers.get(CORRELATION_HEADER) ?? "" },
    }),
  ),
  http.post("/platform/api/explorer/query", async ({ request }) => {
    const body = (await request.json()) as {
      resource_type?: string;
      filters?: Record<string, unknown>;
      columns?: string[];
    };
    // The Data Explorer's own tests assert against `explorerResult`; the
    // entity pages ask for five other datasets, and a handler that answered
    // "task" to all of them would let a page draw the wrong entity and pass.
    // A per-lane query is answered by `entityResult` even for tasks, because a
    // handler that ignored the status filter would put the same card in every
    // lane of the board and the board would still look right.
    const scoped = Boolean((body as { filters?: Record<string, unknown> }).filters?.["status"]);
    return echo(request, body.resource_type !== "task" || scoped
      ? entityResult(body)
      : explorerResult);
  }),
  http.post("/platform/api/explorer/insights", async ({ request }) => {
    const body = (await request.json()) as { resource_type?: string };
    return echo(request, entityInsights(body.resource_type ?? "task"));
  }),
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

  http.get("/platform/admin/users", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const role = query.get("role_code");
    const term = (query.get("q") ?? "").toLowerCase();
    const items = userRows.filter(
      (row) =>
        (!role || row.role_code === role) &&
        (!term || row.full_name.toLowerCase().includes(term) || row.email.includes(term)),
    );
    return echo(request, userPage(items));
  }),
  http.get("/platform/admin/users/:id", ({ request }) => echo(request, userDetail)),
  http.put("/platform/admin/users/:id", async ({ request }) => {
    const body = (await request.json()) as { status?: string; role_code?: string };
    return echo(request, { ...userDetail, ...body });
  }),
  http.post("/platform/admin/users/:id/impersonate", ({ request, params }) =>
    echo(request, {
      id: String(params["id"]),
      username: "user",
      full_name: "Uma User",
      email: "uma@nucleus.example",
      role: "VIEWER",
      started_by: "Ada Administrator",
    }),
  ),
  http.get("/platform/admin/roles", ({ request }) => echo(request, roleMatrix)),
  http.put("/platform/admin/roles/:code", async ({ request, params }) => {
    const body = (await request.json()) as { permissions?: string[] };
    const role =
      roleMatrix.items.find((item) => item.code === params["code"]) ?? roleMatrix.items[0]!;
    return echo(request, { ...role, permissions: body.permissions ?? role.permissions });
  }),
  // Before the `:type/:id` rule below, or "network" is read as a resource type.
  http.get("/platform/api/relationships/network", ({ request }) => {
    const focus = new URL(request.url).searchParams.get("focus") ?? "customer";
    return echo(request, {
      ...recordNetwork,
      focus: { key: focus, label: focus === "project" ? "Projects" : "Customers" },
    });
  }),
  http.get("/platform/api/relationships/overview", ({ request }) => echo(request, connectionMap)),
  // Keyed on the type, because three detail pages now read three different
  // shapes: a handler that answered a task to all of them would let the ticket
  // console draw a task and still pass.
  http.get("/platform/api/records/:type/:id", ({ request, params }) =>
    echo(request, recordsByType[String(params["type"])] ?? recordDetail),
  ),
  http.get("/platform/api/comments", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const items = recordComments.filter(
      (item) =>
        item["resource_type"] === query.get("resource_type") &&
        item["resource_id"] === query.get("resource_id"),
    );
    return echo(request, {
      items,
      total: items.length,
      resource_type: query.get("resource_type") ?? "",
      resource_id: query.get("resource_id") ?? "",
      can_comment: true,
    });
  }),
  http.post("/platform/api/comments", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      ...recordComments[0],
      ...body,
      id: `comment-${recordComments.length + 1}`,
      parent_id: body["parent_id"] ?? null,
      author: { id: "user-1", name: "Ada Administrator", avatar_url: null, job_title: "Platform" },
      edited_at: null,
      created_at: "2026-09-06T12:00:00Z",
      can_edit: true,
    };
    recordComments.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.put("/platform/api/comments/:id", async ({ request, params }) => {
    const body = (await request.json()) as { body: string };
    const index = recordComments.findIndex((item) => item["id"] === params["id"]);
    const updated = {
      ...recordComments[Math.max(index, 0)],
      body: body.body,
      edited_at: "2026-09-06T12:05:00Z",
    };
    if (index >= 0) recordComments[index] = updated;
    return HttpResponse.json(updated);
  }),
  http.delete("/platform/api/comments/:id", ({ params }) => {
    const index = recordComments.findIndex((item) => item["id"] === params["id"]);
    if (index >= 0) recordComments.splice(index, 1);
    return HttpResponse.json({ deleted: true, id: params["id"] });
  }),
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
