/**
 * Work planning (§18), mocked in memory: a timeline with a dependency chain,
 * sprints with a backlog, templates, lane limits, and one task's plan — so a
 * test can drag, link, plan, start, complete and see the result come back.
 */

import { http, HttpResponse } from "msw";

import type {
  Dependency,
  LaneSetting,
  Recurrence,
  Sprint,
  SprintCard,
  SprintDetail,
  TaskPlanning,
  TaskTemplate,
  Timeline,
  TimelineBar,
} from "@/api/planning";

const P = "/platform";
export const TODAY = "2026-09-03";

export function bar(partial: Partial<TimelineBar> & { id: string; reference: string }): TimelineBar {
  return {
    title: `Task ${partial.reference}`,
    status: "IN_PROGRESS",
    priority: "NORMAL",
    kind: "TASK",
    start: "2026-09-01",
    end: "2026-09-04",
    scheduled: true,
    progress: 40,
    is_milestone: false,
    story_points: 3,
    project_id: "prj-1",
    epic_id: null,
    assignee: { id: "u-1", name: "Ada Administrator", initials: "AA" },
    cover_color: null,
    critical: false,
    updated_at: "2026-09-02T10:00:00Z",
    ...partial,
  };
}

export function card(partial: Partial<SprintCard> & { id: string; reference: string }): SprintCard {
  return {
    title: `Story ${partial.reference}`,
    status: "NEW",
    priority: "NORMAL",
    kind: "STORY",
    story_points: 3,
    assignee: { id: "u-1", name: "Ada Administrator", initials: "AA" },
    epic_id: "epic-1",
    project_id: "prj-1",
    sprint_id: null,
    due_date: null,
    blocked_reason: null,
    cover_color: null,
    tags: [],
    checklist_total: 2,
    checklist_done: 1,
    backlog_rank: 1024,
    board_position: 1024,
    updated_at: "2026-09-02T10:00:00Z",
    ...partial,
  };
}

function sprintOf(partial: Partial<Sprint> & { id: string; name: string }): Sprint {
  return {
    goal: "Ship the pilot",
    state: "PLANNED",
    project: { id: "prj-1", name: "Customer portal", code: "PRJ-0001", color: "#2457D6" },
    start_date: "2026-09-01",
    end_date: "2026-09-14",
    capacity_points: 20,
    committed_points: null,
    completed_points: null,
    started_at: null,
    completed_at: null,
    days_left: null,
    total_points: 0,
    done_points: 0,
    remaining_points: 0,
    total_tasks: 0,
    done_tasks: 0,
    ...partial,
  };
}

interface State {
  timeline: Timeline;
  sprints: Sprint[];
  scope: Record<string, SprintCard[]>;
  backlog: SprintCard[];
  templates: TaskTemplate[];
  lanes: LaneSetting[];
  planning: TaskPlanning;
  calls: { url: string; method: string; body: unknown }[];
}

export const planningState: State = {} as State;

