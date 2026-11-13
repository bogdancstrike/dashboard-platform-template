/**
 * The workflow canvas (§49), mocked: one branching workflow with a draft,
 * versions, run counts, a sample record and a test trace.
 */

import { http, HttpResponse } from "msw";

import type { GraphDetail, WorkflowGraph } from "@/api/workflowGraph";

const at = "2026-11-12T10:00:00Z";

export function canvasGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "RECORD_CREATED", resource_type: "task" } },
      { id: "b", type: "branch", position: { x: 0, y: 160 }, data: { tree: { type: "group", children1: { a: { type: "rule", properties: { field: "priority", operator: "select_any_in", value: [["HIGH"]] } } } } } },
      { id: "yes", type: "action", position: { x: -150, y: 320 }, data: { kind: "NOTIFY", recipients: { user_ids: [], role: "", owner: true }, title: "{rule}: {record}" } },
      { id: "no", type: "action", position: { x: 150, y: 320 }, data: { kind: "UPDATE_FIELD", field: "progress", value: 5 } },
    ],
    edges: [
      { id: "e1", source: "t", port: "out", target: "b" },
      { id: "e2", source: "b", port: "true", target: "yes" },
      { id: "e3", source: "b", port: "false", target: "no" },
    ],
  };
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "wf-1", name: "Route urgent work", description: null, resource_type: "task", resource_label: "Tasks",
    resource_path: "/tasks", resource_exists: true, enabled: true, severity: "WARNING", condition_tree: null,
    condition_text: "Priority in ['HIGH']", condition_count: 1, actions: [], action_summary: ["Notify people"],
    schedule: "*/15 * * * *", cooldown_minutes: 0, owner: { id: "u1", name: "Ada" }, last_triggered_at: at,
    trigger_count: 4, last_match_count: 1, created_at: at, updated_at: at, can_edit: true,
    trigger: { event: "RECORD_CREATED", label: "Record created", text: "Record created" }, version: 2,
    has_draft: false, linear: false, ...overrides,
  };
}

export const canvasState: { detail: GraphDetail; published: number; tests: number } = {
  detail: fresh(),
  published: 0,
  tests: 0,
};

function fresh(): GraphDetail {
  return {
    rule: rule() as GraphDetail["rule"],
    draft: canvasGraph(),
    published: canvasGraph(),
    version: 2,
    published_at: at,
    published_by: "Ada Administrator",
    draft_updated_at: at,
    dirty: false,
    problems: [],
    versions: [
      { version: 2, published_at: at, note: "Added the branch", by: "Ada Administrator", nodes: 4 },
      { version: 1, published_at: at, note: "Created on the canvas", by: "Ada Administrator", nodes: 2 },
    ],
    stats: { runs: 3, nodes: { t: { in: 7 }, b: { in: 7, true: 4, false: 3 }, yes: { in: 4, ok: 4 }, no: { in: 3, ok: 2, failed: 1 } }, edges: { e1: 7, e2: 4, e3: 3 } },
    webhook_path: null,
    can_edit: true,
  };
}

export function resetCanvas(overrides: Partial<GraphDetail> = {}) {
  canvasState.detail = { ...fresh(), ...overrides };
  canvasState.published = 0;
  canvasState.tests = 0;
}

