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
import { asText } from "@/lib/text";
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
/**
 * A local name for `lib/text.asText`, which these fixtures already imported.
 *
 * They hold `Record<string, unknown>`, and `String(value)` renders
 * "[object Object]" for anything that is not a primitive — a slip eslint has
 * caught four times here. The shared helper existed all along; the mistake was
 * reaching for `String` rather than for it.
 */
const text = asText;

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
      field("status", "Status", "enum", { facet: true, choices: ["ACTIVE", "COMPLETED"], editable: true }),
      field("phase", "Phase", "enum", { facet: true, choices: ["BUILD", "DISCOVERY"], editable: true }),
      field("health", "Health", "enum", { facet: true, choices: ["ON_TRACK", "AT_RISK", "OFF_TRACK"] }),
      field("priority", "Priority", "enum", { facet: true, choices: ["HIGH", "NORMAL"], editable: true }),
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
      field("status", "Status", "enum", { facet: true, choices: ["CONFIRMED", "CANCELLED"], editable: true }),
      field("payment_status", "Payment status", "enum", { facet: true, choices: ["PAID", "UNPAID"], editable: true }),
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
      field("status", "Status", "enum", { facet: true, choices: ["OPEN", "RESOLVED"], editable: true }),
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
  // Three, not one: a ledger of one row demonstrates neither the total nor
  // anything a *selection* does, and a bulk gesture over one record cannot
  // show a partial outcome — which is the state that feature exists to report.
  order: [
    { id: "order-1", reference: "ORD-00311", status: "CONFIRMED", payment_status: "UNPAID", fulfilment_status: "PENDING", channel: "PORTAL", total: 18400, currency: "EUR", item_count: 6, placed_at: "2026-09-02T16:05:00Z" },
    { id: "order-2", reference: "ORD-00312", status: "CONFIRMED", payment_status: "PAID", fulfilment_status: "SHIPPED", channel: "DIRECT", total: 6250, currency: "EUR", item_count: 2, placed_at: "2026-09-01T09:20:00Z" },
    { id: "order-3", reference: "ORD-00313", status: "CANCELLED", payment_status: "UNPAID", fulfilment_status: "PENDING", channel: "PORTAL", total: 990, currency: "EUR", item_count: 1, placed_at: "2026-08-30T14:00:00Z" },
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
    // The filter's choices, as the server publishes them — including `ALERT`,
    // which automations write and which the hard-coded browser list had never
    // heard of.
    categories: ["MENTION", "ASSIGNMENT", "APPROVAL", "ALERT", "SYSTEM", "SECURITY", "REPORT"],
    severities: ["INFO", "WARNING", "CRITICAL"],
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
      widget_kinds: ["BAR_CHART", "KPI"],
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
      widget_kinds: [],
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

/**
 * The file library, in the shape `services/files.py` publishes it (§20).
 *
 * Mutable, because what is worth asserting is the *two-phase upload*: a file
 * appears as `UPLOADING` with a URL beside it, and only becomes `READY` when
 * the API has confirmed the object arrived. A fixture that answered `READY`
 * immediately would let a page that skipped the confirmation pass.
 */
export const storedFiles: Record<string, unknown>[] = [];

export const fileFolders = [
  {
    id: "folder-1", name: "Contracts", path: "/contracts", parent_id: null, depth: 0,
    color: null, is_shared: false, file_count: 1, total_bytes: 2048, owner: "Ada Administrator",
  },
  {
    id: "folder-2", name: "Signed", path: "/contracts/signed", parent_id: "folder-1", depth: 1,
    color: null, is_shared: false, file_count: 0, total_bytes: 0, owner: "Ada Administrator",
  },
];

function seedFiles(): void {
  storedFiles.length = 0;
  storedFiles.push({
    id: "file-1",
    name: "Statement of work 2026-03.pdf",
    extension: "pdf",
    mime_type: "application/pdf",
    kind: "DOCUMENT",
    size_bytes: 2048,
    checksum: "abc123",
    folder_id: "folder-1",
    status: "READY",
    version: 1,
    download_count: 4,
    preview_text: "Statement of work",
    owner: "Ada Administrator",
    created_at: "2026-09-01T09:00:00Z",
    last_accessed_at: "2026-09-04T09:00:00Z",
  });
}

seedFiles();

export function resetFiles(): void {
  seedFiles();
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


const SEEDED_ROLES = {
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

/**
 * The matrix the handlers serve, and a way back to how it started.
 *
 * A copy rather than the seed itself: the create handler pushes into `items`,
 * and without a reset the test that asserts "nothing was added here" ran after
 * the one that adds something and saw it. The same fixture hygiene the kanban
 * and mail fixtures needed.
 */
export const roleMatrix = { ...SEEDED_ROLES, items: [...SEEDED_ROLES.items] };

export function resetRoles(): void {
  roleMatrix.items = [...SEEDED_ROLES.items];
}



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

/**
 * The activity feed (§35).
 *
 * Two things the handler has to model faithfully or the page's tests prove
 * nothing: the kind counts are over the *whole* match and do not move when a
 * kind is chosen, and every kind is present even at zero.
 */
export const activityEntries = [
  {
    id: "activity-1",
    occurred_at: "2026-09-07T10:30:00Z",
    kind: "STATUS",
    kind_label: "Status changes",
    action: "STATUS_CHANGE",
    actor: { id: "user-1", name: "Ada Administrator", initials: "AA" },
    resource_type: "project",
    resource_id: "project-1",
    resource_label: "Billing replatform",
    resource_path: "/projects/project-1",
    summary: "changed the status of project Billing replatform",
    changed: ["status"],
  },
  {
    id: "activity-2",
    occurred_at: "2026-09-07T08:05:00Z",
    kind: "COMMENT",
    kind_label: "Comments",
    action: "COMMENT",
    actor: { id: "user-2", name: "Mara Manager", initials: "MM" },
    resource_type: "ticket",
    resource_id: "ticket-1",
    resource_label: "Login fails after password reset",
    resource_path: "/tickets/ticket-1",
    summary: "commented on ticket Login fails after password reset",
    changed: [],
  },
  {
    id: "activity-3",
    occurred_at: "2026-09-05T16:40:00Z",
    kind: "SECURITY",
    kind_label: "Sign-ins",
    action: "IMPERSONATE",
    actor: { id: "user-1", name: "Ada Administrator", initials: "AA" },
    resource_type: null,
    resource_id: null,
    resource_label: null,
    // No path: an event about nothing in particular is not a link.
    resource_path: null,
    summary: "started acting as Uma User",
    changed: [],
  },
];

/** Counts over the whole match, whichever kind is chosen. */
const ACTIVITY_KINDS = [
  { key: "RECORD", label: "Records", count: 12 },
  { key: "UPDATE", label: "Edits", count: 8 },
  { key: "STATUS", label: "Status changes", count: 3 },
  { key: "COMMENT", label: "Comments", count: 2 },
  { key: "FILE", label: "Files", count: 0 },
  { key: "ASSIGNMENT", label: "Assignments", count: 0 },
  { key: "SECURITY", label: "Sign-ins", count: 4 },
  { key: "SYSTEM", label: "System", count: 1 },
];

/**
 * Announcements (§17).
 *
 * A live one, a critical one that asks to be acknowledged, and one that has
 * run out — so the noticeboard's own rules are all exercisable: the strip
 * counts only what is live, the acknowledge button appears once, and expired
 * notices are behind the history toggle.
 */
export const announcements: Record<string, unknown>[] = [];

function seedAnnouncements(): void {
  announcements.length = 0;
  announcements.push(
    {
      id: "notice-1",
      title: "Scheduled maintenance this Sunday",
      body: "The platform will be read-only for up to two hours.",
      category: "MAINTENANCE",
      category_label: "Maintenance",
      severity: "WARNING",
      status: "PUBLISHED",
      is_live: true,
      is_expired: false,
      is_scheduled: false,
      is_pinned: true,
      publish_at: "2026-09-05T09:00:00Z",
      expires_at: "2026-09-20T09:00:00Z",
      audience_roles: [],
      requires_acknowledgement: false,
      link: "/settings/system",
      author: { id: "user-1", name: "Ada Administrator", initials: "AA" },
      created_at: "2026-09-05T09:00:00Z",
      updated_at: "2026-09-05T09:00:00Z",
      read_at: "2026-09-06T08:00:00Z",
      acknowledged_at: null,
    },
    {
      id: "notice-2",
      title: "Single sign-on is now required",
      body: "Password sign-in has been disabled.",
      category: "POLICY",
      category_label: "Policy",
      severity: "CRITICAL",
      status: "PUBLISHED",
      is_live: true,
      is_expired: false,
      is_scheduled: false,
      is_pinned: false,
      publish_at: "2026-09-04T09:00:00Z",
      expires_at: null,
      audience_roles: [],
      requires_acknowledgement: true,
      link: null,
      author: { id: "user-1", name: "Ada Administrator", initials: "AA" },
      created_at: "2026-09-04T09:00:00Z",
      updated_at: "2026-09-04T09:00:00Z",
      // Unread and unacknowledged: the two states the page has to act on.
      read_at: null,
      acknowledged_at: null,
    },
    {
      id: "notice-3",
      title: "Degraded search performance",
      body: "Global search was slow for ninety minutes.",
      category: "INCIDENT",
      category_label: "Incidents",
      severity: "WARNING",
      status: "PUBLISHED",
      is_live: false,
      is_expired: true,
      is_scheduled: false,
      is_pinned: false,
      publish_at: "2026-06-01T09:00:00Z",
      expires_at: "2026-06-08T09:00:00Z",
      audience_roles: [],
      requires_acknowledgement: false,
      link: null,
      author: { id: "user-1", name: "Ada Administrator", initials: "AA" },
      created_at: "2026-06-01T09:00:00Z",
      updated_at: "2026-06-01T09:00:00Z",
      read_at: "2026-06-02T09:00:00Z",
      acknowledged_at: null,
    },
  );
}

seedAnnouncements();

export function resetAnnouncements(): void {
  seedAnnouncements();
}

/** Counts over the *live* set only, which is what the strip filters. */
function announcementCategories() {
  const live = announcements.filter((item) => item["is_live"]);
  const counted = new Map<string, number>();
  for (const item of live) {
    const key = String(item["category"]);
    counted.set(key, (counted.get(key) ?? 0) + 1);
  }
  return [
    ["RELEASE", "Releases"],
    ["MAINTENANCE", "Maintenance"],
    ["INCIDENT", "Incidents"],
    ["POLICY", "Policy"],
    ["NEWS", "News"],
  ].map(([key, label]) => ({ key, label, count: counted.get(String(key)) ?? 0 }));
}

/**
 * A kanban board (§18).
 *
 * One epic with a story under it, a task in another lane, and a lane that is
 * *over its limit* — so the board's own rules are all exercisable: the
 * warning, the hierarchy, the derived counts and a drop across lanes.
 */
export const kanbanBoards: Record<string, unknown>[] = [];
export const kanbanLanes: Record<string, unknown>[] = [];
export const kanbanCards: Record<string, unknown>[] = [];

function card(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    board_id: "board-1",
    lane_id: "lane-1",
    kind: "TASK",
    description: null,
    parent_id: null,
    position: 0,
    priority: "NORMAL",
    story_points: null,
    assignee: { id: null, name: null, initials: null },
    labels: [],
    due_date: null,
    started_at: null,
    completed_at: null,
    checklist: [],
    checklist_done: 0,
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-09-05T09:00:00Z",
    ...overrides,
  };
}

function seedKanban(): void {
  kanbanBoards.length = 0;
  kanbanLanes.length = 0;
  kanbanCards.length = 0;

  kanbanBoards.push(
    {
      id: "board-1", key: "PLAT", name: "Platform delivery",
      description: "Reviewed on Tuesdays.", scope: "PUBLIC", is_archived: false,
      owner: { id: "user-1", is_me: true }, lane_count: 3, card_count: 4,
      can_edit: true, created_at: "2026-08-01T09:00:00Z", updated_at: "2026-09-05T09:00:00Z",
    },
    {
      id: "board-2", key: "SUP", name: "Support improvements",
      description: null, scope: "PRIVATE", is_archived: false,
      owner: { id: "user-1", is_me: true }, lane_count: 3, card_count: 0,
      can_edit: true, created_at: "2026-07-01T09:00:00Z", updated_at: "2026-08-01T09:00:00Z",
    },
  );

  kanbanLanes.push(
    { id: "lane-1", name: "Backlog", position: 0, wip_limit: null, is_done: false },
    // A limit of one with two cards in it: the warning is the point of a limit.
    { id: "lane-2", name: "In progress", position: 1, wip_limit: 1, is_done: false },
    { id: "lane-3", name: "Done", position: 2, wip_limit: null, is_done: true },
  );

  kanbanCards.push(
    card({
      id: "card-1", reference: "PLAT-00001", kind: "EPIC",
      title: "Self-service reporting", lane_id: "lane-1", story_points: 8,
      labels: ["backend"],
    }),
    card({
      id: "card-2", reference: "PLAT-00002", kind: "STORY",
      title: "Save a chart from the builder", lane_id: "lane-2",
      parent_id: "card-1", position: 0, priority: "HIGH",
      assignee: { id: "user-2", name: "Mara Manager", initials: "MM" },
      checklist: [
        { text: "Reviewed", done: true },
        { text: "Tested", done: false },
      ],
      checklist_done: 1,
    }),
    card({
      id: "card-3", reference: "PLAT-00003", kind: "BUG",
      title: "Fix the edge case found in review", lane_id: "lane-2", position: 1,
      priority: "CRITICAL",
    }),
    card({
      id: "card-4", reference: "PLAT-00004", kind: "TASK",
      title: "Update the documentation", lane_id: "lane-3",
      completed_at: "2026-09-04T09:00:00Z",
    }),
  );
}

seedKanban();

export function resetKanban(): void {
  seedKanban();
}

/** The board as the server assembles it: lanes with their cards and counts. */
function kanbanDetail(boardId: string, filters: URLSearchParams) {
  const board = kanbanBoards.find((item) => item["id"] === boardId) ?? kanbanBoards[0];
  const kind = filters.get("kind") ?? "";
  const label = filters.get("label") ?? "";
  const term = (filters.get("q") ?? "").toLowerCase();

  const matching = kanbanCards.filter(
    (item) =>
      item["board_id"] === board?.["id"] &&
      (!kind || item["kind"] === kind) &&
      (!label || (item["labels"] as string[]).includes(label)) &&
      (!term || String(item["title"]).toLowerCase().includes(term)),
  );

  return {
    board,
    lanes: kanbanLanes.map((lane) => {
      const held = matching.filter((item) => item["lane_id"] === lane["id"]);
      const limit = lane["wip_limit"] as number | null;
      return {
        ...lane,
        // The whole match, and the warning derived from it — both the server's.
        total: held.length,
        over_limit: limit !== null && held.length > limit,
        cards: held,
      };
    }),
    unplaced: [],
    labels: [...new Set(kanbanCards.flatMap((item) => item["labels"] as string[]))].sort(),
    kinds: [
      { key: "EPIC", children: ["STORY"] },
      { key: "STORY", children: ["TASK", "BUG"] },
      { key: "TASK", children: [] },
      { key: "BUG", children: [] },
    ],
    priorities: ["LOW", "NORMAL", "HIGH", "CRITICAL"],
    filters: { assignee_id: "", label, kind, q: filters.get("q") ?? "" },
  };
}


/**
 * Automations (§49).
 *
 * Three rules, chosen so the page's own distinctions are all exercisable: one
 * live rule that has fired, one that never has (the state the list has to
 * distinguish, and the reason the "Firing" column exists), and one somebody
 * else owns — which is the only way to assert that a control is *absent* for
 * a reader rather than merely disabled.
 */
export const automationRules: Record<string, unknown>[] = [];

function automation(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    description: null,
    resource_type: "task",
    resource_label: "Tasks",
    resource_path: "/tasks",
    resource_exists: true,
    enabled: true,
    severity: "WARNING",
    condition_tree: {
      type: "group",
      conjunction: "AND",
      children1: {
        a: {
          type: "rule",
          properties: { field: "status", operator: "select_any_in", value: [["NEW"]] },
        },
      },
    },
    condition_text: "Status in ['NEW']",
    condition_count: 1,
    actions: [{ kind: "NOTIFY", recipients: { user_ids: [], role: "MANAGER", owner: true } }],
    action_summary: ["Notify people"],
    schedule: "*/15 * * * *",
    cooldown_minutes: 60,
    owner: { id: "user-1", name: "Ada Administrator" },
    last_triggered_at: "2026-09-07T09:00:00Z",
    trigger_count: 12,
    last_match_count: 4,
    created_at: "2026-08-01T09:00:00Z",
    updated_at: "2026-09-05T09:00:00Z",
    can_edit: true,
    ...overrides,
  };
}

function seedAutomations(): void {
  automationRules.length = 0;
  automationRules.push(
    automation({ id: "rule-1", name: "New tasks need triage" }),
    automation({
      id: "rule-2",
      name: "Critical tickets breaching",
      resource_type: "ticket",
      resource_label: "Tickets",
      resource_path: "/tickets",
      severity: "CRITICAL",
      // Never fired: the state the list exists to distinguish from the one
      // above it.
      last_triggered_at: null,
      trigger_count: 0,
      action_summary: ["Notify people", "Raise a task"],
      actions: [
        { kind: "NOTIFY", recipients: { user_ids: [], role: "MANAGER", owner: false } },
        { kind: "TASK", title: "Follow up on {record}", priority: "HIGH" },
      ],
      cooldown_minutes: 0,
    }),
    automation({
      // A rule that outlived its dataset: paused by `--sync-automations`, and
      // the state the page has to *explain* rather than report as a fault.
      id: "rule-4",
      name: "Failed jobs in the last hour",
      resource_type: "job",
      resource_label: "job",
      resource_path: "",
      resource_exists: false,
      enabled: false,
      action_summary: [],
      trigger_count: 31,
    }),
    automation({
      id: "rule-3",
      name: "Somebody else's rule",
      enabled: false,
      owner: { id: "user-2", name: "Mara Manager" },
      can_edit: false,
      trigger_count: 3,
    }),
  );
}

seedAutomations();

export function resetAutomations(): void {
  seedAutomations();
}

/** One evaluation, as `services/workflows.evaluate` returns it. */
function automationRun(
  ruleId: string,
  dryRun: boolean,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `run-${ruleId}-${dryRun ? "dry" : "live"}`,
    rule_id: ruleId,
    dry_run: dryRun,
    started_at: "2026-09-08T09:00:00Z",
    finished_at: "2026-09-08T09:00:02Z",
    matched: 3,
    fired: 2,
    suppressed: 1,
    deferred: 0,
    error: null,
    capped: false,
    sample: [
      {
        record: "TSK-00001 Review the handbook",
        record_id: "task-1",
        path: "/tasks/task-1",
        state: dryRun ? "WOULD FIRE" : "FIRED",
        actions: [{ kind: "NOTIFY", ok: true, detail: "notified 2" }],
      },
      {
        record: "TSK-00002 Chase the invoice",
        record_id: "task-2",
        path: "/tasks/task-2",
        state: "SUPPRESSED",
        since: "2026-09-08T08:30:00Z",
        actions: [],
      },
    ],
    by_action: { NOTIFY: { ok: 2, failed: 0 } },
    triggered_by: "Ada Administrator",
    ...overrides,
  };
}