export function resetPlanning(): void {
  const a = bar({ id: "t-a", reference: "TSK-00001", title: "Design the schema", start: "2026-09-01", end: "2026-09-03", critical: true });
  const b = bar({ id: "t-b", reference: "TSK-00002", title: "Build the API", start: "2026-09-04", end: "2026-09-08", critical: true });
  const m = bar({ id: "t-m", reference: "TSK-00003", title: "Beta", start: "2026-09-10", end: "2026-09-10", is_milestone: true });
  const links: Dependency[] = [{ id: "d-1", predecessor_id: "t-a", successor_id: "t-b", kind: "FS", lag_days: 0, violated: false }];
  Object.assign(planningState, {
    timeline: {
      group: "project",
      range: { from: "2026-08-13", to: "2026-12-02", today: TODAY },
      groups: [
        {
          key: "prj-1", label: "Customer portal", code: "PRJ-0001", color: "#2457D6",
          start: "2026-08-20", end: "2026-10-30", progress: 40, count: 3, items: [a, b, m],
        },
      ],
      dependencies: links,
      critical_path: ["t-a", "t-b"],
      total: 3,
      truncated: false,
      can_edit: true,
    } satisfies Timeline,
    sprints: [
      sprintOf({ id: "sp-active", name: "PRJ-0001 Sprint 5", state: "ACTIVE", committed_points: 8, total_points: 8, done_points: 3, remaining_points: 5, total_tasks: 2, done_tasks: 1, days_left: 6, started_at: "2026-09-01T09:00:00Z" }),
      sprintOf({ id: "sp-next", name: "PRJ-0001 Sprint 6", start_date: "2026-09-15", end_date: "2026-09-28" }),
      sprintOf({ id: "sp-done", name: "PRJ-0001 Sprint 4", state: "COMPLETED", committed_points: 21, completed_points: 18, start_date: "2026-08-18", end_date: "2026-08-31", completed_at: "2026-08-31T17:00:00Z" }),
    ],
    scope: {
      "sp-active": [
        card({ id: "c-1", reference: "TSK-00101", title: "Pay an invoice online", status: "DONE", sprint_id: "sp-active", story_points: 3 }),
        card({ id: "c-2", reference: "TSK-00102", title: "Card decline retry", status: "IN_PROGRESS", sprint_id: "sp-active", story_points: 5, blocked_reason: "Waiting on the gateway" }),
      ],
      "sp-next": [],
    },
    backlog: [
      card({ id: "c-3", reference: "TSK-00103", title: "Export the ledger", backlog_rank: 1024 }),
      card({ id: "c-4", reference: "TSK-00104", title: "Search by reference", backlog_rank: 2048, kind: "BUG", story_points: null }),
    ],
    templates: [
      {
        id: "tpl-1", name: "Bug triage", title: "Triage: ", description: "Reproduce and assign.", kind: "BUG",
        priority: "HIGH", estimate_hours: 2, story_points: 2, checklist: [{ text: "Reproduce", done: false }],
        labels: [], cover_color: "#dc2626", due_in_days: 2, usage_count: 4, updated_at: null,
      },
    ],
    lanes: [
      { status: "NEW", wip_limit: null, count: 4, over_limit: false },
      { status: "IN_PROGRESS", wip_limit: 1, count: 2, over_limit: true },
    ],
    planning: {
      id: "t-a",
      epic: { id: "epic-1", reference: "TSK-00900", title: "Billing", status: "IN_PROGRESS", kind: "EPIC", story_points: null, assignee: null, start: null, end: null },
      parent: null,
      sprint: { id: "sp-active", name: "PRJ-0001 Sprint 5", state: "ACTIVE", end_date: "2026-09-14" },
      subtasks: [{ id: "t-s", reference: "TSK-00005", title: "Write the migration", status: "DONE", kind: "TASK", story_points: 1, assignee: null, start: null, end: null }],
      children: [],
      children_done: 0,
      blocked_by: [{ dependency_id: "d-9", lag_days: 0, id: "t-z", reference: "TSK-00009", title: "Agree the contract", status: "DONE", kind: "TASK", story_points: 2, assignee: null, start: "2026-08-20", end: "2026-08-25" }],
      blocking: [],
      watchers: [{ id: "u-2", name: "Otto Operator", initials: "OO" }],
      watching: false,
      recurrence: null,
      status_changed_at: "2026-08-30T10:00:00Z",
      can_edit: true,
      can_manage: true,
    },
    calls: [],
  } satisfies State);
}
resetPlanning();

function detail(id: string): SprintDetail | undefined {
  const sprint = planningState.sprints.find((item) => item.id === id);
  if (!sprint) return undefined;
  return {
    ...sprint,
    tasks: planningState.scope[id] ?? [],
    burndown: {
      days: ["2026-09-01", "2026-09-02", "2026-09-03"],
      ideal: [8, 4, 0],
      actual: [8, 5, null],
      scope: [8, 8, null],
      committed: 8,
    },
    report:
      sprint.state === "COMPLETED"
        ? {
            committed_points: 21, completed_points: 18, completed: ["TSK-00090"], carried_over: ["TSK-00091"],
            carried_to: "backlog", added_after_start: [], total_tasks: 2, done_tasks: 1,
          }
        : null,
    can_manage: true,
  };
}

async function record(request: Request) {
  const body = request.method === "GET" || request.method === "DELETE" ? null : await request.json().catch(() => null);
  planningState.calls.push({ url: new URL(request.url).pathname, method: request.method, body });
  return body as Record<string, unknown> | null;
}

const rule = (input: Partial<Recurrence>): Recurrence => ({
  id: "rule-1",
  frequency: input.frequency ?? "WEEKLY",
  interval: input.interval ?? 1,
  unit: input.unit ?? "DAY",
  weekdays: input.weekdays ?? [0],
  month_day: input.month_day ?? null,
  until: input.until ?? null,
  next_run_at: "2026-09-07T06:00:00Z",
  last_run_at: null,
  occurrences: 0,
  active: true,
  summary: input.frequency === "DAILY" ? "Every day" : "Every week on Mon",
});