/** The canvas's part of `/api/automations/catalog`, spread into the main mock. */
export const canvasCatalogueExtras = {
  canvas_actions: [
    { kind: "NOTIFY", label: "Notify people", description: "An in-app notification.", needs: ["recipients"] },
    { kind: "EMAIL", label: "Send an email", description: "Queued.", needs: ["recipients"] },
    { kind: "TASK", label: "Raise a task", description: "In the normal queue.", needs: [] },
    { kind: "WEBHOOK", label: "Call a webhook", description: "One POST.", needs: ["url"] },
    { kind: "UPDATE_FIELD", label: "Update a field", description: "Set one field.", needs: ["field"] },
    { kind: "ASSIGN", label: "Assign", description: "Give it to somebody.", needs: ["assignee"] },
    { kind: "CREATE_RECORD", label: "Create a record", description: "A new record.", needs: ["resource_type"] },
  ],
  triggers: [
    { event: "RECORD_CREATED", label: "Record created", description: "Every new record.", needs: [] },
    { event: "FIELD_CHANGED", label: "Field changed", description: "A field changes.", needs: ["field"] },
    { event: "SCHEDULE", label: "On a schedule", description: "Cron.", needs: ["schedule"] },
    { event: "WEBHOOK", label: "Webhook called", description: "A POST.", needs: [] },
    { event: "FORM_SUBMITTED", label: "Form submitted", description: "A form.", needs: [] },
  ],
  flow: [
    { kind: "WAIT", label: "Wait", description: "Pause.", needs: ["minutes"], ports: ["out"] },
    { kind: "APPROVAL", label: "Request approval", description: "Ask.", needs: [], ports: ["approved", "rejected"] },
  ],
  forms: [{ slug: "bug", name: "Bug report", target: "task" }],
  approvals: true,
  limits_graph: { max_nodes: 60, max_wait_minutes: 43200 },
};

export const workflowHandlers = [
  http.get("/platform/api/automations/rules/:id/graph", ({ params }) =>
    params["id"] === "missing"
      ? HttpResponse.json({ error: "not_found", message: "That automation does not exist." }, { status: 404 })
      : HttpResponse.json(canvasState.detail),
  ),
  http.put("/platform/api/automations/rules/:id/graph", async ({ request }) => {
    const body = (await request.json()) as { graph: WorkflowGraph | null };
    const draft = body.graph ?? canvasState.detail.published!;
    const problems = draft.nodes.filter((node) => node.type === "condition" && !node.data.tree)
      .map((node) => ({ node_id: node.id, message: "Add at least one rule to this condition." }));
    canvasState.detail = { ...canvasState.detail, draft, dirty: body.graph !== null, problems };
    return HttpResponse.json(canvasState.detail);
  }),
  http.post("/platform/api/automations/rules/:id/publish", () => {
    if (canvasState.detail.problems.length) {
      return HttpResponse.json({ error: "validation_error", message: "1 thing to fix before this can be published.",
        details: { problems: canvasState.detail.problems } }, { status: 400 });
    }
    canvasState.published += 1;
    canvasState.detail = { ...canvasState.detail, version: canvasState.detail.version + 1, dirty: false,
      published: canvasState.detail.draft };
    return HttpResponse.json(canvasState.detail);
  }),
  http.post("/platform/api/automations/rules/:id/restore", async ({ request }) => {
    const body = (await request.json()) as { version: number };
    canvasState.detail = { ...canvasState.detail, dirty: true,
      draft: { ...canvasGraph(), nodes: canvasGraph().nodes.slice(0, body.version === 1 ? 1 : 4) } };
    return HttpResponse.json(canvasState.detail);
  }),
  http.get("/platform/api/automations/rules/:id/samples", () =>
    HttpResponse.json({ items: [{ id: "task-1", label: "TSK-00001", status: "NEW" }, { id: "task-2", label: "TSK-00002", status: null }] }),
  ),
  http.post("/platform/api/automations/rules/:id/test", () => {
    canvasState.tests += 1;
    return HttpResponse.json({
      record: { id: "task-1", label: "TSK-00001", path: "/tasks/task-1" },
      nodes: [
        { node_id: "t", state: "started", detail: "" },
        { node_id: "b", state: "yes", detail: "" },
        { node_id: "yes", state: "done", detail: "would notify people" },
      ],
      edges: ["e1", "e2"],
      actions: [{ kind: "NOTIFY", ok: true, detail: "would notify people", node_id: "yes" }],
      error: null,
    });
  }),
  http.put("/platform/api/automations/rules/:id", async ({ request, params }) => {
    if (params["id"] !== "wf-1") return undefined;
    const body = (await request.json()) as Record<string, unknown>;
    canvasState.detail = { ...canvasState.detail, rule: { ...canvasState.detail.rule, ...body } };
    return HttpResponse.json(canvasState.detail.rule);
  }),
  http.post("/platform/api/automations/scheduler", () =>
    HttpResponse.json({ scheduled: 1, resumed: 0, ran_at: at })),
];