/**
 * The calendar (§19).
 *
 * A fixed window rather than "whatever today is": the page asks for a range it
 * computes from the address, and a fixture keyed on the real clock would make
 * every assertion depend on the day the suite ran. The handler answers any
 * window with the same events, which is what lets a test say "March 2026" and
 * mean it.
 *
 * The events are chosen so the page's own distinctions are exercisable: one
 * this reader organises, one they were invited to and have *not answered*, one
 * that clashes with it, one recurring series, one all-day marker, and one
 * cancelled.
 */
export const calendarEvents: Record<string, unknown>[] = [];

function occurrence(overrides: Record<string, unknown>): Record<string, unknown> {
  const start =
    typeof overrides["starts_at"] === "string"
      ? overrides["starts_at"]
      : "2026-03-10T09:00:00Z";
  return {
    description: null,
    category: "MEETING",
    status: "CONFIRMED",
    location: "Room Aurora (4)",
    all_day: false,
    organizer: { id: "user-1", name: "Ada Administrator" },
    project_id: null,
    task_id: null,
    participants: [
      {
        user_id: "user-1",
        name: "Ada Administrator",
        email: "admin@nucleus.example",
        initials: "AA",
        response: "ACCEPTED",
      },
    ],
    recurrence: null,
    recurrence_until: null,
    recurrence_text: "",
    reminder_minutes: null,
    color: "#5b5bd6",
    involves_me: true,
    my_response: "ACCEPTED",
    can_edit: true,
    day: start.slice(0, 10),
    minutes: 60,
    is_occurrence: false,
    clashes_with: [],
    ...overrides,
  };
}

function seedCalendar(): void {
  calendarEvents.length = 0;
  calendarEvents.push(
    occurrence({
      id: "event-1:2026-03-10T09:00:00+00:00",
      event_id: "event-1",
      title: "Delivery review",
      starts_at: "2026-03-10T09:00:00Z",
      ends_at: "2026-03-10T10:00:00Z",
      description: "Agenda is on the project page.",
      // Clashes with the standup below — named, because "1 conflict" is a hunt.
      clashes_with: ["Morning standup"],
    }),
    occurrence({
      id: "event-2:2026-03-10T09:30:00+00:00",
      event_id: "event-2",
      title: "Morning standup",
      starts_at: "2026-03-10T09:30:00Z",
      ends_at: "2026-03-10T09:45:00Z",
      minutes: 15,
      // Invited and unanswered: the state the header count exists for.
      my_response: "NEEDS_ACTION",
      can_edit: false,
      organizer: { id: "user-2", name: "Mara Manager" },
      clashes_with: ["Delivery review"],
    }),
    occurrence({
      id: "event-3:2026-03-12T14:00:00+00:00",
      event_id: "event-3",
      title: "Weekly sync",
      starts_at: "2026-03-12T14:00:00Z",
      ends_at: "2026-03-12T14:30:00Z",
      minutes: 30,
      recurrence: { freq: "WEEKLY", interval: 1, byday: ["TH"] },
      recurrence_until: "2026-06-30T00:00:00Z",
      recurrence_text: "every week on Thursday, until 2026-06-30",
      is_occurrence: true,
    }),
    occurrence({
      id: "event-4:2026-03-16T00:00:00+00:00",
      event_id: "event-4",
      title: "Public holiday",
      category: "HOLIDAY",
      starts_at: "2026-03-16T00:00:00Z",
      ends_at: "2026-03-17T00:00:00Z",
      all_day: true,
      minutes: 1440,
      location: null,
    }),
    occurrence({
      id: "event-5:2026-03-11T11:00:00+00:00",
      event_id: "event-5",
      title: "Cancelled workshop",
      status: "CANCELLED",
      starts_at: "2026-03-11T11:00:00Z",
      ends_at: "2026-03-11T12:00:00Z",
      involves_me: false,
      my_response: null,
    }),
  );
}

seedCalendar();

export function resetCalendar(): void {
  seedCalendar();
}


/**
 * A mailbox (§14–§16).
 *
 * Chosen so the page's own distinctions are exercisable: an unread thread, a
 * read one, a starred one, a multi-message conversation, one with a draft in
 * it, and one in another folder — plus a template with a placeholder, because
 * "this still says {{ name }}" is the warning the composer exists to give.
 */
export const mailThreads: Record<string, unknown>[] = [];

function mailMessage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    reference: "<MAIL-000001@nucleus.local>",
    subject: "A conversation",
    from: { name: "Mara Manager", email: "manager@nucleus.example", initials: "MM" },
    to: [{ name: "Ada Administrator", email: "admin@nucleus.example" }],
    cc: [],
    bcc: [],
    body: "First paragraph.\n\nSecond paragraph.",
    preview: "First paragraph.",
    folder: "INBOX",
    is_read: true,
    is_starred: false,
    is_draft: false,
    priority: "NORMAL",
    sent_at: "2026-09-06T09:00:00Z",
    read_at: "2026-09-06T09:05:00Z",
    attachment_count: 0,
    attachments: [],
    ...overrides,
  };
}

function mailThread(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    folder: "INBOX",
    message_count: 1,
    unread_count: 0,
    has_attachments: false,
    is_starred: false,
    is_important: false,
    labels: [],
    last_message_at: "2026-09-06T09:00:00Z",
    participants: [
      { name: "Mara Manager", email: "manager@nucleus.example", initials: "MM" },
      { name: "Ada Administrator", email: "admin@nucleus.example", initials: "AA" },
    ],
    snippet: "First paragraph.",
    created_at: "2026-09-06T09:00:00Z",
    has_draft: false,
    messages: [],
    ...overrides,
  };
}

function seedMail(): void {
  mailThreads.length = 0;
  mailThreads.push(
    mailThread({
      id: "thread-1",
      subject: "Weekly operations summary",
      // Unread: the state the list renders as weight *and* a dot, and the one
      // the folder rail badges.
      unread_count: 1,
      labels: ["Escalation"],
      messages: [
        mailMessage({ id: "msg-1", thread_id: "thread-1", is_read: false, read_at: null }),
      ],
    }),
    mailThread({
      id: "thread-2",
      subject: "Change freeze over the release weekend",
      is_starred: true,
      message_count: 3,
      messages: [
        mailMessage({ id: "msg-2a", thread_id: "thread-2", body: "Oldest." }),
        mailMessage({ id: "msg-2b", thread_id: "thread-2", body: "Middle." }),
        mailMessage({
          id: "msg-2c", thread_id: "thread-2", body: "Newest.",
          sent_at: "2026-09-07T09:00:00Z",
        }),
      ],
    }),
    mailThread({
      id: "thread-3",
      subject: "Proposal for the field service rollout",
      folder: "DRAFTS",
      has_draft: true,
      messages: [
        mailMessage({
          id: "msg-3", thread_id: "thread-3", folder: "DRAFTS", is_draft: true,
          sent_at: null, read_at: null, body: "Half written.",
          from: { name: "Ada Administrator", email: "admin@nucleus.example", initials: "AA" },
          to: [],
        }),
      ],
    }),
  );
}

seedMail();

export function resetMail(): void {
  seedMail();
}


/**
 * System settings and feature flags (§11, §27).
 *
 * One of each declared type, because the page renders its controls from the
 * declaration and a fixture of all-strings would assert nothing: a boolean, a
 * choice, a bounded number, a plain string, and one secret.
 */
export const settingRows: Record<string, unknown>[] = [];

function setting(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    category: "general",
    description: "What it does.",
    value_type: "string",
    options: {},
    is_secret: false,
    requires_restart: false,
    changed: false,
    updated_at: "2026-09-01T09:00:00Z",
    ...overrides,
  };
}

function seedSettings(): void {
  settingRows.length = 0;
  settingRows.push(
    setting({ key: "app.name", label: "Application name", value: "Nucleus", default: "Nucleus" }),
    setting({
      key: "ui.density", label: "Default table density", category: "appearance",
      value_type: "choice", value: "middle", default: "middle",
      options: { choices: ["compact", "middle", "comfortable"] },
    }),
    setting({
      key: "security.mfa_required", label: "Require MFA", category: "security",
      value_type: "boolean", value: false, default: false,
    }),
    setting({
      key: "retention.log_days", label: "Log retention", category: "retention",
      value_type: "duration", value: 60, default: 30, changed: true,
      requires_restart: true,
      options: { minimum: 1, maximum: 365, unit: "days" },
    }),
    setting({
      key: "integrations.webhook_signing_key", label: "Webhook signing key",
      category: "security", value: "••••••••", default: "••••••••", is_secret: true,
    }),
  );
}

seedSettings();

export function resetSettings(): void {
  seedSettings();
}

/** The grouped shape the page renders, built from whatever the rows now say. */
function settingsPage() {
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const row of settingRows) {
    const key = String(row["category"]);
    (groups[key] ??= []).push(row);
  }
  return {
    groups: Object.entries(groups)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, items]) => ({
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        items,
      })),
    total: settingRows.length,
    categories: Object.entries(groups).map(([key, items]) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      count: items.length,
    })),
    value_types: ["string", "integer", "boolean", "choice", "json", "duration"],
    changed: settingRows.filter((row) => row["changed"]).length,
    restart_pending: settingRows.filter((row) => row["changed"] && row["requires_restart"])
      .length,
  };
}

export const flagRows: Record<string, unknown>[] = [];

function flag(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    description: "What it guards.",
    environment: "production",
    stage: "BETA",
    rollout_percentage: 0,
    target_roles: [],
    target_user_ids: [],
    experimental: false,
    last_toggled_at: null,
    updated_at: "2026-09-01T09:00:00Z",
    on_for_me: false,
    partial: false,
    ...overrides,
  };
}

function seedFlags(): void {
  flagRows.length = 0;
  flagRows.push(
    flag({
      key: "dark-mode", name: "Dark mode", enabled: true, rollout_percentage: 100,
      stage: "GA", on_for_me: true, last_toggled_at: "2026-08-20T09:00:00Z",
    }),
    // Enabled and partial: the row the page exists to explain — on, and not
    // on for this reader.
    flag({
      key: "csv-import", name: "CSV import wizard", enabled: true,
      rollout_percentage: 10, partial: true, on_for_me: false,
    }),
    flag({ key: "ai-summaries", name: "AI record summaries", enabled: false, experimental: true }),
  );
}

seedFlags();

export function resetFlags(): void {
  seedFlags();
}

/**
 * The system log (§22).
 *
 * Enough shape to exercise the page's three real behaviours: the severity
 * floor, the cursor tail, and a line whose detail carries siblings. The tail
 * is modelled honestly — `after` returns only what follows that id — because a
 * fixture that always returned the same rows would let the page repeat lines
 * forever and the test would still pass.
 */
export const logRows: Record<string, unknown>[] = [];

const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] as const;

function logLine(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    service: "platform-api",
    logger: "api.request",
    correlation_id: "aaaabbbbccccdddd",
    trace_id: null,
    user_id: null,
    host: "api-7f9c",
    environment: "production",
    duration_ms: 24,
    status_code: 200,
    has_context: true,
    has_stack_trace: false,
    ...overrides,
  };
}

function seedLogs(): void {
  logRows.length = 0;
  logRows.push(
    logLine({
      id: "log-1", logged_at: "2026-09-08T10:00:00Z", level: "INFO",
      message: "GET /platform/api/me → 200", duration_ms: 19,
    }),
    logLine({
      id: "log-2", logged_at: "2026-09-08T10:00:05Z", level: "WARNING",
      message: "GET /platform/api/records/nonesuch → 404", status_code: 404, duration_ms: 3,
    }),
    // The slow one, and the one with a trace — the two rows the detail pane
    // and the "Took" column exist for.
    logLine({
      id: "log-3", logged_at: "2026-09-08T10:00:09Z", level: "ERROR",
      message: "POST /platform/api/records/order → 500", status_code: 500,
      duration_ms: 2410, has_stack_trace: true, correlation_id: "shared-request",
    }),
    logLine({
      id: "log-4", logged_at: "2026-09-08T10:00:08Z", level: "INFO",
      message: "POST /platform/api/records/order → in", correlation_id: "shared-request",
      duration_ms: 61,
    }),
    logLine({
      id: "log-5", logged_at: "2026-09-08T10:00:11Z", level: "DEBUG",
      message: "cache miss for dashboard:kpi", logger: "src.core.cache", duration_ms: 1,
    }),
  );
}

seedLogs();

export function resetLogs(): void {
  seedLogs();
}

/** `min_level` is a severity floor, exactly as the server treats it. */
function atLeast(level: string): string[] {
  const index = LOG_LEVELS.indexOf(level as (typeof LOG_LEVELS)[number]);
  return index < 0 ? [...LOG_LEVELS] : LOG_LEVELS.slice(index);
}