export const planningHandlers = [
  http.get(`${P}/api/work/timeline`, () => HttpResponse.json(planningState.timeline)),
  http.post(`${P}/api/tasks/:id/schedule`, async ({ request, params }) => {
    const body = (await record(request)) as { start_date: string; due_date: string; shift_dependants?: boolean };
    const breaks = params.id === "t-a" && body.due_date >= "2026-09-04" && !body.shift_dependants;
    return HttpResponse.json({
      id: params.id,
      start_date: body.start_date,
      due_date: body.due_date,
      updated_at: "2026-09-03T12:00:00Z",
      violations: breaks
        ? [{
            dependency_id: "d-1", side: "successor",
            predecessor: { id: "t-a", reference: "TSK-00001", title: "Design the schema", end: body.due_date },
            successor: { id: "t-b", reference: "TSK-00002", title: "Build the API", start: "2026-09-04" },
            overlap_days: 1,
          }]
        : [],
      shifted: body.shift_dependants ? [{ id: "t-b", reference: "TSK-00002", start_date: "2026-09-06", due_date: "2026-09-10", days: 2 }] : [],
    });
  }),
  http.post(`${P}/api/work/dependencies`, async ({ request }) => {
    const body = (await record(request)) as { predecessor_id: string; successor_id: string };
    if (body.predecessor_id === body.successor_id) {
      return HttpResponse.json({ error: "validation_error", message: "A task cannot wait on itself." }, { status: 400 });
    }
    return HttpResponse.json({ id: "d-new", ...body, kind: "FS", lag_days: 0, violated: body.successor_id === "t-a" }, { status: 201 });
  }),
  http.delete(`${P}/api/work/dependencies/:id`, async ({ request, params }) => {
    await record(request);
    return HttpResponse.json({ id: params.id, deleted: true });
  }),

  http.get(`${P}/api/work/sprints`, ({ request }) => {
    const state = new URL(request.url).searchParams.get("state");
    const items = state ? planningState.sprints.filter((item) => item.state === state) : planningState.sprints;
    return HttpResponse.json({ items, can_manage: true });
  }),
  http.post(`${P}/api/work/sprints`, async ({ request }) => {
    const body = (await record(request)) as Partial<Sprint>;
    const made = sprintOf({ id: `sp-${planningState.sprints.length + 1}`, name: body.name || "Sprint 7", goal: body.goal ?? null });
    planningState.sprints.push(made);
    planningState.scope[made.id] = [];
    return HttpResponse.json(made, { status: 201 });
  }),
  http.get(`${P}/api/work/sprints/:id`, ({ params }) => {
    const found = detail(String(params.id));
    return found ? HttpResponse.json(found) : HttpResponse.json({ error: "not_found", message: "No sprint" }, { status: 404 });
  }),
  http.put(`${P}/api/work/sprints/:id`, async ({ request, params }) => {
    const body = (await record(request)) as Partial<Sprint>;
    const sprint = planningState.sprints.find((item) => item.id === params.id)!;
    Object.assign(sprint, body);
    return HttpResponse.json(sprint);
  }),
  http.delete(`${P}/api/work/sprints/:id`, async ({ request, params }) => {
    await record(request);
    planningState.sprints = planningState.sprints.filter((item) => item.id !== params.id);
    return HttpResponse.json({ id: params.id, released: 0 });
  }),
  http.post(`${P}/api/work/sprints/:id/start`, async ({ request, params }) => {
    await record(request);
    const sprint = planningState.sprints.find((item) => item.id === params.id)!;
    if (planningState.sprints.some((item) => item.state === "ACTIVE")) {
      return HttpResponse.json({ error: "conflict", message: "Another sprint is still running." }, { status: 409 });
    }
    sprint.state = "ACTIVE";
    return HttpResponse.json(sprint);
  }),
  http.post(`${P}/api/work/sprints/:id/complete`, async ({ request, params }) => {
    await record(request);
    const sprint = planningState.sprints.find((item) => item.id === params.id)!;
    sprint.state = "COMPLETED";
    return HttpResponse.json({
      ...sprint,
      report: {
        committed_points: 8, completed_points: 3, completed: ["TSK-00101"], carried_over: ["TSK-00102"],
        carried_to: { id: "sp-next", name: "PRJ-0001 Sprint 6" }, added_after_start: [], total_tasks: 2, done_tasks: 1,
      },
    });
  }),
  http.get(`${P}/api/work/velocity`, () =>
    HttpResponse.json({
      items: [
        { id: "sp-3", name: "PRJ-0001 Sprint 3", end_date: "2026-08-17", committed: 20, completed: 16 },
        { id: "sp-done", name: "PRJ-0001 Sprint 4", end_date: "2026-08-31", committed: 21, completed: 18 },
      ],
      average: 17,
    }),
  ),
  http.get(`${P}/api/work/backlog`, ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    const items = planningState.backlog.filter((item) => item.title.toLowerCase().includes(q));
    return HttpResponse.json({ items, total: items.length, total_points: 3, can_manage: true });
  }),
  http.post(`${P}/api/work/backlog/place`, async ({ request }) => {
    const body = (await record(request)) as { task_id: string; sprint_id: string | null };
    const all = [...planningState.backlog, ...Object.values(planningState.scope).flat()];
    const moved = all.find((item) => item.id === body.task_id)!;
    planningState.backlog = planningState.backlog.filter((item) => item.id !== body.task_id);
    for (const key of Object.keys(planningState.scope)) {
      planningState.scope[key] = planningState.scope[key]!.filter((item) => item.id !== body.task_id);
    }
    const placed = { ...moved, sprint_id: body.sprint_id };
    if (body.sprint_id) planningState.scope[body.sprint_id] = [...(planningState.scope[body.sprint_id] ?? []), placed];
    else planningState.backlog.push(placed);
    return HttpResponse.json(placed);
  }),
  http.get(`${P}/api/work/epics`, () =>
    HttpResponse.json({
      items: [{ ...card({ id: "epic-1", reference: "TSK-00900", title: "Billing", kind: "EPIC" }), children: 4, children_done: 1, points: 13 }],
    }),
  ),
  http.get(`${P}/api/work/lanes`, () => HttpResponse.json({ items: planningState.lanes, can_manage: true })),
  http.put(`${P}/api/work/lanes`, async ({ request }) => {
    const body = (await record(request)) as { limits: Record<string, number | null> };
    planningState.lanes = planningState.lanes.map((lane) =>
      lane.status in body.limits ? { ...lane, wip_limit: body.limits[lane.status] ?? null } : lane,
    );
    return HttpResponse.json({ items: planningState.lanes, can_manage: true });
  }),
  http.get(`${P}/api/work/templates`, () => HttpResponse.json({ items: planningState.templates, can_manage: true })),
  http.post(`${P}/api/work/templates/:id/use`, async ({ request }) => {
    const body = (await record(request)) as { title?: string };
    return HttpResponse.json({ id: "t-new", title: body.title ?? "Triage: " }, { status: 201 });
  }),
  http.get(`${P}/api/tasks/:id/planning`, ({ params }) => HttpResponse.json({ ...planningState.planning, id: params.id })),
  http.post(`${P}/api/tasks/:id/watchers`, async ({ request }) => {
    await record(request);
    planningState.planning.watching = true;
    return HttpResponse.json({ watching: true, watchers: 2 });
  }),
  http.delete(`${P}/api/tasks/:id/watchers`, async ({ request }) => {
    await record(request);
    planningState.planning.watching = false;
    return HttpResponse.json({ watching: false, watchers: 1 });
  }),
  http.put(`${P}/api/tasks/:id/recurrence`, async ({ request }) => {
    const body = (await record(request)) as Partial<Recurrence>;
    planningState.planning.recurrence = rule(body);
    return HttpResponse.json({ recurrence: planningState.planning.recurrence });
  }),
  http.delete(`${P}/api/tasks/:id/recurrence`, async ({ request }) => {
    await record(request);
    planningState.planning.recurrence = null;
    return HttpResponse.json({ recurrence: null });
  }),
  http.post(`${P}/api/tasks/:id/save-as-template`, async ({ request }) => {
    const body = (await record(request)) as { name: string };
    return HttpResponse.json({ ...planningState.templates[0], id: "tpl-2", name: body.name }, { status: 201 });
  }),
  http.post(`${P}/api/tasks/:id/place`, async ({ request, params }) => {
    const body = (await record(request)) as { status: string };
    for (const key of Object.keys(planningState.scope)) {
      planningState.scope[key] = planningState.scope[key]!.map((item) => (item.id === params.id ? { ...item, status: body.status } : item));
    }
    return HttpResponse.json({ id: params.id, status: body.status, board_position: 1, updated_at: "2026-09-03T12:00:00Z" });
  }),
  http.post(`${P}/api/work/scheduler/run`, () => HttpResponse.json({ ran_at: "2026-09-03T12:00:00Z", results: {} })),
];