function matchingLogs(url: URL): Record<string, unknown>[] {
  const term = (url.searchParams.get("q") ?? "").toLowerCase();
  const minLevel = url.searchParams.get("min_level") ?? "";
  const service = url.searchParams.get("service") ?? "";
  const allowed = minLevel ? atLeast(minLevel) : null;
  return logRows.filter((row) => {
    if (allowed && !allowed.includes(String(row["level"]))) return false;
    if (service && String(row["service"]) !== service) return false;
    if (term) {
      const haystack = [row["message"], row["logger"], row["correlation_id"]]
        .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
        .join(" ");
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

function byNewest(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((left, right) =>
    String(right["logged_at"]).localeCompare(String(left["logged_at"])),
  );
}

/**
 * The background job queue (§23).
 *
 * One job per state that matters to the page: a failure inside its attempts (a
 * real Retry), one that has used them all (a *refused* Retry, which is the §76
 * case), one running (cancellable, not retryable), one succeeded, and one
 * retrying with the error that caused it. `can_retry`/`can_cancel` are
 * computed here from the same rules the server uses, because a fixture that
 * hardcoded them could disagree with the service and the test would still
 * pass.
 */
export const jobRows: Record<string, unknown>[] = [];

const JOB_STATUSES = [
  "QUEUED", "RUNNING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED",
] as const;
const JOB_TERMINAL = ["SUCCEEDED", "FAILED", "CANCELLED"];
const JOB_CANCELLABLE = ["QUEUED", "RUNNING", "RETRYING"];

function job(overrides: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    kind: "EXPORT",
    queue: "default",
    priority: "NORMAL",
    progress: 0,
    total_units: 100,
    processed_units: 0,
    failed_units: 0,
    attempt: 1,
    max_attempts: 3,
    started_at: "2026-09-08T09:00:00Z",
    finished_at: null,
    scheduled_for: null,
    duration_ms: null,
    initiated_by_label: "Ada Administrator",
    error_message: null,
    created_at: "2026-09-08T08:59:00Z",
    ...overrides,
  };
  // Derived, never stored: the same two rules the service applies.
  return {
    ...row,
    can_retry:
      JOB_TERMINAL.includes(String(row["status"])) &&
      Number(row["attempt"]) < Number(row["max_attempts"]),
    can_cancel: JOB_CANCELLABLE.includes(String(row["status"])),
    can_allow_attempts:
      Number(row["attempt"]) >= Number(row["max_attempts"]) &&
      Number(row["max_attempts"]) < 10,
  };
}

function seedJobs(): void {
  jobRows.length = 0;
  jobRows.push(
    job({
      id: "job-failed", reference: "JOB-000101", name: "Export — orders",
      status: "FAILED", progress: 40, processed_units: 40, failed_units: 60,
      error_message: "Upstream timed out after 30s", duration_ms: 4200,
      finished_at: "2026-09-08T09:04:00Z",
    }),
    // The refused Retry: terminal, out of attempts — and therefore the row
    // that offers the grant instead, which is the §76 pair this page turns on.
    job({
      id: "job-spent", reference: "JOB-000102", name: "Import — customers",
      kind: "IMPORT", status: "FAILED", attempt: 3, max_attempts: 3,
      error_message: "Row 412: customer code does not exist",
      progress: 88, processed_units: 88, failed_units: 12, duration_ms: 91000,
    }),
    job({
      id: "job-running", reference: "JOB-000103", name: "Reindex — search",
      kind: "REINDEX", queue: "maintenance", status: "RUNNING",
      progress: 62, processed_units: 620, total_units: 1000,
    }),
    job({
      id: "job-done", reference: "JOB-000104", name: "Report — revenue",
      kind: "REPORT", queue: "exports", status: "SUCCEEDED",
      progress: 100, processed_units: 100, duration_ms: 2400,
      finished_at: "2026-09-08T09:01:00Z",
    }),
    job({
      id: "job-retrying", reference: "JOB-000105", name: "Email — digest",
      kind: "EMAIL", status: "RETRYING", attempt: 2,
      error_message: "Connection reset by the mail relay",
      progress: 30, processed_units: 30, failed_units: 70,
    }),
    job({
      id: "job-queued", reference: "JOB-000106", name: "Sync — devices",
      kind: "SYNC", status: "QUEUED", started_at: null,
      scheduled_for: "2026-09-08T10:00:00Z",
    }),
  );
}

seedJobs();

export function resetJobs(): void {
  seedJobs();
}

function matchingJobs(url: URL): Record<string, unknown>[] {
  const term = (url.searchParams.get("q") ?? "").toLowerCase();
  const status = url.searchParams.get("status") ?? "";
  const queue = url.searchParams.get("queue") ?? "";
  return jobRows.filter((row) => {
    if (status && String(row["status"]) !== status) return false;
    if (queue && String(row["queue"]) !== queue) return false;
    if (term) {
      const haystack = [row["name"], row["reference"], row["error_message"]]
        .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
        .join(" ");
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

/** Whether the fixture's reader may act — flipped by a test. */
export let jobsCanManage = true;

export function setJobsCanManage(value: boolean): void {
  jobsCanManage = value;
}

/**
 * Groups (§11).
 *
 * The fixture models the *two privileges* rather than one, because that is the
 * whole shape of the page: `groupsCanMembers` and `groupsCanGrants` are set
 * independently, and the grants handler refuses when the second is off — so a
 * page that drew the grants editor for a manager fails here rather than only
 * against the real server.
 */
export const groupRows: Record<string, unknown>[] = [];

const GROUP_KINDS = ["TEAM", "OPERATIONAL", "GOVERNANCE", "BUSINESS"] as const;

function group(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    description: null,
    kind: "TEAM",
    color: "#0891b2",
    permissions: [],
    member_count: 0,
    created_at: "2026-08-01T09:00:00Z",
    updated_at: "2026-09-01T09:00:00Z",
    ...overrides,
  };
}

function seedGroups(): void {
  groupRows.length = 0;
  groupRows.push(
    group({
      id: "grp-oncall", name: "On-call", slug: "on-call", kind: "OPERATIONAL",
      description: "Who to page when a release goes wrong.",
      permissions: ["health.view", "jobs.manage", "logs.view"],
      member_count: 3,
    }),
    // Four grants, so the row has to start counting the overflow.
    group({
      id: "grp-stewards", name: "Data stewards", slug: "data-stewards", kind: "GOVERNANCE",
      permissions: ["audit.view", "records.export", "records.import", "logs.view"],
      member_count: 2,
    }),
    // Grants nothing and has nobody: the two "empty" cases the page must draw
    // as facts rather than as prompts.
    group({
      id: "grp-buddies", name: "Onboarding buddies", slug: "onboarding-buddies",
      permissions: [], member_count: 0,
    }),
  );
}

seedGroups();

export function resetGroups(): void {
  seedGroups();
  groupsCanMembers = true;
  groupsCanGrants = true;
}

/** The two privileges, flipped independently by a test. */
export let groupsCanMembers = true;
export let groupsCanGrants = true;

export function setGroupPrivileges(members: boolean, grants: boolean): void {
  groupsCanMembers = members;
  groupsCanGrants = grants;
}

const GROUP_MEMBERS: Record<string, Array<Record<string, unknown>>> = {
  "grp-oncall": [
    {
      id: "usr-1", full_name: "Ada Administrator", initials: "AA",
      email: "ada@nucleus.local", username: "admin", avatar_url: null,
      status: "ACTIVE", role_code: "ADMINISTRATOR", job_title: "Head of Platform",
    },
    {
      id: "usr-2", full_name: "Otto Operator", initials: "OO",
      email: "otto@nucleus.local", username: "operator", avatar_url: null,
      status: "ACTIVE", role_code: "OPERATOR", job_title: "Site Reliability Engineer",
    },
  ],
  "grp-stewards": [
    {
      id: "usr-3", full_name: "Ana Analyst", initials: "AA",
      email: "ana@nucleus.local", username: "analyst", avatar_url: null,
      status: "ACTIVE", role_code: "ANALYST", job_title: "Data Analyst",
    },
  ],
  "grp-buddies": [],
};

/**
 * Organizations, departments and teams (§42).
 *
 * The fixture is a *tree*, three levels deep, with the two cases the page has
 * to draw honestly: a parent whose own people differ from its subtree's, and
 * an organisation with people and a team in no department at all — which is
 * the reason a tree can sum to less than the tenant's total.
 *
 * `headcount` is deliberately absent: the server counts `users.department_id`
 * and that column said 116 for a department with nobody in it.
 */
export const orgRows: Record<string, unknown>[] = [];

function organization(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    legal_name: null,
    industry: "Logistics",
    tier: "STANDARD",
    status: "ACTIVE",
    logo_url: null,
    website: null,
    email: null,
    phone: null,
    address_line: null,
    city: "Rotterdam",
    country: "Netherlands",
    employee_count: 4200,
    people: 0,
    department_count: 0,
    team_count: 0,
    created_at: "2026-01-04T09:00:00Z",
    updated_at: "2026-09-01T09:00:00Z",
    ...overrides,
  };
}

function seedOrgs(): void {
  orgRows.length = 0;
  orgRows.push(
    organization({
      id: "org-northwind", name: "Northwind Group", slug: "northwind-group",
      tier: "ENTERPRISE", people: 12, department_count: 4, team_count: 3,
    }),
    organization({
      id: "org-contoso", name: "Contoso Systems", slug: "contoso-systems",
      tier: "STARTER", people: 2, department_count: 0, team_count: 0,
      city: "Lisbon", country: "Portugal", employee_count: 40,
    }),
  );
}

seedOrgs();

export function resetOrgs(): void {
  seedOrgs();
  orgsCanManage = true;
}

export let orgsCanManage = true;

export function setOrgsCanManage(value: boolean): void {
  orgsCanManage = value;
}

const ORG_LEAD = {
  id: "usr-lead", full_name: "Mara Manager", initials: "MM",
  avatar_url: null, job_title: "Engineering Manager",
};

/** Three levels, so the depth limit and the rollup are both observable. */
const ORG_TREES: Record<string, Record<string, unknown>> = {
  "org-northwind": {
    departments: [
      {
        id: "dep-eng", name: "Engineering", code: "ENG", description: null,
        cost_center: "CC-ENG-100", parent_id: null, manager: ORG_LEAD, depth: 0,
        // Its own two, and seven counting everything below — the pair the page
        // must not collapse into one number.
        people: 2, people_in_subtree: 7,
        teams: [
          { id: "tm-atlas", name: "Atlas", slug: "atlas", description: null, color: "#5b5bd6", lead: ORG_LEAD },
        ],
        children: [
          {
            id: "dep-plt", name: "Engineering — Platform", code: "ENG-PLT",
            description: null, cost_center: null, parent_id: "dep-eng",
            manager: null, depth: 1, people: 3, people_in_subtree: 5, teams: [],
            children: [
              {
                id: "dep-plt-core", name: "Platform — Core", code: "ENG-PLT-COR",
                description: null, cost_center: null, parent_id: "dep-plt",
                manager: null, depth: 2, people: 2, people_in_subtree: 2,
                teams: [], children: [],
              },
            ],
          },
        ],
      },
      {
        id: "dep-sales", name: "Sales", code: "SLS", description: null,
        cost_center: null, parent_id: null, manager: null, depth: 0,
        people: 4, people_in_subtree: 4, teams: [], children: [],
      },
      // Nothing in it at all: the branch where retiring changes nothing else,
      // and the state a just-created department is in.
      {
        id: "dep-legacy", name: "Legacy", code: "LGC", description: null,
        cost_center: null, parent_id: null, manager: null, depth: 0,
        people: 0, people_in_subtree: 0, teams: [], children: [],
      },
    ],
    // The reason this tenant's tree sums to 11 while it holds 12 accounts.
    unplaced_teams: [
      { id: "tm-floating", name: "Wayfinder", slug: "wayfinder", description: null, color: "#0891b2", lead: null },
    ],
    depth: 2,
    unassigned_people: 1,
  },
  "org-contoso": {
    departments: [],
    unplaced_teams: [],
    depth: 0,
    unassigned_people: 2,
  },
};

/**
 * API clients and their credentials (§25).
 *
 * The fixture mints a *different* secret each call and never stores it, so a
 * page that tried to read one back finds nothing — the same property the
 * service has. And it carries one client with no live key at all, which is the
 * state the page has to warn about rather than draw as "0 of 3".
 */
export const apiClientRows: Record<string, unknown>[] = [];

let mintCounter = 0;

function mintedSecret(): { secret: string; prefix: string } {
  mintCounter += 1;
  const secret = `nuc_fixture${String(mintCounter).padStart(4, "0")}abcdefghijklmnop`;
  return { secret, prefix: secret.slice(0, 12) };
}

function credential(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    label: "Initial key",
    state: "ACTIVE",
    created_at: "2026-08-01T09:00:00Z",
    expires_at: null,
    last_used_at: "2026-09-07T09:00:00Z",
    revoked_at: null,
    rotated_from_id: null,
    ...overrides,
  };
}

function apiClient(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    description: null,
    status: "ACTIVE",
    scopes: [],
    rate_limit_per_minute: 600,
    quota_per_day: 100000,
    requests_today: 0,
    requests_total: 0,
    error_rate: 0,
    last_used_at: null,
    allowed_ips: [],
    credential_count: 0,
    live_credentials: 0,
    created_at: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

const API_CREDENTIALS: Record<string, Array<Record<string, unknown>>> = {};

function seedApiClients(): void {
  apiClientRows.length = 0;
  mintCounter = 0;
  for (const key of Object.keys(API_CREDENTIALS)) delete API_CREDENTIALS[key];

  apiClientRows.push(
    apiClient({
      id: "cli-warehouse", name: "Warehouse sync", client_id: "nuc-warehouse01",
      scopes: ["records.view", "records.update"],
      requests_total: 3_778_870, requests_today: 4_120, error_rate: 0.028,
      last_used_at: "2026-09-08T08:00:00Z",
      credential_count: 2, live_credentials: 1,
    }),
    // Every key gone: the page must say it cannot call at all, not "0 of 1".
    apiClient({
      id: "cli-retired", name: "Old importer", client_id: "nuc-importer01",
      status: "SUSPENDED", scopes: ["records.import"],
      credential_count: 1, live_credentials: 0,
    }),
  );

  API_CREDENTIALS["cli-warehouse"] = [
    credential({ id: "cred-live", prefix: "nuc_live0001", label: "Current key" }),
    credential({
      id: "cred-old", prefix: "nuc_old00001", label: "Rotated out",
      state: "REVOKED", revoked_at: "2026-09-01T09:00:00Z",
    }),
  ];
  API_CREDENTIALS["cli-retired"] = [
    credential({
      id: "cred-expired", prefix: "nuc_exp00001", label: "Expired key",
      state: "EXPIRED", expires_at: "2026-08-20T09:00:00Z",
    }),
  ];
}

seedApiClients();

export function resetApiClients(): void {
  seedApiClients();
}

const API_REQUESTS = [
  {
    id: "req-1", requested_at: "2026-09-08T08:00:00Z", method: "GET",
    path: "/platform/api/records/project", status_code: 200, duration_ms: 42,
    ip_address: "10.0.0.4", bytes_out: 8120,
  },
  {
    id: "req-2", requested_at: "2026-09-08T07:59:00Z", method: "POST",
    path: "/platform/api/records/order", status_code: 422, duration_ms: 12,
    ip_address: "10.0.0.4", bytes_out: 210,
  },
];

/**
 * Connected systems (§26).
 *
 * The fixture carries the four states the page has to draw differently, and
 * one of them is the row this screen exists for: switched *on* and failing.
 * `state` and `configured` are computed from `required_settings` against the
 * configuration exactly as the service computes them, so a page that trusted a
 * stored word would disagree with the fixture the way it disagreed with the
 * database.
 */
export const integrationRows: Record<string, unknown>[] = [];

const REDACTION = "••••••••";

function integrationOf(overrides: Record<string, unknown>): Record<string, unknown> {
  const row = {
    description: null,
    enabled: false,
    status: "DISCONNECTED",
    required_settings: ["base_url", "secret_ref"],
    configuration: { base_url: "https://api.example", secret_ref: "TOKEN_REF", timeout_seconds: 30 },
    last_connected_at: null,
    last_error: null,
    last_error_at: null,
    icon: null,
    docs_url: "https://docs.example/integrations",
    ...overrides,
  } as Record<string, unknown>;

  // Derived here, the same way the service derives them.
  const configuration = row["configuration"] as Record<string, unknown>;
  const missing = (row["required_settings"] as string[]).filter(
    (name) => !text(configuration[name]).trim(),
  );
  const stored = String(row["status"]);
  return {
    ...row,
    configured: missing.length === 0,
    missing_settings: missing,
    state:
      missing.length > 0
        ? "NOT_CONFIGURED"
        : stored === "NOT_CONFIGURED"
          ? "DISCONNECTED"
          : stored,
  };
}

function seedIntegrations(): void {
  integrationRows.length = 0;
  integrationRows.push(
    integrationOf({
      id: "int-slack", key: "slack", name: "Slack", provider: "Slack",
      category: "MESSAGING", enabled: true, status: "CONNECTED",
      last_connected_at: "2026-09-08T07:00:00Z",
    }),
    // The row this page exists for: somebody switched it on, and it is failing.
    integrationOf({
      id: "int-github", key: "github", name: "GitHub", provider: "GitHub",
      category: "SOURCE_CONTROL", enabled: true, status: "ERROR",
      last_error: "401 from the provider: token expired.",
      last_error_at: "2026-09-08T06:00:00Z",
      last_connected_at: "2026-09-01T06:00:00Z",
    }),
    // Missing a required setting, so `NOT_CONFIGURED` is a fact.
    integrationOf({
      id: "int-stripe", key: "stripe", name: "Stripe", provider: "Stripe",
      category: "PAYMENTS",
      configuration: { base_url: "https://api.stripe.example", timeout_seconds: 30 },
    }),
    integrationOf({
      id: "int-okta", key: "okta", name: "Okta", provider: "Okta",
      category: "IDENTITY", status: "DISCONNECTED",
    }),
  );
}

seedIntegrations();

export function resetIntegrations(): void {
  seedIntegrations();
}

/** What the detail endpoint shows: sensitive names redacted, not omitted. */
function visibleConfiguration(row: Record<string, unknown>): Record<string, unknown> {
  const configuration = row["configuration"] as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(configuration)) {
    out[name] = /(secret|token|password|key|credential)/i.test(name) && value ? REDACTION : value;
  }
  return out;
}


// ── Exports (§30) ───────────────────────────────────────────────────────
//
// The four situations this page has to keep apart, one row each: a file ready
// to download, one still being produced, one that failed, and one that stalled.
// The last is the one worth having a fixture for — it is what a restart
// mid-export leaves behind, and it looks like the second unless the page says
// otherwise.
//
// Every derived field is computed here the way `services/exports.py` computes
// it, so a fixture cannot assert something the server would never send.

export const exportRows: Record<string, unknown>[] = [];

function exportOf(overrides: Record<string, unknown>): Record<string, unknown> {
  const row = {
    resource_type: "ticket",
    format: "csv",
    description: "Tickets",
    columns: ["reference", "status"],
    rows: null,
    size_bytes: null,
    checksum: null,
    requested_at: "2026-09-08T09:00:00Z",
    started_at: null,
    finished_at: null,
    duration_ms: null,
    progress: 0,
    attempt: 1,
    max_attempts: 1,
    error_message: null,
    ran_as: "greenlet",
    expires_at: null,
    expired: false,
    stalled: false,
    log_lines: [],
    ...overrides,
  } as Record<string, unknown>;

  // Derived exactly as the service derives it. Two separate questions: whether
  // there is a file, and whether asking for it now would give one. A discard
  // clears the first and keeps `rows`/`size_bytes`, which are the history — so
  // a fixture that nulled them drifted from the server and hid a bug in the
  // page's second press until the end-to-end suite found it.
  row["has_file"] = row["has_file"] ?? row["status"] === "SUCCEEDED";
  row["downloadable"] =
    row["has_file"] === true && row["status"] === "SUCCEEDED" && !row["expired"];
  return row;
}

function seedExports(): void {
  exportRows.length = 0;
  exportRows.push(
    exportOf({
      id: "exp-ready", reference: "EXP-000101", name: "Tickets — CSV",
      status: "SUCCEEDED", rows: 1284, size_bytes: 90_112,
      description: "Tickets where status is OPEN",
      finished_at: "2026-09-08T09:01:00Z", duration_ms: 4200, progress: 100,
      expires_at: "2026-09-15T09:01:00Z",
      log_lines: [
        { at: "2026-09-08T09:00:00Z", level: "INFO", message: "accepted: 1,284 rows to write" },
        { at: "2026-09-08T09:01:00Z", level: "INFO", message: "finished" },
      ],
    }),
    exportOf({
      id: "exp-working", reference: "EXP-000102", name: "Orders — XLSX",
      status: "RUNNING", format: "xlsx", resource_type: "order",
      description: "Orders", progress: 40, has_file: false,
      started_at: "2026-09-08T09:05:00Z",
    }),
    exportOf({
      id: "exp-failed", reference: "EXP-000103", name: "Projects — JSON",
      status: "FAILED", format: "json", resource_type: "project", has_file: false,
      description: "Projects",
      error_message: "RuntimeError: the bucket said no",
      finished_at: "2026-09-08T09:06:00Z",
      log_lines: [
        { at: "2026-09-08T09:06:00Z", level: "ERROR", message: "failed: the bucket said no" },
      ],
    }),
    // Queued, and old enough that nothing is going to pick it up. The row a
    // spinner would misrepresent forever.
    exportOf({
      id: "exp-stalled", reference: "EXP-000104", name: "Customers — CSV",
      status: "QUEUED", resource_type: "customer", description: "Customers",
      requested_at: "2026-09-07T09:00:00Z", stalled: true, has_file: false,
    }),
    // Finished, and its file has passed the retention window.
    exportOf({
      id: "exp-expired", reference: "EXP-000105", name: "Tickets — CSV",
      status: "SUCCEEDED", rows: 90, size_bytes: 4_096, description: "Tickets",
      finished_at: "2026-08-01T09:00:00Z", expires_at: "2026-08-08T09:00:00Z",
      expired: true, progress: 100,
    }),
  );
}

seedExports();

export function resetExports(): void {
  seedExports();
}

const exportDatasets = [
  {
    key: "ticket", label: "Tickets", description: "Support queue.",
    columns: ["reference", "status"],
    fields: [
      { name: "reference", label: "Reference", kind: "text" },
      { name: "status", label: "Status", kind: "enum" },
    ],
  },
  {
    key: "order", label: "Orders", description: "Sales orders.",
    columns: ["reference", "total"],
    fields: [{ name: "reference", label: "Reference", kind: "text" }],
  },
];

/** The row count a dataset answers with, so `estimate` is not one constant. */
const exportSizes: Record<string, number> = { ticket: 1284, order: 184_203 };

function exportCatalogue(): Record<string, unknown> {
  const statuses = [...new Set(exportRows.map((row) => String(row["status"])))].sort();
  return {
    datasets: exportDatasets,
    formats: [
      { key: "csv", label: "CSV", content_type: "text/csv; charset=utf-8", maximum: 100_000 },
      { key: "json", label: "JSON", content_type: "application/json", maximum: 100_000 },
      { key: "xlsx", label: "XLSX", content_type: "application/vnd.ms-excel", maximum: 20_000 },
    ],
    max_rows: 100_000,
    streams_up_to: 50_000,
    retention_days: 7,
    pending_limit: 3,
    pending: exportRows.filter(
      (row) => !row["stalled"] && ["QUEUED", "RUNNING"].includes(String(row["status"])),
    ).length,
    stalled: exportRows.filter((row) => row["stalled"]).length,
    statuses: statuses.map((key) => ({
      key,
      count: exportRows.filter((row) => row["status"] === key).length,
    })),
    total: exportRows.length,
    expired: exportRows.filter((row) => row["expired"]).length,
    ready: exportRows.filter((row) => row["downloadable"]).length,
  };
}


// ── Import wizard (§29) ─────────────────────────────────────────────────
//
// A draft mid-mapping, one checked with rows to fix, and one finished — the
// three states the wizard has to render differently. Every derived field is
// computed the way `services/imports.py` computes it, so a fixture cannot
// assert something the server would never send. The lesson from `/exports`:
// a fixture that derives a field its own way hides exactly the bug it was
// written to catch.

export const importRows: Record<string, unknown>[] = [];

const importColumns = [
  { index: 0, name: "Name", samples: ["Acme Ltd", "Globex", "Initech"] },
  { index: 1, name: "Email", samples: ["a@acme.test", "b@globex.test"] },
  { index: 2, name: "Segment", samples: ["SMB", "ENTERPRISE"] },
  { index: 3, name: "legacy_ref", samples: ["L-001", "L-002"] },
];

const importStaged = [
  { Name: "Acme Ltd", Email: "a@acme.test", Segment: "SMB", legacy_ref: "L-001" },
  { Name: "Globex", Email: "b@globex.test", Segment: "NOT-A-SEGMENT", legacy_ref: "L-002" },
  { Name: "", Email: "", Segment: "", legacy_ref: "L-003" },
];

function importOf(overrides: Record<string, unknown>): Record<string, unknown> {
  const row = {
    filename: "customers.csv",
    target_entity: "customer",
    target_label: "Customers",
    delimiter: ",",
    total_rows: 3,
    valid_rows: 0,
    invalid_rows: 0,
    skipped_rows: 0,
    imported_rows: 0,
    detected_columns: importColumns,
    column_mapping: { Name: "name", Email: "email", Segment: "segment" },
    unmapped_required: [],
    errors: [],
    created_at: "2026-09-08T09:00:00Z",
    completed_at: null,
    ...overrides,
  } as Record<string, unknown>;

  // Derived exactly as the service derives them.
  row["error_count"] = (row["errors"] as unknown[]).length;
  row["can_execute"] =
    row["status"] === "VALIDATED" &&
    Number(row["valid_rows"]) > 0 &&
    (row["unmapped_required"] as string[]).length === 0;
  // Letting it go does something unless it is writing — a finished run's
  // record can still be removed. And `holds_file` is what decides which of
  // the two presses the next one is, said rather than inferred.
  row["can_discard"] = row["status"] !== "RUNNING";
  row["holds_file"] = ((row["staged"] as unknown[] | undefined) ?? []).length > 0;
  return row;
}

function seedImports(): void {
  importRows.length = 0;
  importRows.push(
    importOf({
      id: "imp-draft", reference: "IMP-000201", status: "DRAFT", step: "MAPPING",
      staged: importStaged,
    }),
    importOf({
      id: "imp-checked", reference: "IMP-000202", status: "VALIDATED", step: "PREVIEW",
      valid_rows: 1, invalid_rows: 1, skipped_rows: 1,
      errors: [
        {
          line: 3, column: "Segment", field: "segment", value: "NOT-A-SEGMENT",
          message: "NOT-A-SEGMENT is not a segment this record can have.",
        },
      ],
      staged: importStaged,
    }),
    // Required field with no column: the state the execute must refuse.
    importOf({
      id: "imp-unmapped", reference: "IMP-000203", status: "DRAFT", step: "MAPPING",
      column_mapping: { Email: "email" },
      unmapped_required: ["name"],
      staged: importStaged,
    }),
    importOf({
      id: "imp-done", reference: "IMP-000204", status: "COMPLETED", step: "DONE",
      valid_rows: 2, invalid_rows: 1, skipped_rows: 0, imported_rows: 2,
      completed_at: "2026-09-08T09:05:00Z",
      // Finished, so it no longer holds the file — the rows became records.
      staged: [],
    }),
  );
}

seedImports();

export function resetImports(): void {
  seedImports();
}

/** The preview the detail endpoint builds, derived from the staged rows. */
function importDetail(row: Record<string, unknown>): Record<string, unknown> {
  const staged = (row["staged"] as Record<string, string>[] | undefined) ?? [];
  const mapping = row["column_mapping"] as Record<string, string>;
  const errors = row["errors"] as Array<Record<string, unknown>>;
  const structural = errors.filter((problem) => !problem["column"]);
  return {
    ...row,
    // On every read, as the service derives it: attaching it only to the
    // answer that created the run made the page's note vanish at the first
    // refetch.
    dialect: {
      delimiter: row["delimiter"],
      label: "comma",
      consistent: structural.length === 0,
      note: structural.length
        ? `Read as comma-separated, but ${structural.length} lines disagree about how many columns there are.`
        : `Read as comma-separated, ${(row["detected_columns"] as unknown[]).length} columns.`,
    },
    preview: staged.map((source, index) => ({
      // The header is line 1, so the first data row is 2 — the number
      // somebody needs to find it in the spreadsheet.
      line: index + 2,
      source,
      values: Object.fromEntries(
        Object.entries(mapping).map(([column, field]) => [field, source[column]]),
      ),
      problems: errors.filter((problem) => problem["line"] === index + 2),
    })),
    preview_total: staged.length,
  };
}

const importCatalogue = {
  targets: [
    {
      key: "customer",
      label: "Customers",
      description: "Accounts and their owners.",
      required: ["name"],
      fields: [
        { name: "name", label: "Name", kind: "text", required: true, choices: [],
          minimum: null, maximum: null, references: "" },
        { name: "email", label: "Email", kind: "text", required: false, choices: [],
          minimum: null, maximum: null, references: "" },
        { name: "segment", label: "Segment", kind: "enum", required: false,
          choices: ["SMB", "MID_MARKET", "ENTERPRISE"], minimum: null, maximum: null,
          references: "" },
      ],
    },
    {
      key: "project",
      label: "Projects",
      description: "Delivery work.",
      required: ["name"],
      fields: [
        { name: "name", label: "Name", kind: "text", required: true, choices: [],
          minimum: null, maximum: null, references: "" },
      ],
    },
  ],
  delimiters: [
    { key: ",", label: "comma" },
    { key: ";", label: "semicolon" },
    { key: "\t", label: "tab" },
    { key: "|", label: "pipe" },
  ],
  max_rows: 5000,
  max_bytes: 10 * 1024 * 1024,
  preview_rows: 50,
  open_limit: 5,
  open: 3,
  statuses: [
    { key: "DRAFT", count: 2 },
    { key: "VALIDATED", count: 1 },
    { key: "COMPLETED", count: 1 },
  ],
  steps: ["UPLOAD", "MAPPING", "PREVIEW", "EXECUTE", "DONE"],
  total: 4,
};


// ── Security (§41) ──────────────────────────────────────────────────────
//
// The states this page has to keep apart: the session you are reading from,
// a live one you have not recognised, one somebody signed out, and one that
// expired on its own. Plus a failed sign-in, because that is the row the
// page exists to show.
//
// Everything derived is derived the way `services/security.py` derives it —
// including `current`, which comes from the *request's* session rather than
// from a stored column, and `can_revoke`, which is true only of a live one.

export const sessionRows: Record<string, unknown>[] = [];
export const signInRows: Record<string, unknown>[] = [];
export const securityEventRows: Record<string, unknown>[] = [];

/** Which session the fixture's requests are "from". */
const CURRENT_SESSION = "sess-here";

function sessionOf(overrides: Record<string, unknown>): Record<string, unknown> {
  const row = {
    device: "Chrome",
    user_agent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0",
    ip_address: "198.51.100.4",
    location: "Bucharest, RO",
    trusted: false,
    signed_in_at: "2026-09-01T08:00:00Z",
    last_seen_at: "2026-09-08T09:00:00Z",
    expires_at: "2026-09-15T08:00:00Z",
    revoked_at: null,
    ...overrides,
  } as Record<string, unknown>;

  // Compared as *dates*, not as strings, and through `asText` rather than
  // `String` — the fifth time this file has been caught by
  // `no-base-to-string`, and the fifth time the answer was the helper it
  // already imports.
  const expiry = text(row["expires_at"]);
  row["state"] =
    row["revoked_at"] !== null
      ? "REVOKED"
      : expiry && new Date(expiry) <= new Date("2026-09-08T00:00:00Z")
        ? "EXPIRED"
        : "ACTIVE";
  row["current"] = row["id"] === CURRENT_SESSION;
  row["can_revoke"] = row["state"] === "ACTIVE";
  return row;
}

function seedSecurity(): void {
  sessionRows.length = 0;
  sessionRows.push(
    sessionOf({ id: CURRENT_SESSION, device: "Firefox", trusted: true }),
    // Live and not recognised: the row somebody scans for.
    sessionOf({ id: "sess-mobile", device: "Mobile", ip_address: "203.0.113.77" }),
    sessionOf({ id: "sess-gone", device: "Safari", revoked_at: "2026-09-05T10:00:00Z" }),
    // Expired on its own, which is not the same as signed out.
    sessionOf({ id: "sess-old", device: "Edge", expires_at: "2026-08-01T08:00:00Z" }),
  );

  signInRows.length = 0;
  signInRows.push(
    {
      id: "in-ok", result: "SUCCESS", reason: null, method: "SSO", device: "Firefox",
      ip_address: "198.51.100.4", location: "Bucharest, RO", at: "2026-09-08T09:00:00Z",
    },
    {
      id: "in-bad", result: "FAILURE", reason: "Wrong password", method: "PASSWORD",
      device: "Unknown", ip_address: "203.0.113.9", location: "Unknown",
      at: "2026-09-07T22:14:00Z",
    },
  );

  securityEventRows.length = 0;
  securityEventRows.push(
    {
      id: "ev-device", kind: "NEW_DEVICE_SIGN_IN", severity: "INFO",
      title: "Sign-in from a new device",
      description: "A device this account has not been seen on before.",
      ip_address: "203.0.113.77", resolved: false, at: "2026-09-07T22:20:00Z", details: {},
    },
    {
      id: "ev-travel", kind: "IMPOSSIBLE_TRAVEL", severity: "CRITICAL",
      title: "Sign-ins from distant locations in a short window",
      description: "Bucharest and São Paulo within eleven minutes.",
      ip_address: "203.0.113.9", resolved: false, at: "2026-09-07T22:25:00Z", details: {},
    },
    {
      id: "ev-done", kind: "MFA_ENABLED", severity: "INFO",
      title: "Two-factor authentication enabled", description: null,
      ip_address: "198.51.100.4", resolved: true, at: "2026-09-01T08:05:00Z", details: {},
    },
  );
}

seedSecurity();

export function resetSecurity(): void {
  seedSecurity();
}

/** Session counts, derived as the service derives them. */
function sessionList(): Record<string, unknown> {
  const active = sessionRows.filter((row) => row["state"] === "ACTIVE");
  return {
    items: sessionRows,
    total: sessionRows.length,
    active: active.length,
    others: active.filter((row) => !row["current"]).length,
    current_known: true,
  };
}

function securityOverview(): Record<string, unknown> {
  const failures = signInRows.filter((row) => row["result"] !== "SUCCESS");
  const unresolved = securityEventRows.filter((row) => !row["resolved"]);
  const list = sessionList();
  const lastSuccess = signInRows.find((row) => row["result"] === "SUCCESS");
  return {
    window_days: 90,
    active_sessions: list["active"],
    other_sessions: list["others"],
    current_known: true,
    failed_sign_ins: failures.length,
    // The threshold is the *server's*: three, from `FAILURES_WORTH_SAYING`.
    failures_worth_saying: failures.length >= 3,
    failure_addresses: [
      ...new Set(failures.map((row) => text(row["ip_address"]))),
    ].filter(Boolean),
    unresolved_events: unresolved.length,
    last_signed_in_at: lastSuccess ? lastSuccess["at"] : null,
    last_signed_in_from: lastSuccess ? lastSuccess["ip_address"] : null,
    last_signed_in_on: lastSuccess ? lastSuccess["device"] : null,
  };
}


// ── Favorites and recents (§38, §39) ────────────────────────────────────
//
// Bookmarks of three kinds, so the page can be seen to keep several — the
// old design could not put a report or a saved search here at all — plus a
// recents list where one entry is already kept and one is not, which is the
// pair the star column has to render differently.

export const bookmarkRows: Record<string, unknown>[] = [];
export const recentRows: Record<string, unknown>[] = [];

function seedFavorites(): void {
  bookmarkRows.length = 0;
  bookmarkRows.push(
    {
      id: "fav-ticket", resource_type: "ticket", resource_id: "t-1",
      label: "Printer on fire", url: "/tickets/t-1", icon: "life-buoy",
      position: 1, added_at: "2026-09-01T08:00:00Z",
    },
    {
      id: "fav-report", resource_type: "report", resource_id: "r-1",
      label: "Tickets by severity", url: "/reports/r-1", icon: "bar-chart",
      position: 2, added_at: "2026-09-02T08:00:00Z",
    },
    {
      id: "fav-search", resource_type: "saved_search", resource_id: "s-1",
      label: "Open, mine, this week", url: "/search/saved/s-1", icon: "search",
      position: 3, added_at: "2026-09-03T08:00:00Z",
    },
  );

  recentRows.length = 0;
  recentRows.push(
    {
      id: "rec-new", resource_type: "customer", resource_id: "c-9",
      label: "Globex", url: "/customers/c-9", icon: "building",
      visited_at: "2026-09-08T09:00:00Z", visit_count: 12, is_favorite: false,
    },
    {
      id: "rec-kept", resource_type: "ticket", resource_id: "t-1",
      label: "Printer on fire", url: "/tickets/t-1", icon: "life-buoy",
      visited_at: "2026-09-08T08:00:00Z", visit_count: 3, is_favorite: true,
    },
  );
}

seedFavorites();

export function resetFavorites(): void {
  seedFavorites();
}

/** Counts per kind, derived as the service derives them. */
function bookmarkList(): Record<string, unknown> {
  const kinds: Record<string, number> = {};
  for (const row of bookmarkRows) {
    const key = String(row["resource_type"]);
    kinds[key] = (kinds[key] ?? 0) + 1;
  }
  return {
    items: [...bookmarkRows].sort(
      (left, right) => Number(left["position"]) - Number(right["position"]),
    ),
    total: bookmarkRows.length,
    maximum: 100,
    kinds: Object.keys(kinds)
      .sort()
      .map((key) => ({ key, count: kinds[key] })),
    bookmarkable: [
      "board", "customer", "dashboard", "device", "order", "project",
      "report", "saved_search", "task", "ticket",
    ],
  };
}

function recentList(): Record<string, unknown> {
  // `is_favorite` derived from the bookmarks, as the service derives it: the
  // page must not have to ask per row.
  const starred = new Set(
    bookmarkRows.map((row) => `${String(row["resource_type"])}:${String(row["resource_id"])}`),
  );
  return {
    items: recentRows.map((row) => ({
      ...row,
      is_favorite: starred.has(
        `${String(row["resource_type"])}:${String(row["resource_id"])}`,
      ),
    })),
    total: recentRows.length,
    kept: 50,
  };
}

export const handlers = [
  http.get("/platform/admin/integrations/catalogue", ({ request }) => {
    const states = ["NOT_CONFIGURED", "DISCONNECTED", "CONNECTED", "ERROR"];
    return echo(request, {
      fields: [{ name: "name", label: "Name", kind: "text" }],
      default_columns: ["name", "category", "state", "last_connected_at"],
      categories: [
        "MESSAGING", "ISSUE_TRACKING", "SOURCE_CONTROL", "CRM", "PAYMENTS",
        "EMAIL", "STORAGE", "ANALYTICS", "ALERTING", "IDENTITY",
      ].map((key) => ({
        key,
        count: integrationRows.filter((row) => row["category"] === key).length,
      })),
      // Counted on the derived state, so the chips agree with the rows.
      states: states.map((key) => ({
        key,
        count: integrationRows.filter((row) => row["state"] === key).length,
      })),
      total: integrationRows.length,
      needing_attention: integrationRows.filter(
        (row) => row["enabled"] && row["state"] !== "CONNECTED",
      ).length,
      redacted: REDACTION,
    });
  }),
  http.put("/platform/admin/integrations/:id/enabled", async ({ params, request }) => {
    const row = integrationRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const wanted = Boolean(body["enabled"]);
    // The same refusal the service makes: switching on something that cannot
    // work produces a failure with no cause to find.
    if (wanted && (row["missing_settings"] as string[]).length > 0) {
      return HttpResponse.json(
        {
          error: "validation_error",
          message: `${text(row["name"])} still needs ${(row["missing_settings"] as string[]).join(", ")}.`,
          details: { missing_settings: row["missing_settings"] },
        },
        { status: 400 },
      );
    }
    row["enabled"] = wanted;
    if (!wanted) {
      row["status"] = "DISCONNECTED";
      row["state"] = "DISCONNECTED";
    }
    return echo(request, row);
  }),
  http.post("/platform/admin/integrations/:id/check", ({ params, request }) => {
    const row = integrationRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const missing = row["missing_settings"] as string[];
    return echo(request, {
      ...row,
      configured: missing.length === 0,
      missing_settings: missing,
      // Never true here, and never true in the service either.
      reached_provider: false,
      checked_at: "2026-09-08T10:00:00Z",
      note:
        missing.length === 0
          ? `Every required setting is present. This does not contact ${text(row["provider"])} — replace \`services/integrations.check\` with the provider's own ping to make it a real connection test.`
          : `${missing.join(", ")} must be set before ${text(row["provider"])} can be reached.`,
    });
  }),
  http.get("/platform/admin/integrations/:id", ({ params, request }) => {
    const row = integrationRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const configuration = row["configuration"] as Record<string, unknown>;
    return echo(request, {
      ...row,
      configuration: visibleConfiguration(row),
      redacted_settings: Object.keys(configuration)
        .filter((name) => /(secret|token|password|key|credential)/i.test(name) && configuration[name])
        .sort(),
    });
  }),
  http.put("/platform/admin/integrations/:id", async ({ params, request }) => {
    const index = integrationRows.findIndex((item) => item["id"] === String(params["id"]));
    if (index < 0) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const incoming = (body["configuration"] ?? {}) as Record<string, unknown>;
    const merged = { ...(integrationRows[index]!["configuration"] as Record<string, unknown>) };
    for (const [name, value] of Object.entries(incoming)) {
      // The redaction coming back means "leave it alone" — otherwise showing a
      // masked token once destroys it.
      if (value === REDACTION) continue;
      if (value === null || (typeof value === "string" && !value.trim())) delete merged[name];
      else merged[name] = value;
    }
    integrationRows[index] = integrationOf({ ...integrationRows[index], configuration: merged });
    return echo(request, {
      ...integrationRows[index],
      configuration: visibleConfiguration(integrationRows[index]),
      redacted_settings: Object.keys(merged)
        .filter((name) => /(secret|token|password|key|credential)/i.test(name) && merged[name])
        .sort(),
    });
  }),
  http.get("/platform/admin/integrations", ({ request }) => {
    const url = new URL(request.url);
    const term = (url.searchParams.get("q") ?? "").toLowerCase();
    const category = url.searchParams.get("category") ?? "";
    const matched = integrationRows.filter((row) => {
      if (category && row["category"] !== category) return false;
      if (!term) return true;
      return [row["name"], row["provider"]]
        .map((value) => text(value).toLowerCase())
        .join(" ")
        .includes(term);
    });
    return echo(request, {
      items: matched,
      total: matched.length,
      page: 1,
      page_size: 100,
      pages: 1,
      sort: "name",
      order: "asc",
      facets: {},
      columns: ["name", "category", "state", "last_connected_at"],
    });
  }),
  http.get("/platform/admin/api-clients/catalogue", ({ request }) =>
    echo(request, {
      fields: [{ name: "name", label: "Name", kind: "text" }],
      default_columns: ["name", "status", "scopes", "requests_total", "last_used_at"],
      statuses: ["ACTIVE", "SUSPENDED", "REVOKED"],
      scopes: [
        { code: "records.view", label: "View records" },
        { code: "records.update", label: "Edit records" },
        { code: "records.import", label: "Import records" },
        { code: "audit.view", label: "View the audit log" },
      ],
      // Two the caller cannot grant, so the form can say why they are absent.
      withheld_scopes: ["roles.manage", "users.impersonate"],
      rotation_grace_days: 7,
      total: apiClientRows.length,
    }),
  ),
  http.post("/platform/admin/api-clients/:id/rotate", async ({ params, request }) => {
    const id = String(params["id"]);
    const row = apiClientRows.find((item) => item["id"] === id);
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const replacingId = text(body["credential_id"]);

    const list = API_CREDENTIALS[id] ?? [];
    let replaced: Record<string, unknown> | null = null;
    if (replacingId) {
      replaced = list.find((item) => item["id"] === replacingId) ?? null;
      if (replaced) {
        // A deadline, not a death: the whole point of the grace period.
        replaced["expires_at"] = "2026-09-15T09:00:00Z";
      }
    }

    const { secret, prefix } = mintedSecret();
    const fresh = credential({
      id: `cred-${prefix}`, prefix, label: "Rotated",
      rotated_from_id: replaced ? String(replaced["id"]) : null,
    });
    list.unshift(fresh);
    API_CREDENTIALS[id] = list;
    row["credential_count"] = list.length;
    row["live_credentials"] = list.filter((item) => item["state"] === "ACTIVE").length;

    return HttpResponse.json(
      {
        credential: fresh,
        // Minted fresh each time and stored nowhere: the fixture has the same
        // property the service does.
        secret,
        secret_shown_once: true,
        replaced,
        grace_days: replaced ? 7 : null,
      },
      { status: 201 },
    );
  }),
  http.delete("/platform/admin/api-credentials/:id", ({ params, request }) => {
    const id = String(params["id"]);
    for (const [clientId, list] of Object.entries(API_CREDENTIALS)) {
      const found = list.find((item) => item["id"] === id);
      if (!found) continue;
      if (found["state"] === "REVOKED") {
        return HttpResponse.json(
          { error: "conflict", message: "That key was already revoked." },
          { status: 409 },
        );
      }
      found["state"] = "REVOKED";
      found["revoked_at"] = "2026-09-08T10:00:00Z";
      const row = apiClientRows.find((item) => item["id"] === clientId);
      if (row) {
        row["live_credentials"] = list.filter((item) => item["state"] === "ACTIVE").length;
      }
      return echo(request, found);
    }
    return HttpResponse.json({ message: "not found" }, { status: 404 });
  }),
  http.get("/platform/admin/api-clients/:id", ({ params, request }) => {
    const id = String(params["id"]);
    const row = apiClientRows.find((item) => item["id"] === id);
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const credentials = API_CREDENTIALS[id] ?? [];
    const requests = id === "cli-warehouse" ? API_REQUESTS : [];
    return echo(request, {
      ...row,
      credentials,
      recent_requests: requests,
      recent_window: requests.length,
      recent_failures: requests.filter((item) => item.status_code >= 400).length,
    });
  }),
  http.put("/platform/admin/api-clients/:id", async ({ params, request }) => {
    const row = apiClientRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    Object.assign(row, (await request.json()) as Record<string, unknown>);
    return echo(request, row);
  }),
  http.delete("/platform/admin/api-clients/:id", ({ params, request }) => {
    const id = String(params["id"]);
    const index = apiClientRows.findIndex((item) => item["id"] === id);
    if (index < 0) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const [row] = apiClientRows.splice(index, 1);
    const live = (API_CREDENTIALS[id] ?? []).filter((item) => item["state"] === "ACTIVE");
    for (const item of live) item["state"] = "REVOKED";
    return echo(request, {
      deleted: true,
      name: text(row!["name"]),
      credentials_revoked: live.length,
    });
  }),
  http.get("/platform/admin/api-clients", ({ request }) => {
    const url = new URL(request.url);
    const term = (url.searchParams.get("q") ?? "").toLowerCase();
    const matched = apiClientRows.filter((row) => {
      if (!term) return true;
      return [row["name"], row["client_id"]]
        .map((value) => text(value).toLowerCase())
        .join(" ")
        .includes(term);
    });
    return echo(request, {
      items: matched,
      total: matched.length,
      page: 1,
      page_size: 100,
      pages: 1,
      sort: "name",
      order: "asc",
      facets: {},
      columns: ["name", "status", "scopes", "requests_total", "last_used_at"],
    });
  }),
  http.post("/platform/admin/api-clients", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const { secret, prefix } = mintedSecret();
    const id = `cli-${prefix}`;
    const fresh = credential({ id: `cred-${prefix}`, prefix });
    const row = apiClient({
      id,
      name: text(body["name"]),
      client_id: `nuc-${prefix}`,
      scopes: Array.isArray(body["scopes"]) ? (body["scopes"] as string[]).sort() : [],
      credential_count: 1,
      live_credentials: 1,
    });
    apiClientRows.push(row);
    API_CREDENTIALS[id] = [fresh];
    return HttpResponse.json(
      { ...row, credential: fresh, secret, secret_shown_once: true },
      { status: 201 },
    );
  }),
  http.get("/platform/admin/organizations/catalogue", ({ request }) =>
    echo(request, {
      fields: [{ name: "name", label: "Name", kind: "text" }],
      default_columns: ["name", "tier", "industry", "country", "people"],
      tiers: ["TRIAL", "STARTER", "STANDARD", "ENTERPRISE"],
      statuses: ["ACTIVE", "SUSPENDED", "ARCHIVED"],
      regions: [
        { id: "reg-emea", name: "EMEA", code: "EMEA", timezone: "Europe/Amsterdam", currency: "EUR" },
        { id: "reg-amer", name: "Americas", code: "AMER", timezone: "America/New_York", currency: "USD" },
      ],
      max_depth: 4,
      total: orgRows.length,
      can_manage: orgsCanManage,
      // The reader's own tenant, so the page opens on theirs rather than on
      // whichever sorted first.
      own_organization_id: "org-northwind",
      industries: ["Logistics"],
    }),
  ),
  http.post("/platform/admin/organizations/:id/departments", async ({ params, request }) => {
    if (!orgsCanManage) return HttpResponse.json({ message: "forbidden" }, { status: 403 });
    const shape = ORG_TREES[String(params["id"])];
    if (!shape) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const code = text(body["code"]).toUpperCase();
    const node = {
      id: `dep-${code}`, name: text(body["name"]), code,
      description: null, cost_center: null,
      parent_id: (body["parent_id"] as string | null) ?? null,
      manager: null, depth: 0, people: 0, people_in_subtree: 0,
      teams: [], children: [],
    };
    const parentId = node.parent_id;
    if (parentId) {
      const attach = (list: Array<Record<string, unknown>>): boolean => {
        for (const item of list) {
          if (item["id"] === parentId) {
            node.depth = Number(item["depth"]) + 1;
            (item["children"] as Array<unknown>).push(node);
            return true;
          }
          if (attach(item["children"] as Array<Record<string, unknown>>)) return true;
        }
        return false;
      };
      attach(shape["departments"] as Array<Record<string, unknown>>);
    } else {
      (shape["departments"] as Array<unknown>).push(node);
    }
    return HttpResponse.json(node, { status: 201 });
  }),
  http.put("/platform/admin/departments/:id", async ({ params, request }) => {
    if (!orgsCanManage) return HttpResponse.json({ message: "forbidden" }, { status: 403 });
    const body = (await request.json()) as Record<string, unknown>;
    const id = String(params["id"]);
    // The cycle the server refuses, refused here too — a fixture that allowed
    // it would let the page ship a control that corrupts the tree.
    let found: Record<string, unknown> | null = null;
    const find = (list: Array<Record<string, unknown>>): void => {
      for (const item of list) {
        if (item["id"] === id) found = item;
        find(item["children"] as Array<Record<string, unknown>>);
      }
    };
    for (const shape of Object.values(ORG_TREES)) {
      find(shape["departments"] as Array<Record<string, unknown>>);
    }
    if (!found) return HttpResponse.json({ message: "not found" }, { status: 404 });
    if (body["parent_id"] === id) {
      return HttpResponse.json(
        { error: "conflict", message: "It cannot sit inside itself." },
        { status: 409 },
      );
    }
    const node = found as Record<string, unknown>;
    return echo(request, {
      id,
      name: String(node["name"]),
      code: String(node["code"]),
      parent_id: (body["parent_id"] as string | null) ?? null,
    });
  }),
  http.delete("/platform/admin/departments/:id", ({ params, request }) => {
    if (!orgsCanManage) return HttpResponse.json({ message: "forbidden" }, { status: 403 });
    const id = String(params["id"]);
    // `dep-eng` has people, teams and children: the refusal the page must
    // relay rather than swallow.
    if (id === "dep-eng") {
      return HttpResponse.json(
        {
          error: "conflict",
          message: "Engineering still has 2 people, 1 team, 1 sub-department. Move them first.",
        },
        { status: 409 },
      );
    }
    for (const shape of Object.values(ORG_TREES)) {
      const prune = (list: Array<Record<string, unknown>>): void => {
        const index = list.findIndex((item) => item["id"] === id);
        if (index >= 0) {
          list.splice(index, 1);
          return;
        }
        for (const item of list) prune(item["children"] as Array<Record<string, unknown>>);
      };
      prune(shape["departments"] as Array<Record<string, unknown>>);
    }
    return echo(request, { deleted: true, name: "Retired department" });
  }),
  http.get("/platform/admin/organizations/:id", ({ params, request }) => {
    const row = orgRows.find((item) => item["id"] === String(params["id"]));
    const shape = ORG_TREES[String(params["id"])];
    if (!row || !shape) return HttpResponse.json({ message: "not found" }, { status: 404 });
    return echo(request, {
      organization: orgsCanManage ? { ...row, annual_revenue: 12_400_000 } : row,
      ...shape,
      max_depth: 4,
      can_manage: orgsCanManage,
    });
  }),
  http.put("/platform/admin/organizations/:id", async ({ params, request }) => {
    if (!orgsCanManage) return HttpResponse.json({ message: "forbidden" }, { status: 403 });
    const row = orgRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    Object.assign(row, (await request.json()) as Record<string, unknown>);
    return echo(request, row);
  }),
  http.get("/platform/admin/organizations", ({ request }) =>
    echo(request, {
      // `annual_revenue` present only for a reader who may manage — mirroring
      // the service, so the page's guard is exercised rather than assumed.
      items: orgRows.map((row) =>
        orgsCanManage ? { ...row, annual_revenue: 12_400_000 } : row,
      ),
      total: orgRows.length,
      page: 1,
      page_size: 100,
      pages: 1,
      sort: "name",
      order: "asc",
      facets: {
        tier: [...new Set(orgRows.map((row) => String(row["tier"])))].map((value) => ({
          value,
          count: orgRows.filter((row) => row["tier"] === value).length,
        })),
      },
      columns: ["name", "tier", "industry", "country", "people"],
      can_manage: orgsCanManage,
    }),
  ),
  http.get("/platform/admin/groups/catalogue", ({ request }) =>
    echo(request, {
      fields: [
        { name: "name", label: "Name", kind: "text" },
        { name: "kind", label: "Kind", kind: "enum" },
      ],
      default_columns: ["name", "kind", "permissions", "members"],
      kinds: GROUP_KINDS.map((key) => ({
        key,
        count: groupRows.filter((row) => row["kind"] === key).length,
      })),
      // A slice of the real catalogue, enough to prove the editor renders from
      // it rather than from a list of its own.
      permissions: [
        { code: "audit.view", label: "View the audit log" },
        { code: "records.export", label: "Export records" },
        { code: "records.import", label: "Import records" },
        { code: "logs.view", label: "View system logs" },
        { code: "jobs.manage", label: "Retry and cancel jobs" },
        { code: "health.view", label: "View system health" },
        { code: "roles.manage", label: "Manage roles and permissions" },
      ],
      total: groupRows.length,
      can_manage_members: groupsCanMembers,
      can_manage_grants: groupsCanGrants,
    }),
  ),
  http.put("/platform/admin/groups/:id/members", async ({ params, request }) => {
    if (!groupsCanMembers) {
      return HttpResponse.json({ message: "forbidden" }, { status: 403 });
    }
    const row = groupRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const ids = Array.isArray(body["user_ids"]) ? (body["user_ids"] as string[]) : [];
    const before = (GROUP_MEMBERS[String(params["id"])] ?? []).map((p) => String(p["id"]));
    GROUP_MEMBERS[String(params["id"])] = ids.map((id) => ({
      id, full_name: `Person ${id}`, initials: "PP", email: `${id}@nucleus.local`,
      username: id, avatar_url: null, status: "ACTIVE", role_code: "VIEWER",
      job_title: null,
    }));
    row["member_count"] = ids.length;
    return echo(request, {
      ...row,
      added: ids.filter((id) => !before.includes(id)).length,
      removed: before.filter((id) => !ids.includes(id)).length,
    });
  }),
  http.put("/platform/admin/groups/:id/grants", async ({ params, request }) => {
    // The privilege the page must respect, enforced here so a page that drew
    // the editor without it fails in the component test.
    if (!groupsCanGrants) {
      return HttpResponse.json({ message: "forbidden" }, { status: 403 });
    }
    const row = groupRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const wanted = Array.isArray(body["permissions"])
      ? [...new Set(body["permissions"] as string[])].sort()
      : [];
    const before = (row["permissions"] as string[]) ?? [];
    row["permissions"] = wanted;
    return echo(request, {
      ...row,
      added: wanted.filter((code) => !before.includes(code)),
      removed: before.filter((code) => !wanted.includes(code)),
    });
  }),
  http.get("/platform/admin/groups/:id", ({ params, request }) => {
    const row = groupRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const members = GROUP_MEMBERS[String(params["id"])] ?? [];
    return echo(request, { ...row, members, member_overflow: 0 });
  }),
  http.put("/platform/admin/groups/:id", async ({ params, request }) => {
    const row = groupRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    if ("permissions" in body) {
      return HttpResponse.json(
        {
          error: "validation_error",
          message: "What a group grants is changed on its own, and needs `roles.manage`.",
        },
        { status: 400 },
      );
    }
    Object.assign(row, body);
    return echo(request, row);
  }),
  http.delete("/platform/admin/groups/:id", ({ params, request }) => {
    const index = groupRows.findIndex((item) => item["id"] === String(params["id"]));
    if (index < 0) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const [row] = groupRows.splice(index, 1);
    return echo(request, {
      deleted: true,
      name: String(row!["name"]),
      members_affected: Number(row!["member_count"]),
      permissions_withdrawn: (row!["permissions"] as string[]) ?? [],
    });
  }),
  http.get("/platform/admin/groups", ({ request }) => {
    const url = new URL(request.url);
    const term = (url.searchParams.get("q") ?? "").toLowerCase();
    const wantedKind = url.searchParams.get("kind") ?? "";
    const matched = groupRows.filter((row) => {
      if (wantedKind && String(row["kind"]) !== wantedKind) return false;
      if (term) {
        const haystack = [row["name"], row["description"], row["slug"]]
          .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
          .join(" ");
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
    return echo(request, {
      items: matched,
      total: matched.length,
      page: 1,
      page_size: 100,
      pages: 1,
      sort: "name",
      order: "asc",
      facets: {
        kind: GROUP_KINDS.map((value) => ({
          value,
          count: groupRows.filter((row) => row["kind"] === value).length,
        })),
      },
      columns: ["name", "kind", "permissions", "members"],
      can_manage_members: groupsCanMembers,
      can_manage_grants: groupsCanGrants,
    });
  }),
  http.post("/platform/admin/groups", async ({ request }) => {
    if (!groupsCanMembers) {
      return HttpResponse.json({ message: "forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body["name"] === "string" ? body["name"] : "";
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const row = group({
      id: `grp-${slug}`,
      name,
      slug,
      kind: typeof body["kind"] === "string" ? body["kind"] : "TEAM",
      description: typeof body["description"] === "string" ? body["description"] : null,
      // Never on creation, whatever was sent — the same rule the service has.
      permissions: [],
    });
    groupRows.push(row);
    GROUP_MEMBERS[String(row["id"])] = [];
    return HttpResponse.json(row, { status: 201 });
  }),
  http.get("/platform/admin/jobs/catalogue", ({ request }) =>
    echo(request, {
      fields: [
        { name: "status", label: "Status", kind: "enum" },
        { name: "kind", label: "Kind", kind: "enum" },
        { name: "queue", label: "Queue", kind: "enum" },
      ],
      default_columns: ["created_at", "reference", "name", "status", "progress", "attempt"],
      default_sort: "created_at",
      statuses: JOB_STATUSES.map((key) => ({
        key,
        count: jobRows.filter((row) => row["status"] === key).length,
      })),
      kinds: ["EXPORT", "IMPORT", "REPORT", "EMAIL", "MAINTENANCE", "SYNC", "REINDEX"],
      total: jobRows.length,
      can_manage: jobsCanManage,
    }),
  ),
  http.post("/platform/admin/jobs/:id/retry", ({ params, request }) => {
    const row = jobRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    // The fixture enforces the same rules, so a page that drew a button the
    // server refuses fails here rather than only in the end-to-end suite.
    if (!row["can_retry"]) {
      return HttpResponse.json(
        { error: "conflict", message: `${String(row["reference"])} cannot be retried.` },
        { status: 409 },
      );
    }
    row["attempt"] = Number(row["attempt"]) + 1;
    row["status"] = "QUEUED";
    row["progress"] = 0;
    row["error_message"] = null;
    row["finished_at"] = null;
    row["can_retry"] = false;
    row["can_cancel"] = true;
    return echo(request, row);
  }),
  http.put("/platform/admin/jobs/:id/attempts", async ({ params, request }) => {
    const row = jobRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const wanted = Number(body["max_attempts"]);
    // The same two rules the service applies: upward only, and bounded.
    if (wanted <= Number(row["max_attempts"]) || wanted > 10) {
      return HttpResponse.json(
        { error: "validation_error", message: "That grant was refused." },
        { status: 400 },
      );
    }
    row["max_attempts"] = wanted;
    row["can_retry"] =
      JOB_TERMINAL.includes(String(row["status"])) &&
      Number(row["attempt"]) < wanted;
    row["can_allow_attempts"] = false;
    return echo(request, row);
  }),
  http.post("/platform/admin/jobs/:id/cancel", ({ params, request }) => {
    const row = jobRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    if (!row["can_cancel"]) {
      return HttpResponse.json(
        { error: "conflict", message: `${String(row["reference"])} already finished.` },
        { status: 409 },
      );
    }
    row["status"] = "CANCELLED";
    row["finished_at"] = "2026-09-08T09:30:00Z";
    row["duration_ms"] = 1800000;
    row["can_cancel"] = false;
    row["can_retry"] = Number(row["attempt"]) < Number(row["max_attempts"]);
    return echo(request, row);
  }),
  http.get("/platform/admin/jobs/:id", ({ params, request }) => {
    const row = jobRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    return echo(request, {
      ...row,
      payload: { entity: "order", format: "csv" },
      result: row["status"] === "SUCCEEDED" ? { rows: 100, artifact: "exports/x.csv" } : null,
      log_lines: [
        { at: "2026-09-08T09:00:00Z", level: "INFO", message: "job accepted" },
        { at: "2026-09-08T09:00:02Z", level: "INFO", message: "processing 100 units" },
        // Narrowed rather than stringified: these rows are
        // `Record<string, unknown>`, and `String(anObject)` renders
        // "[object Object]" into a fixture the tests then assert against.
        ...(typeof row["error_message"] === "string"
          ? [{ at: "2026-09-08T09:00:09Z", level: "ERROR", message: row["error_message"] }]
          : []),
      ],
      log_truncated: false,
      scheduled_task_id: null,
      correlation_hint: String(row["reference"]),
    });
  }),
  http.get("/platform/admin/jobs", ({ request }) => {
    const url = new URL(request.url);
    const matched = matchingJobs(url);
    return echo(request, {
      items: matched,
      total: matched.length,
      page: 1,
      page_size: 25,
      pages: 1,
      sort: "created_at",
      order: "desc",
      facets: {
        queue: [...new Set(jobRows.map((row) => String(row["queue"])))].map((value) => ({
          value,
          count: jobRows.filter((row) => row["queue"] === value).length,
        })),
      },
      columns: ["created_at", "reference", "name", "status", "progress", "attempt"],
      can_manage: jobsCanManage,
    });
  }),
  http.get("/platform/admin/logs/catalogue", ({ request }) =>
    echo(request, {
      fields: [
        { name: "level", label: "Level", kind: "enum" },
        { name: "service", label: "Service", kind: "enum" },
        { name: "logger", label: "Logger", kind: "enum" },
        { name: "correlation_id", label: "Correlation ID", kind: "text" },
        { name: "status_code", label: "Status", kind: "number" },
      ],
      default_columns: ["logged_at", "level", "service", "logger", "message"],
      default_sort: "logged_at",
      // Every level, including CRITICAL at nought — the page must still offer
      // it, which is what `test_the_catalogue_offers_every_level` asserts on
      // the server and the component test asserts here.
      levels: LOG_LEVELS.map((key) => ({
        key,
        count: logRows.filter((row) => row["level"] === key).length,
      })),
      retention_days: 30,
      total: logRows.length,
    }),
  ),
  http.get("/platform/admin/logs/tail", ({ request }) => {
    const url = new URL(request.url);
    const matched = matchingLogs(url);
    // Oldest first, as the server sends it.
    const ordered = [...matched].sort((left, right) =>
      String(left["logged_at"]).localeCompare(String(right["logged_at"])),
    );
    const after = url.searchParams.get("after");
    const from = after ? ordered.findIndex((row) => row["id"] === after) + 1 : 0;
    const items = after ? ordered.slice(from) : ordered;
    return echo(request, {
      items,
      cursor: items.length > 0 ? items[items.length - 1]!["id"] : after,
      more: false,
    });
  }),
  http.post("/platform/admin/logs/prune", ({ request }) =>
    echo(request, { removed: 4, retention_days: 30, kept: logRows.length }),
  ),
  http.get("/platform/admin/logs/:id", ({ params, request }) => {
    const row = logRows.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const correlation = row["correlation_id"];
    return echo(request, {
      ...row,
      context: { method: "GET", path: "/platform/api/me", route: "/api/me" },
      stack_trace: row["has_stack_trace"]
        ? "Traceback (most recent call last):\n  File \"src/api/records.py\", line 88\n    raise"
        : null,
      span_id: null,
      related: logRows.filter(
        (item) => item["id"] !== row["id"] && item["correlation_id"] === correlation,
      ),
    });
  }),
  http.get("/platform/admin/logs", ({ request }) => {
    const url = new URL(request.url);
    const matched = byNewest(matchingLogs(url));
    const facets = {
      service: [...new Set(logRows.map((row) => String(row["service"])))].map((value) => ({
        value,
        count: logRows.filter((row) => row["service"] === value).length,
      })),
    };
    return echo(request, {
      items: matched,
      total: matched.length,
      page: 1,
      page_size: 50,
      pages: 1,
      sort: "logged_at",
      order: "desc",
      facets,
      columns: ["logged_at", "level", "service", "logger", "message"],
    });
  }),
  http.get("/platform/admin/settings", ({ request }) => echo(request, settingsPage())),
  http.put("/platform/admin/settings/:key", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const row = settingRows.find((item) => item["key"] === String(params["key"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    if (body["reset"]) {
      row["value"] = row["default"];
      row["changed"] = false;
    } else {
      row["value"] = body["value"];
      row["changed"] = body["value"] !== row["default"];
    }
    return echo(request, row);
  }),
  http.get("/platform/admin/flags", ({ request }) => {
    const state = new URL(request.url).searchParams.get("state") ?? "";
    const items = flagRows.filter((item) =>
      state === "ON" ? item["enabled"] : state === "OFF" ? !item["enabled"] : true,
    );
    return echo(request, {
      items,
      total: items.length,
      counts: {
        total: flagRows.length,
        on: flagRows.filter((item) => item["enabled"]).length,
        partial: flagRows.filter((item) => item["partial"]).length,
        experimental: flagRows.filter((item) => item["experimental"]).length,
      },
      stages: ["BETA", "GA"],
    });
  }),
  http.post("/platform/admin/flags", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    // Off, whatever was asked for — the server's rule.
    const created = flag({ key: text(body["key"]), name: text(body["name"]), enabled: false });
    flagRows.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.put("/platform/admin/flags/:key", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const row = flagRows.find((item) => item["key"] === String(params["key"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    Object.assign(row, body);
    const percentage = Number(row["rollout_percentage"]);
    row["partial"] = Boolean(row["enabled"]) && percentage > 0 && percentage < 100;
    return echo(request, row);
  }),
  http.delete("/platform/admin/flags/:key", ({ params, request }) => {
    const at = flagRows.findIndex((item) => item["key"] === String(params["key"]));
    const row = flagRows[at];
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    if (row["enabled"]) {
      return HttpResponse.json({ message: "Turn it off first" }, { status: 409 });
    }
    flagRows.splice(at, 1);
    return echo(request, { deleted: true, key: row["key"] });
  }),
  http.get("/platform/api/mail/templates", ({ request }) =>
    echo(request, {
      items: [
        {
          code: "sla-breach",
          name: "SLA breach notice",
          description: "For a ticket that has run out of time.",
          category: "TRANSACTIONAL",
          subject: "About your ticket",
          body: "Dear {{ name }}, we are on it.",
          variables: ["name"],
        },
      ],
      total: 1,
    }),
  ),
  http.post("/platform/api/mail/templates", async ({ request }) => {
    const body = (await request.json()) as { code?: string; variables?: Record<string, string> };
    const known = body.variables ?? {};
    const fill = (text: string) =>
      text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) => known[name] ?? whole);
    return echo(request, {
      code: body.code ?? "",
      subject: fill("About your ticket"),
      body: fill("Dear {{ name }}, we are on it."),
      unfilled: "name" in known ? [] : ["name"],
    });
  }),
  http.post("/platform/api/mail/threads/bulk", async ({ request }) => {
    const body = (await request.json()) as {
      ids?: string[];
      action?: string;
      folder?: string;
      label?: string;
    };
    const chosen = mailThreads.filter((item) => (body.ids ?? []).includes(String(item["id"])));
    for (const thread of chosen) {
      if (body.action === "READ") thread["unread_count"] = 0;
      if (body.action === "UNREAD") thread["unread_count"] = 1;
      if (body.action === "STAR") thread["is_starred"] = true;
      if (body.action === "UNSTAR") thread["is_starred"] = false;
      if (body.action === "MOVE") thread["folder"] = body.folder;
      if (body.action === "LABEL") {
        thread["labels"] = [...new Set([...(thread["labels"] as string[]), body.label!])];
      }
    }
    return echo(request, { changed: chosen.length, action: body.action });
  }),
  http.get("/platform/api/mail/threads", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const folder = query.get("folder") ?? "INBOX";
    const term = (query.get("q") ?? "").toLowerCase();
    const label = query.get("label") ?? "";
    const items = mailThreads.filter(
      (item) =>
        item["folder"] === folder &&
        (!term || String(item["subject"]).toLowerCase().includes(term)) &&
        (!label || (item["labels"] as string[]).includes(label)) &&
        (query.get("starred") !== "1" || item["is_starred"]) &&
        (query.get("unread") !== "1" || Number(item["unread_count"]) > 0),
    );
    const folders = [
      "INBOX", "OUTBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH",
    ].map((key) => {
      const own = mailThreads.filter((item) => item["folder"] === key);
      return {
        key,
        total: own.length,
        unread: own.reduce((sum, item) => sum + Number(item["unread_count"]), 0),
      };
    });
    const labels: Record<string, number> = {};
    for (const item of mailThreads.filter((entry) => entry["folder"] === folder)) {
      for (const key of item["labels"] as string[]) labels[key] = (labels[key] ?? 0) + 1;
    }
    return echo(request, {
      items,
      total: items.length,
      page: 1,
      page_size: 40,
      pages: 1,
      sort: "last_message_at",
      order: "desc",
      folder,
      folders,
      labels: Object.entries(labels).map(([key, count]) => ({ key, count })),
      priorities: ["LOW", "NORMAL", "HIGH"],
      movable: ["INBOX", "ARCHIVE", "SPAM", "TRASH"],
    });
  }),
  http.get("/platform/api/mail/threads/:id", ({ params, request }) => {
    const row = mailThreads.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    // Reading marks it read, exactly as the server does — which is what makes
    // the list's refetch worth asserting.
    if (new URL(request.url).searchParams.get("peek") !== "1") {
      row["unread_count"] = 0;
      for (const message of row["messages"] as Record<string, unknown>[]) {
        message["is_read"] = true;
      }
    }
    return echo(request, row);
  }),
  http.put("/platform/api/mail/threads/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const row = mailThreads.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    Object.assign(row, body);
    return echo(request, row);
  }),
  http.delete("/platform/api/mail/threads/:id", ({ params, request }) => {
    const row = mailThreads.find((item) => item["id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    if (row["folder"] === "TRASH") {
      mailThreads.splice(mailThreads.indexOf(row), 1);
      return echo(request, { deleted: true, folder: "TRASH", id: String(params["id"]) });
    }
    row["folder"] = "TRASH";
    return echo(request, { deleted: false, folder: "TRASH", id: String(params["id"]) });
  }),
  http.post("/platform/api/mail/messages", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const send = Boolean(body["send"]);
    // Narrowed rather than stringified: `Record<string, unknown>` makes
    // `String(x)` render an object as "[object Object]", which is a fixture
    // that silently answers nonsense.
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const created = mailThread({
      id: `thread-${mailThreads.length + 1}`,
      subject: text(body["subject"]),
      folder: send ? "OUTBOX" : "DRAFTS",
      has_draft: !send,
      messages: [
        mailMessage({
          id: `msg-${mailThreads.length + 1}`,
          subject: text(body["subject"]),
          body: text(body["body"]),
          folder: send ? "OUTBOX" : "DRAFTS",
          is_draft: !send,
          sent_at: send ? "2026-09-08T09:00:00Z" : null,
        }),
      ],
    });
    mailThreads.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.put("/platform/api/mail/messages/:id", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const row = mailThreads.find((item) =>
      (item["messages"] as Record<string, unknown>[]).some(
        (message) => message["is_draft"],
      ),
    );
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const draft = (row["messages"] as Record<string, unknown>[]).find(
      (message) => message["is_draft"],
    )!;
    if (body["subject"]) draft["subject"] = body["subject"];
    if (body["body"]) draft["body"] = body["body"];
    if (body["send"]) {
      draft["is_draft"] = false;
      draft["folder"] = "OUTBOX";
      row["folder"] = "OUTBOX";
      row["has_draft"] = false;
    }
    return echo(request, row);
  }),
  http.delete("/platform/api/mail/messages/:id", ({ request }) => {
    const at = mailThreads.findIndex((item) => item["has_draft"]);
    if (at >= 0) mailThreads.splice(at, 1);
    return echo(request, { deleted: true, id: "discarded" });
  }),
  http.get("/platform/api/calendar/events", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const category = query.get("category") ?? "";
    const mine = query.get("mine") === "1";
    const items = calendarEvents.filter(
      (item) =>
        (!category || item["category"] === category) && (!mine || item["involves_me"]),
    );
    const byCategory: Record<string, number> = {};
    for (const item of items) {
      const key = String(item["category"]);
      byCategory[key] = (byCategory[key] ?? 0) + 1;
    }
    return echo(request, {
      from: query.get("from") ?? "",
      to: query.get("to") ?? "",
      items,
      total: items.length,
      counts: {
        total: items.length,
        mine: items.filter((item) => item["involves_me"]).length,
        awaiting_response: items.filter((item) => item["my_response"] === "NEEDS_ACTION")
          .length,
        by_category: byCategory,
      },
      categories: ["MEETING", "REVIEW", "DEADLINE", "TRAINING", "MAINTENANCE", "HOLIDAY"],
      statuses: ["CONFIRMED", "TENTATIVE", "CANCELLED"],
      responses: ["NEEDS_ACTION", "ACCEPTED", "TENTATIVE", "DECLINED"],
      can_manage: true,
    });
  }),
  http.get("/platform/api/calendar/events/:id", ({ params, request }) => {
    const row = calendarEvents.find((item) => item["event_id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    return echo(request, row);
  }),
  http.post("/platform/api/calendar/events", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = occurrence({
      ...body,
      id: `event-${calendarEvents.length + 1}:new`,
      event_id: `event-${calendarEvents.length + 1}`,
    });
    calendarEvents.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.put("/platform/api/calendar/events/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const row = calendarEvents.find((item) => item["event_id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    Object.assign(row, body);
    return echo(request, row);
  }),
  http.delete("/platform/api/calendar/events/:id", ({ params, request }) => {
    const at = calendarEvents.findIndex((item) => item["event_id"] === String(params["id"]));
    if (at >= 0) calendarEvents.splice(at, 1);
    return echo(request, { deleted: true, id: String(params["id"]) });
  }),
  http.post("/platform/api/calendar/events/:id/respond", async ({ params, request }) => {
    const body = (await request.json()) as { response?: string };
    const row = calendarEvents.find((item) => item["event_id"] === String(params["id"]));
    if (!row) return HttpResponse.json({ message: "not found" }, { status: 404 });
    row["my_response"] = body.response;
    return echo(request, row);
  }),
  http.get("/platform/api/automations/catalog", ({ request }) =>
    echo(request, {
      resources: [
        { key: "task", label: "Tasks", path: "/tasks" },
        { key: "ticket", label: "Tickets", path: "/tickets" },
      ],
      roles: [
        { code: "ADMINISTRATOR", name: "Administrator" },
        { code: "MANAGER", name: "Manager" },
      ],
      actions: [
        {
          kind: "NOTIFY", label: "Notify people",
          description: "An in-app notification.", needs: ["recipients"],
        },
        {
          kind: "EMAIL", label: "Send an email",
          description: "Queued into the mailbox.", needs: ["recipients"],
        },
        { kind: "TASK", label: "Raise a task", description: "In the normal queue.", needs: [] },
        {
          kind: "WEBHOOK", label: "Call a webhook",
          description: "One POST.", needs: ["url"],
        },
      ],
      severities: ["INFO", "WARNING", "CRITICAL"],
      priorities: ["LOW", "NORMAL", "HIGH", "CRITICAL"],
      limits: { max_matches: 500, max_fires: 50, max_rules: 200 },
    }),
  ),
  http.get("/platform/api/automations/rules", ({ request }) => {
    const state = new URL(request.url).searchParams.get("state") ?? "";
    const items = automationRules.filter((item) =>
      state === "ENABLED" ? item["enabled"] : state === "PAUSED" ? !item["enabled"] : true,
    );
    return echo(request, {
      items,
      total: items.length,
      counts: {
        total: automationRules.length,
        enabled: automationRules.filter((item) => item["enabled"]).length,
        fires: 15,
      },
      can_manage: true,
    });
  }),
  http.post("/platform/api/automations/rules", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = automation({
      ...body,
      id: `rule-${automationRules.length + 1}`,
      trigger_count: 0,
      last_triggered_at: null,
    });
    automationRules.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get("/platform/api/automations/rules/:id", ({ params, request }) => {
    const rule = automationRules.find((item) => item["id"] === String(params["id"]));
    if (!rule) return HttpResponse.json({ message: "not found" }, { status: 404 });
    return echo(request, {
      ...rule,
      runs: [automationRun(String(params["id"]), false)],
      cooling_down:
        rule["cooldown_minutes"] === 0
          ? []
          : [
              {
                record_id: "task-2",
                record: "TSK-00002 Chase the invoice",
                last_fired_at: "2026-09-08T08:30:00Z",
                until: "2026-09-08T09:30:00Z",
                fire_count: 2,
              },
            ],
    });
  }),
  http.put("/platform/api/automations/rules/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const rule = automationRules.find((item) => item["id"] === String(params["id"]));
    if (!rule) return HttpResponse.json({ message: "not found" }, { status: 404 });
    Object.assign(rule, body);
    return echo(request, rule);
  }),
  http.delete("/platform/api/automations/rules/:id", ({ params, request }) => {
    const at = automationRules.findIndex((item) => item["id"] === String(params["id"]));
    if (at >= 0) automationRules.splice(at, 1);
    return echo(request, { deleted: true, id: String(params["id"]) });
  }),
  http.post("/platform/api/automations/rules/:id/run", async ({ params, request }) => {
    const body = (await request.json()) as { dry_run?: boolean };
    return echo(request, automationRun(String(params["id"]), body.dry_run !== false));
  }),
  http.get("/platform/api/automations/rules/:id/runs", ({ params, request }) =>
    echo(request, { items: [automationRun(String(params["id"]), false)], total: 1 }),
  ),
  http.get("/platform/api/kanban/boards", ({ request }) =>
    echo(request, {
      items: kanbanBoards,
      total: kanbanBoards.length,
      can_create: true,
      kinds: [
        { key: "EPIC", children: ["STORY"] },
        { key: "STORY", children: ["TASK", "BUG"] },
        { key: "TASK", children: [] },
        { key: "BUG", children: [] },
      ],
      priorities: ["LOW", "NORMAL", "HIGH", "CRITICAL"],
    }),
  ),
  http.post("/platform/api/kanban/boards", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      ...kanbanBoards[0],
      ...body,
      id: `board-${kanbanBoards.length + 1}`,
      key: "NEW",
      lane_count: 5,
      card_count: 0,
    };
    kanbanBoards.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get("/platform/api/kanban/boards/:id", ({ params, request }) =>
    echo(request, kanbanDetail(String(params["id"]), new URL(request.url).searchParams)),
  ),
  http.post("/platform/api/kanban/boards/:id/cards", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = card({
      ...body,
      id: `card-${kanbanCards.length + 1}`,
      reference: `PLAT-0000${kanbanCards.length + 1}`,
      board_id: String(params["id"]),
    });
    kanbanCards.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post("/platform/api/kanban/cards/:id/move", async ({ params, request }) => {
    const body = (await request.json()) as { lane_id: string; position: number };
    const moving = kanbanCards.find((item) => item["id"] === params["id"]);
    if (!moving) return new HttpResponse(null, { status: 404 });
    moving["lane_id"] = body.lane_id;
    moving["position"] = body.position;
    // The completion follows the lane, as the service does it: a board whose
    // `completed_at` disagreed with its columns would report a different
    // number from the one on screen.
    const lane = kanbanLanes.find((item) => item["id"] === body.lane_id);
    moving["completed_at"] = lane?.["is_done"] ? "2026-09-08T09:00:00Z" : null;
    return echo(request, moving);
  }),
  http.get("/platform/api/kanban/cards/:id", ({ params, request }) => {
    const found = kanbanCards.find((item) => item["id"] === params["id"]);
    if (!found) return new HttpResponse(null, { status: 404 });
    const parent = kanbanCards.find((item) => item["id"] === found["parent_id"]);
    return echo(request, {
      ...found,
      board: kanbanBoards[0],
      lanes: kanbanLanes.map((lane) => ({
        id: lane["id"],
        name: lane["name"],
        is_done: lane["is_done"],
      })),
      parent: parent ?? null,
      children: kanbanCards.filter((item) => item["parent_id"] === found["id"]),
      // The server's hierarchy rule, so the picker cannot offer a pairing the
      // write would refuse.
      parent_options:
        found["kind"] === "STORY"
          ? kanbanCards.filter((item) => item["kind"] === "EPIC")
          : found["kind"] === "TASK" || found["kind"] === "BUG"
            ? kanbanCards.filter((item) => item["kind"] === "STORY")
            : [],
      can_edit: true,
    });
  }),
  http.put("/platform/api/kanban/cards/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const found = kanbanCards.find((item) => item["id"] === params["id"]);
    if (!found) return new HttpResponse(null, { status: 404 });
    Object.assign(found, body);
    if (Array.isArray(body["checklist"])) {
      found["checklist_done"] = (body["checklist"] as { done: boolean }[]).filter(
        (item) => item.done,
      ).length;
    }
    return echo(request, found);
  }),
  http.delete("/platform/api/kanban/cards/:id", ({ params, request }) => {
    const index = kanbanCards.findIndex((item) => item["id"] === params["id"]);
    if (index >= 0) kanbanCards.splice(index, 1);
    return echo(request, { id: params["id"], deleted: true, reparented: 0 });
  }),
  http.post("/platform/api/kanban/boards/:id/lanes", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      id: `lane-${kanbanLanes.length + 1}`,
      name: body["name"],
      position: kanbanLanes.length,
      wip_limit: null,
      is_done: false,
    };
    kanbanLanes.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.put("/platform/api/kanban/lanes/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const found = kanbanLanes.find((item) => item["id"] === params["id"]);
    if (!found) return new HttpResponse(null, { status: 404 });
    Object.assign(found, body);
    return echo(request, found);
  }),
  http.delete("/platform/api/kanban/lanes/:id", ({ params, request }) => {
    const index = kanbanLanes.findIndex((item) => item["id"] === params["id"]);
    if (index < 0) return new HttpResponse(null, { status: 404 });
    const destination = kanbanLanes[index === 0 ? 1 : index - 1];
    const moved = kanbanCards.filter((item) => item["lane_id"] === params["id"]);
    for (const item of moved) item["lane_id"] = destination?.["id"];
    kanbanLanes.splice(index, 1);
    return echo(request, {
      id: params["id"],
      deleted: true,
      moved: moved.length,
      moved_to: { id: destination?.["id"], name: destination?.["name"] },
    });
  }),
  http.get("/platform/api/announcements", ({ request }) => {
    const url = new URL(request.url);
    const category = url.searchParams.get("category") ?? "";
    const history = url.searchParams.get("include_expired") === "true";
    const items = announcements.filter(
      (item) =>
        (history ? true : item["is_live"]) &&
        (!category || item["category"] === category),
    );
    return echo(request, {
      items,
      total: items.length,
      page: 1,
      page_size: 25,
      pages: 1,
      categories: announcementCategories(),
      unread: announcements.filter((item) => item["is_live"] && !item["read_at"]).length,
      can_manage: true,
      category,
      include_expired: history,
    });
  }),
  http.get("/platform/api/announcements/drafts", ({ request }) =>
    echo(request, {
      items: announcements.map((item) => ({
        ...item,
        reach: { read: 12, acknowledged: 4 },
      })),
      total: announcements.length,
      page: 1,
      page_size: 25,
      pages: 1,
      statuses: ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"],
      status: new URL(request.url).searchParams.get("status") ?? "",
      can_manage: true,
    }),
  ),
  http.post("/platform/api/announcements/:id/receipt", async ({ params, request }) => {
    const body = (await request.json()) as { acknowledged?: boolean };
    const notice = announcements.find((item) => item["id"] === params["id"]);
    if (!notice) return new HttpResponse(null, { status: 404 });
    // Idempotent, like the server: a page that marks on render sends this more
    // than once and the first timestamp has to survive.
    notice["read_at"] = notice["read_at"] ?? "2026-09-08T10:00:00Z";
    if (body.acknowledged) {
      notice["acknowledged_at"] = notice["acknowledged_at"] ?? "2026-09-08T10:00:00Z";
    }
    return echo(request, notice);
  }),
  http.post("/platform/api/announcements", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      ...announcements[0],
      ...body,
      id: `notice-${announcements.length + 1}`,
      category_label: "News",
      reach: { read: 0, acknowledged: 0 },
    };
    announcements.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.put("/platform/api/announcements/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const notice = announcements.find((item) => item["id"] === params["id"]);
    if (!notice) return new HttpResponse(null, { status: 404 });
    Object.assign(notice, body);
    return echo(request, notice);
  }),
  http.delete("/platform/api/announcements/:id", ({ params, request }) => {
    const index = announcements.findIndex((item) => item["id"] === params["id"]);
    if (index >= 0) announcements.splice(index, 1);
    return echo(request, { id: params["id"], deleted: true });
  }),
  // ── profile (§40, §41) ───────────────────────────────────────────────
  //
  // Answers for *whoever is asked about*, so a test can check that a
  // colleague's page withholds what the reader may not see. A handler with one
  // fixed body would let the page draw the administrator's own access under
  // somebody else's name and pass.
  http.get("/platform/api/profile/:userId?", ({ params, request }) => {
    const asked = params["userId"] ? String(params["userId"]) : currentUser.user.id;
    const mine = asked === currentUser.user.id;
    const person = mine
      ? currentUser.user
      : { ...currentUser.user, id: asked, full_name: "Mara Manager", initials: "MM",
          username: "manager", job_title: "Delivery Manager" };
    // The viewer's own permissions decide what is shown, the way the server
    // decides it — so a test that strips `users.view` sees the withholding.
    const permissions = new Set(currentUser.permissions);
    const contact = mine || permissions.has("users.view");
    const activity = mine || permissions.has("audit.view");

    return echo(request, {
      is_me: mine,
      user: {
        id: person.id,
        full_name: person.full_name,
        initials: person.initials,
        username: person.username,
        avatar_url: null,
        job_title: person.job_title,
        status: "ACTIVE",
        ...(contact ? { email: `${person.username}@nucleus.example`, phone: "" } : {}),
      },
      role: { code: "ADMINISTRATOR", name: "Administrator", color: "#dc2626",
              description: "Unrestricted access." },
      organization: { id: "org-1", name: "Northwind Partners" },
      department: { id: "dep-1", name: "Operations" },
      team: { id: "team-1", name: "Team Atlas" },
      manager: null,
      joined_at: "2024-02-01T09:00:00Z",
      last_login_at: "2026-09-03T08:15:00Z",
      login_count: contact ? 412 : null,
      locale: "en-GB",
      timezone: "Europe/Bucharest",
      mfa_enabled: true,
      visibility: { contact, access: contact, activity },
      groups: contact
        ? [{ id: "grp-1", name: "Platform owners", kind: "SECURITY",
             permissions: ["records.export"] }]
        : [],
      access: contact
        ? {
            role_permissions: ["records.view", "users.view"],
            group_permissions: { "Platform owners": ["records.export"] },
            effective: ["records.export", "records.view", "users.view"],
            effective_labels: ["Export records", "View records", "View users"],
            from_groups_only: ["records.export"],
          }
        : null,
      stats: [
        { key: "open_tasks", label: "Tasks in hand", value: 7,
          link: `/tasks?f.assignee_id=${person.id}`, hint: "Assigned and not finished" },
        { key: "done_tasks", label: "Tasks completed", value: 41,
          link: `/tasks?f.assignee_id=${person.id}&f.status=DONE` },
        { key: "open_tickets", label: "Tickets in hand", value: 3,
          link: `/tickets?f.assignee_id=${person.id}` },
        { key: "resolved_tickets", label: "Tickets resolved", value: 88,
          link: `/tickets?f.assignee_id=${person.id}&f.status=RESOLVED` },
        { key: "projects", label: "Projects owned", value: 2,
          link: `/projects?f.owner_id=${person.id}`, hint: "Active, as owner" },
      ],
      throughput: Array.from({ length: 13 }, (_, index) => ({
        bucket: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
        value: index % 4,
      })),
      heatmap: Array.from({ length: 7 * 24 }, (_, index) => ({
        day: Math.floor(index / 24),
        hour: index % 24,
        value: index % 9 === 0 ? index % 5 : 0,
      })),
      touches: [
        { name: "task", value: 120 },
        { name: "ticket", value: 64 },
        { name: "project", value: 12 },
      ],
      ...(activity
        ? {
            recent_activity: [
              { id: "act-1", action: "UPDATE", kind: "RECORD", resource_type: "task",
                resource_id: "task-1", resource_label: "TSK-00001",
                summary: "moved TSK-00001 to IN_PROGRESS",
                occurred_at: "2026-09-03T09:00:00Z" },
            ],
          }
        : {}),
    });
  }),

  http.get("/platform/api/activity", ({ request }) => {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "";
    const resourceType = url.searchParams.get("resource_type") ?? "";
    const actorId = url.searchParams.get("actor_id") ?? "";
    const items = activityEntries.filter(
      (entry) =>
        (!kind || entry.kind === kind) &&
        (!resourceType || entry.resource_type === resourceType) &&
        (!actorId || entry.actor.id === actorId),
    );
    const matched = ACTIVITY_KINDS.reduce((sum, entry) => sum + entry.count, 0);
    return echo(request, {
      items,
      total: items.length,
      page: Number(url.searchParams.get("page") ?? 1),
      page_size: 50,
      pages: 1,
      // Unchanged by the kind filter, as the server leaves them: a strip whose
      // numbers move when it is used cannot be used to compare.
      kinds: ACTIVITY_KINDS,
      kind,
      resource_type: resourceType,
      actor_id: actorId,
      period: url.searchParams.get("period") ?? "last_30_days",
      matched,
    });
  }),
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
  http.get("/platform/api/files/tree", ({ request }) =>
    echo(request, {
      folders: fileFolders,
      unfiled: { file_count: 0, total_bytes: 0 },
      store: "object",
      max_upload_bytes: 512 * 1024 * 1024,
      refused_extensions: ["exe", "sh"],
      can_manage: true,
    }),
  ),
  http.get("/platform/api/files", ({ request }) => {
    const url = new URL(request.url);
    const folder = url.searchParams.get("folder_id");
    const term = (url.searchParams.get("q") ?? "").toLowerCase();
    const items = storedFiles.filter(
      (file) =>
        (!folder || folder === "unfiled"
          ? file["folder_id"] === null
          : file["folder_id"] === folder) &&
        (!term || String(file["name"]).toLowerCase().includes(term)),
    );
    return echo(request, {
      items, total: items.length, page: 1, page_size: 50, pages: 1,
    });
  }),
  http.post("/platform/api/files", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      ...storedFiles[0],
      id: `file-${storedFiles.length + 1}`,
      name: String(body["name"]),
      size_bytes: Number(body["size_bytes"] ?? 0),
      folder_id: (body["folder_id"] as string | null) ?? null,
      // `UPLOADING` until confirmed — the state the page has to show.
      status: "UPLOADING",
      download_count: 0,
    };
    storedFiles.push(created);
    return HttpResponse.json(
      {
        file: created,
        upload: {
          url: "https://storage.example/nucleus/generated-key",
          method: "PUT",
          expires_in: 900,
          headers: { "Content-Type": asText(body["mime_type"]) },
        },
      },
      { status: 201 },
    );
  }),
  http.post("/platform/api/files/:id/confirm", ({ params }) => {
    const file = storedFiles.find((item) => item["id"] === String(params["id"]));
    if (file) file["status"] = "READY";
    return HttpResponse.json(file);
  }),
  http.get("/platform/api/files/:id", ({ request, params }) => {
    const file = storedFiles.find((item) => item["id"] === String(params["id"]));
    if (file) file["download_count"] = Number(file["download_count"]) + 1;
    return echo(request, {
      file,
      download: {
        url: "https://storage.example/nucleus/generated-key?signed=1",
        method: "GET",
        expires_in: 900,
      },
    });
  }),
  http.put("/platform/api/files/:id", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const file = storedFiles.find((item) => item["id"] === String(params["id"]));
    if (file) Object.assign(file, body);
    return HttpResponse.json(file);
  }),
  http.delete("/platform/api/files/:id", ({ params }) => {
    const index = storedFiles.findIndex((item) => item["id"] === String(params["id"]));
    const [gone] = index >= 0 ? storedFiles.splice(index, 1) : [storedFiles[0]];
    return HttpResponse.json({ id: gone!["id"], deleted: true, name: gone!["name"] });
  }),
  http.post("/platform/api/files/folders", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      id: `folder-${fileFolders.length + 1}`,
      name: String(body["name"]),
      path: `/${String(body["name"])}`,
      parent_id: (body["parent_id"] as string | null) ?? null,
      depth: 0, color: null, is_shared: false, file_count: 0, total_bytes: 0, owner: "",
    };
    fileFolders.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
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
    // Widgets arrive *with* the dashboard, laid out left to right — the fixture
    // does what the server does, so a wizard that forgot to send them fails.
    const asked = (body["widgets"] as { kind: string; title?: string }[] | undefined) ?? [];
    const widgets = asked.map((entry, index) => ({
      id: `widget-new-${index}`,
      kind: entry.kind,
      title: entry.title ?? entry.kind,
      subtitle: null,
      x: (index * 3) % 12,
      y: Math.floor((index * 3) / 12),
      width: 3,
      height: 2,
      position: index,
      config: {},
    }));
    const created = {
      ...dashboardById("dash-1"),
      ...body,
      id: `dash-${savedDashboards.length + 1}`,
      widgets,
      widget_count: widgets.length,
      widget_kinds: [...new Set(widgets.map((widget) => widget.kind))].sort(),
      is_home: false,
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
  // ── bulk (§43, §75) ──────────────────────────────────────────────────
  //
  // The preview answers from the selection it is *sent*, so a test that ticks
  // two rows sees two and a test that selects a filter sees the fixture's
  // total. A handler returning a constant would let the page draw a number it
  // never asked for and pass.
  http.post("/platform/api/records/:resourceType/bulk/preview", async ({ params, request }) => {
    const body = (await request.json()) as {
      action?: string;
      changes?: Record<string, unknown>;
      selection?: { ids?: string[]; query?: { resource_type?: string }; excluded?: string[] };
    };
    const key = String(params["resourceType"]);
    const resource = explorerCatalogue.items.find((item) => item.key === key);
    const rows = entityRows[key] ?? [];
    const ids = body.selection?.ids ?? [];
    const excluded = new Set(body.selection?.excluded ?? []);
    const matched = body.selection?.query
      ? rows.filter((row) => !excluded.has(String(row["id"])))
      : rows.filter((row) => ids.includes(String(row["id"])));
    const byHand = matched.filter((row) => ids.includes(String(row["id"]))).length;
    return echo(request, {
      resource_type: key,
      action: body.action ?? "update",
      changes: body.changes ?? {},
      total: matched.length,
      by_hand: byHand,
      by_filter: matched.length - byHand,
      limit: 500,
      over_limit: false,
      sample: matched.slice(0, 5).map((row) => ({
        id: String(row["id"]),
        title: asText(row[resource?.title_field ?? "name"] ?? row["reference"] ?? ""),
      })),
      refused: [],
      eligible: matched.length,
      describes: `${matched.length} ${(resource?.label ?? "records").toLowerCase()} you selected`,
    });
  }),
  http.post("/platform/api/records/:resourceType/bulk", async ({ params, request }) => {
    const body = (await request.json()) as {
      action?: string;
      selection?: { ids?: string[]; query?: unknown; excluded?: string[] };
    };
    const key = String(params["resourceType"]);
    const resource = explorerCatalogue.items.find((item) => item.key === key);
    const rows = entityRows[key] ?? [];
    const ids = body.selection?.ids ?? [];
    const excluded = new Set(body.selection?.excluded ?? []);
    const matched = body.selection?.query
      ? rows.filter((row) => !excluded.has(String(row["id"])))
      : rows.filter((row) => ids.includes(String(row["id"])));
    // One refusal, always, when more than one row is selected: the partial
    // outcome is the state this feature exists to report, and a fixture that
    // only ever succeeds would let the result panel ship untested.
    const failed = matched.length > 1
      ? [{
          id: String(matched[matched.length - 1]!["id"]),
          title: asText(matched[matched.length - 1]![resource?.title_field ?? "name"] ?? ""),
          error: "conflict",
          message: "Somebody else changed it while you were looking.",
        }]
      : [];
    const applied = matched.length - failed.length;
    return echo(request, {
      resource_type: key,
      action: body.action ?? "update",
      requested: matched.length,
      applied,
      unchanged: 0,
      failed,
      records: matched.slice(0, 5).map((row) => ({
        id: String(row["id"]),
        title: asText(row[resource?.title_field ?? "name"] ?? ""),
      })),
      message: failed.length
        ? `Updated ${applied} ${(resource?.label ?? "records").toLowerCase()}; ${failed.length} could not be updated.`
        : `Updated ${applied} ${(resource?.label ?? "records").toLowerCase()}.`,
    });
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
  http.post("/platform/admin/roles", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    // Narrowed rather than stringified: `String(unknown)` renders an object as
    // "[object Object]", which is a fixture that answers nonsense.
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const created = {
      ...roleMatrix.items[0]!,
      id: `role-${roleMatrix.items.length + 1}`,
      code: text(body["code"]),
      name: text(body["name"]),
      description: text(body["description"]),
      permissions: Array.isArray(body["permissions"]) ? (body["permissions"] as string[]) : [],
      user_count: 0,
      // Never a system role, whatever was asked for — the server decides this.
      is_system: false,
      is_yours: false,
    };
    roleMatrix.items.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.delete("/platform/admin/roles/:code", ({ request, params }) => {
    const at = roleMatrix.items.findIndex((item) => item.code === String(params["code"]));
    const role = roleMatrix.items[at];
    if (!role) return HttpResponse.json({ message: "not found" }, { status: 404 });
    if (role.is_system) {
      return HttpResponse.json(
        { message: `${role.name} is a built-in role.` },
        { status: 409 },
      );
    }
    roleMatrix.items.splice(at, 1);
    return echo(request, { deleted: true, code: role.code });
  }),
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
  // ── Favorites and recents (§38, §39) ──────────────────────────────────
  // `order` before `:id`, for the reason the audit export is: MSW matches
  // path segments loosely, so `:id` would swallow it.
  http.put("/platform/favorites/order", async ({ request }) => {
    const body = (await request.json()) as { order: string[] };
    body.order.forEach((id, index) => {
      const found = bookmarkRows.find((row) => row["id"] === id);
      if (found) found["position"] = index + 1;
    });
    return HttpResponse.json(bookmarkList());
  }),
  http.get("/platform/favorites", ({ request }) => echo(request, bookmarkList())),
  http.post("/platform/favorites", async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    const highest = bookmarkRows.reduce(
      (top, row) => Math.max(top, Number(row["position"])),
      0,
    );
    // Idempotent on (type, id), as the service is: a star is a toggle
    // somebody double-clicks.
    const existing = bookmarkRows.find(
      (row) =>
        row["resource_type"] === body["resource_type"] &&
        row["resource_id"] === body["resource_id"],
    );
    if (existing) {
      existing["label"] = body["label"];
      existing["url"] = body["url"];
    } else {
      bookmarkRows.push({
        id: `fav-${body["resource_id"]}`,
        resource_type: body["resource_type"],
        resource_id: body["resource_id"],
        label: body["label"],
        url: body["url"],
        icon: body["icon"] ?? null,
        position: highest + 1,
        added_at: "2026-09-08T10:00:00Z",
      });
    }
    return HttpResponse.json(bookmarkList(), { status: 201 });
  }),
  http.delete("/platform/favorites/:id", ({ params }) => {
    const index = bookmarkRows.findIndex((row) => row["id"] === params["id"]);
    if (index < 0) {
      return HttpResponse.json(
        { error: "not_found", message: "That favourite does not exist.", details: {} },
        { status: 404 },
      );
    }
    bookmarkRows.splice(index, 1);
    return HttpResponse.json(bookmarkList());
  }),
  http.get("/platform/recents", ({ request }) => echo(request, recentList())),
  http.delete("/platform/recents", () => {
    const cleared = recentRows.length;
    recentRows.length = 0;
    // The bookmarks are untouched: one was a decision, the other a
    // by-product.
    return HttpResponse.json({ cleared, ...recentList() });
  }),
  // ── Security (§41) ────────────────────────────────────────────────────
  http.get("/platform/security/overview", ({ request }) =>
    echo(request, securityOverview()),
  ),
  http.post("/platform/security/sessions/revoke-others", () => {
    // Keeps the current one, for the reason the service does: an operation
    // that signed you out too would make its own result unviewable.
    let revoked = 0;
    sessionRows.forEach((row, index) => {
      if (row["state"] === "ACTIVE" && !row["current"]) {
        sessionRows[index] = sessionOf({ ...row, revoked_at: "2026-09-08T09:30:00Z" });
        revoked += 1;
      }
    });
    return HttpResponse.json({ revoked, ...sessionList() });
  }),
  http.get("/platform/security/sessions", ({ request }) => echo(request, sessionList())),
  http.delete("/platform/security/sessions/:id", ({ params }) => {
    const index = sessionRows.findIndex((row) => row["id"] === params["id"]);
    if (index < 0 || sessionRows[index]!["state"] !== "ACTIVE") {
      return HttpResponse.json(
        { error: "conflict", message: "That session cannot be signed out.", details: {} },
        { status: 409 },
      );
    }
    const gone = sessionOf({ ...sessionRows[index], revoked_at: "2026-09-08T09:30:00Z" });
    sessionRows[index] = gone;
    return HttpResponse.json(gone);
  }),
  http.put("/platform/security/sessions/:id", async ({ request, params }) => {
    const body = (await request.json()) as { trusted?: boolean };
    const index = sessionRows.findIndex((row) => row["id"] === params["id"]);
    if (index < 0) {
      return HttpResponse.json(
        { error: "not_found", message: "That session does not exist.", details: {} },
        { status: 404 },
      );
    }
    const updated = sessionOf({ ...sessionRows[index], trusted: Boolean(body.trusted) });
    sessionRows[index] = updated;
    return HttpResponse.json(updated);
  }),
  http.get("/platform/security/sign-ins", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const result = query.get("result") ?? "";
    const items = signInRows.filter((row) => !result || row["result"] === result);
    return echo(request, {
      items,
      total: items.length,
      page: 1,
      page_size: 25,
      pages: 1,
      facets: {},
      window_days: 90,
    });
  }),
  http.put("/platform/security/events/:id", async ({ request, params }) => {
    const body = (await request.json()) as { resolved?: boolean };
    const index = securityEventRows.findIndex((row) => row["id"] === params["id"]);
    if (index < 0) {
      return HttpResponse.json(
        { error: "not_found", message: "That event does not exist.", details: {} },
        { status: 404 },
      );
    }
    const updated = { ...securityEventRows[index], resolved: Boolean(body.resolved) };
    securityEventRows[index] = updated;
    return HttpResponse.json(updated);
  }),
  http.get("/platform/security/events", ({ request }) =>
    echo(request, {
      items: securityEventRows,
      total: securityEventRows.length,
      page: 1,
      page_size: 25,
      pages: 1,
      facets: {},
    }),
  ),
  // ── Import wizard (§29) ───────────────────────────────────────────────
  // `catalogue` before `:id`, for the reason the audit export is: MSW matches
  // path segments loosely, so `:id` would swallow it.
  http.get("/platform/imports/catalogue", ({ request }) => echo(request, importCatalogue)),
  http.put("/platform/imports/:id/mapping", async ({ request, params }) => {
    const body = (await request.json()) as { column_mapping: Record<string, string> };
    const index = importRows.findIndex((item) => item["id"] === params["id"]);
    if (index < 0) {
      return HttpResponse.json(
        { error: "not_found", message: "That import does not exist.", details: {} },
        { status: 404 },
      );
    }
    const mapping = Object.fromEntries(
      Object.entries(body.column_mapping).filter(([, field]) => field),
    );
    // Validation the way the service does it: a mapped `Segment` makes the
    // second row wrong, and a row with nothing in any mapped column is
    // skipped rather than counted either way.
    const staged = (importRows[index]!["staged"] as Record<string, string>[]) ?? [];
    const errors: Array<Record<string, unknown>> = [];
    let skipped = 0;
    staged.forEach((source, position) => {
      const values = Object.keys(mapping).map((column) => source[column] ?? "");
      if (!values.some((value) => value.trim())) {
        skipped += 1;
        return;
      }
      for (const [column, field] of Object.entries(mapping)) {
        if (field === "segment" && source[column] && source[column] !== "SMB") {
          errors.push({
            line: position + 2,
            column,
            field,
            value: source[column],
            message: `${source[column]} is not a segment this record can have.`,
          });
        }
      }
    });
    const invalid = new Set(errors.map((problem) => problem["line"])).size;
    const required = ["name"].filter((name) => !Object.values(mapping).includes(name));
    const updated = importOf({
      ...importRows[index],
      column_mapping: mapping,
      unmapped_required: required,
      total_rows: staged.length,
      skipped_rows: skipped,
      invalid_rows: invalid,
      valid_rows: staged.length - skipped - invalid,
      errors,
      step: "PREVIEW",
      status: staged.length - skipped - invalid > 0 ? "VALIDATED" : "DRAFT",
    });
    importRows[index] = updated;
    return HttpResponse.json(importDetail(updated));
  }),
  http.post("/platform/imports/:id/execute", ({ params }) => {
    const index = importRows.findIndex((item) => item["id"] === params["id"]);
    if (index < 0) {
      return HttpResponse.json(
        { error: "not_found", message: "That import does not exist.", details: {} },
        { status: 404 },
      );
    }
    const row = importRows[index]!;
    if (!row["can_execute"]) {
      return HttpResponse.json(
        {
          error: "conflict",
          message: "That import cannot be run yet.",
          details: { status: row["status"] },
        },
        { status: 409 },
      );
    }
    // All-or-nothing, and finished by the time the answer comes back: the
    // staged file goes, because the rows have become records.
    const done = importOf({
      ...row,
      status: "COMPLETED",
      step: "DONE",
      imported_rows: row["valid_rows"],
      completed_at: "2026-09-08T09:10:00Z",
      staged: [],
    });
    importRows[index] = done;
    return HttpResponse.json(importDetail(done), { status: 202 });
  }),
  http.get("/platform/imports/:id/problems", () =>
    HttpResponse.text(
      "\ufeffLine,Column,Value,Problem\n3,Segment,NOT-A-SEGMENT,not a segment\n",
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="IMP-000202-problems.csv"',
        },
      },
    ),
  ),
  http.get("/platform/imports/:id", ({ request, params }) => {
    const row = importRows.find((item) => item["id"] === params["id"]);
    return row
      ? echo(request, importDetail(row))
      : HttpResponse.json(
          { error: "not_found", message: "That import does not exist.", details: {} },
          { status: 404 },
        );
  }),
  // Two presses, as the endpoint has: the staged file on the first, the record
  // on the second, and `removed` says which happened.
  http.delete("/platform/imports/:id", ({ params }) => {
    const index = importRows.findIndex((item) => item["id"] === params["id"]);
    if (index < 0) {
      return HttpResponse.json(
        { error: "not_found", message: "That import does not exist.", details: {} },
        { status: 404 },
      );
    }
    const row = importRows[index]!;
    if (!["DRAFT", "VALIDATED"].includes(String(row["status"]))) {
      importRows.splice(index, 1);
      return HttpResponse.json({ ...row, removed: true });
    }
    const dropped = importOf({
      ...row,
      status: "CANCELLED",
      step: "DONE",
      staged: [],
    });
    importRows[index] = dropped;
    return HttpResponse.json({ ...dropped, removed: false });
  }),
  http.post("/platform/imports", async ({ request }) => {
    const body = (await request.json()) as {
      target_entity: string;
      filename: string;
      content: string;
    };
    const made = importOf({
      id: "imp-new",
      reference: "IMP-000300",
      status: "DRAFT",
      step: "MAPPING",
      filename: body.filename,
      target_entity: body.target_entity,
      target_label: body.target_entity === "project" ? "Projects" : "Customers",
      staged: importStaged,
      blank_rows: 0,
    });
    importRows.unshift(made);
    return HttpResponse.json(importDetail(made), { status: 201 });
  }),
  http.get("/platform/imports", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const status = query.get("status") ?? "";
    const items = importRows.filter((row) => !status || row["status"] === status);
    return echo(request, {
      items,
      total: items.length,
      page: 1,
      page_size: 25,
      pages: 1,
      facets: {},
      columns: ["reference", "filename", "target_entity", "status", "created_at"],
    });
  }),
  // ── Exports (§30) ─────────────────────────────────────────────────────
  // `catalogue` and `estimate` before the `:id` rule, for the reason the audit
  // export is: MSW matches segments loosely, so `:id` would swallow both.
  http.get("/platform/exports/catalogue", ({ request }) => echo(request, exportCatalogue())),
  http.post("/platform/exports/estimate", async ({ request }) => {
    const body = (await request.json()) as { resource_type?: string; format?: string };
    const dataset = String(body.resource_type ?? "ticket");
    const format = String(body.format ?? "csv");
    const rows = exportSizes[dataset] ?? 0;
    const ceiling = format === "xlsx" ? 20_000 : 100_000;
    return HttpResponse.json({
      resource_type: dataset,
      format,
      description: exportDatasets.find((entry) => entry.key === dataset)?.label ?? dataset,
      columns: exportDatasets.find((entry) => entry.key === dataset)?.columns ?? [],
      rows,
      maximum: ceiling,
      streams_up_to: 50_000,
      // Derived from the counts, not asserted: the whole point of `estimate`
      // is that these two follow from the number of rows.
      can_stream: rows <= (format === "xlsx" ? 20_000 : 50_000),
      can_queue: rows <= ceiling,
      too_large: rows > ceiling,
    });
  }),
  http.post("/platform/exports/:id/again", ({ params }) => {
    const source = exportRows.find((row) => row["id"] === params["id"]);
    const made = exportOf({
      ...source,
      id: `again-${String(params["id"])}`,
      reference: "EXP-000199",
      status: "QUEUED",
      rows: null,
      size_bytes: null,
      progress: 0,
      stalled: false,
      expired: false,
      finished_at: null,
    });
    exportRows.unshift(made);
    return HttpResponse.json(made, { status: 201 });
  }),
  http.get("/platform/exports/:id/download", ({ params }) => {
    const row = exportRows.find((item) => item["id"] === params["id"]);
    if (!row || !row["downloadable"]) {
      return HttpResponse.json(
        { error: "conflict", message: "That export has no file.", details: {} },
        { status: 409 },
      );
    }
    return HttpResponse.json({
      url: "https://storage.example/exports/EXP-000101.csv?signature=x",
      method: "GET",
      expires_in: 900,
      filename: "ticket-2026-09-08-0901.csv",
      content_type: "text/csv; charset=utf-8",
      size_bytes: row["size_bytes"],
      rows: row["rows"],
    });
  }),
  http.get("/platform/exports/:id", ({ request, params }) => {
    const row = exportRows.find((item) => item["id"] === params["id"]);
    return row
      ? echo(request, row)
      : HttpResponse.json(
          { error: "not_found", message: "That export does not exist.", details: {} },
          { status: 404 },
        );
  }),
  // Two presses, as the endpoint has: the file on the first, the record on the
  // second, and `removed` says which happened.
  http.delete("/platform/exports/:id", ({ params }) => {
    const index = exportRows.findIndex((item) => item["id"] === params["id"]);
    if (index < 0) {
      return HttpResponse.json(
        { error: "not_found", message: "That export does not exist.", details: {} },
        { status: 404 },
      );
    }
    const row = exportRows[index]!;
    if (!row["has_file"]) {
      exportRows.splice(index, 1);
      return HttpResponse.json({ ...row, removed: true });
    }
    // `rows` and `size_bytes` stay, as the server keeps them: the record is
    // what was exported, and the file going does not unmake that.
    const dropped = exportOf({ ...row, has_file: false });
    exportRows[index] = dropped;
    return HttpResponse.json({ ...dropped, removed: false });
  }),
  http.post("/platform/exports", async ({ request }) => {
    const body = (await request.json()) as { resource_type?: string; format?: string };
    const dataset = String(body.resource_type ?? "ticket");
    const made = exportOf({
      id: "exp-new",
      reference: "EXP-000200",
      name: `${dataset} — ${String(body.format ?? "csv").toUpperCase()}`,
      status: "QUEUED",
      resource_type: dataset,
      format: String(body.format ?? "csv"),
      description: exportDatasets.find((entry) => entry.key === dataset)?.label ?? dataset,
      ran_as: "greenlet",
    });
    exportRows.unshift(made);
    return HttpResponse.json(made, { status: 201 });
  }),
  http.get("/platform/exports", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const status = query.get("status") ?? "";
    const items = exportRows.filter((row) => !status || row["status"] === status);
    return echo(request, {
      items,
      total: items.length,
      page: 1,
      page_size: 50,
      pages: 1,
      facets: {},
      columns: ["reference", "name", "status", "rows", "created_at"],
    });
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
