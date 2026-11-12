import { api } from "./client";

/**
 * Work planning (§18): the timeline, sprints and backlog, templates and
 * recurring tasks. Every one reads the same `tasks` rows the board does.
 */

export interface PlanPerson {
  id: string;
  name: string;
  initials: string;
}

export interface TimelineBar {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  kind: string;
  /** ISO dates, inclusive. */
  start: string;
  end: string;
  /** Both ends were planned rather than inferred. */
  scheduled: boolean;
  progress: number;
  is_milestone: boolean;
  story_points: number | null;
  project_id: string | null;
  epic_id: string | null;
  assignee: PlanPerson | null;
  cover_color: string | null;
  critical: boolean;
  updated_at: string | null;
}

export interface TimelineGroup {
  key: string;
  label: string;
  code: string | null;
  color: string | null;
  start: string;
  end: string;
  progress: number | null;
  count: number;
  items: TimelineBar[];
}

export interface Dependency {
  id: string;
  predecessor_id: string;
  successor_id: string;
  kind: string;
  lag_days: number;
  violated: boolean;
}

export type TimelineGrouping = "project" | "epic" | "assignee";

export interface Timeline {
  group: TimelineGrouping;
  range: { from: string; to: string; today: string };
  groups: TimelineGroup[];
  dependencies: Dependency[];
  critical_path: string[];
  total: number;
  truncated: boolean;
  can_edit: boolean;
}

export interface Violation {
  dependency_id: string;
  side: "predecessor" | "successor";
  predecessor: { id: string; reference: string; title: string; end: string };
  successor: { id: string; reference: string; title: string; start: string };
  overlap_days: number;
}

export interface ScheduleResult {
  id: string;
  start_date: string;
  due_date: string;
  updated_at: string | null;
  violations: Violation[];
  shifted: { id: string; reference: string; start_date: string; due_date: string; days: number }[];
}

export interface SprintCard {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  kind: string;
  story_points: number | null;
  assignee: PlanPerson | null;
  epic_id: string | null;
  project_id: string | null;
  sprint_id: string | null;
  due_date: string | null;
  blocked_reason: string | null;
  cover_color: string | null;
  tags: string[];
  checklist_total: number;
  checklist_done: number;
  backlog_rank: number;
  board_position: number;
  updated_at: string | null;
}

export type SprintState = "PLANNED" | "ACTIVE" | "COMPLETED";

export interface Sprint {
  id: string;
  name: string;
  goal: string | null;
  state: SprintState;
  project: { id: string; name: string; code: string; color: string | null } | null;
  start_date: string | null;
  end_date: string | null;
  capacity_points: number | null;
  committed_points: number | null;
  completed_points: number | null;
  started_at: string | null;
  completed_at: string | null;
  days_left: number | null;
  total_points: number;
  done_points: number;
  remaining_points: number;
  total_tasks: number;
  done_tasks: number;
}

export interface Burndown {
  days: string[];
  ideal: number[];
  actual: (number | null)[];
  scope: (number | null)[];
  committed?: number;
}

export interface SprintReport {
  committed_points: number;
  completed_points: number;
  completed: string[];
  carried_over: string[];
  carried_to: { id: string; name: string } | "backlog";
  added_after_start: string[];
  total_tasks: number;
  done_tasks: number;
}

export interface SprintDetail extends Sprint {
  tasks: SprintCard[];
  burndown: Burndown;
  report: SprintReport | null;
  can_manage: boolean;
}

export interface Velocity {
  items: { id: string; name: string; end_date: string | null; committed: number; completed: number }[];
  average: number;
}

export interface PlanBrief {
  id: string;
  reference: string;
  title: string;
  status: string;
  kind: string;
  story_points: number | null;
  assignee: PlanPerson | null;
  start: string | null;
  end: string | null;
}

export interface Recurrence {
  id: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
  interval: number;
  unit: "DAY" | "WEEK";
  weekdays: number[];
  month_day: number | null;
  until: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  occurrences: number;
  active: boolean;
  summary: string;
}

export interface TaskPlanning {
  id: string;
  epic: PlanBrief | null;
  parent: PlanBrief | null;
  sprint: { id: string; name: string; state: SprintState; end_date: string | null } | null;
  subtasks: PlanBrief[];
  children: PlanBrief[];
  children_done: number;
  blocked_by: (PlanBrief & { dependency_id: string; lag_days: number })[];
  blocking: (PlanBrief & { dependency_id: string; lag_days: number })[];
  watchers: PlanPerson[];
  watching: boolean;
  recurrence: Recurrence | null;
  status_changed_at: string | null;
  can_edit: boolean;
  can_manage: boolean;
}

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  description: string | null;
  kind: string;
  priority: string;
  estimate_hours: number | null;
  story_points: number | null;
  checklist: { text: string; done: boolean }[];
  labels: string[];
  cover_color: string | null;
  due_in_days: number | null;
  usage_count: number;
  updated_at: string | null;
}

export interface LaneSetting {
  status: string;
  wip_limit: number | null;
  count: number;
  over_limit: boolean;
}

export interface Epic extends SprintCard {
  children: number;
  children_done: number;
  points: number;
}

export const planningApi = {
  timeline: (
    params: { group?: TimelineGrouping; from?: string; to?: string; project_id?: string; q?: string; include_done?: boolean },
    signal?: AbortSignal,
  ) => api.get<Timeline>("/api/work/timeline", { params, signal }),
  schedule: (
    id: string,
    input: { start_date: string; due_date: string; shift_dependants?: boolean; expected_updated_at?: string | null },
  ) => api.post<ScheduleResult>(`/api/tasks/${id}/schedule`, input),
  link: (input: { predecessor_id: string; successor_id: string; lag_days?: number }) =>
    api.post<Dependency>("/api/work/dependencies", input),
  unlink: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/api/work/dependencies/${id}`),

  sprints: (params: { project_id?: string; state?: SprintState } = {}, signal?: AbortSignal) =>
    api.get<{ items: Sprint[]; can_manage: boolean }>("/api/work/sprints", { params, signal }),
  sprint: (id: string, signal?: AbortSignal) => api.get<SprintDetail>(`/api/work/sprints/${id}`, { signal }),
  createSprint: (input: {
    project_id?: string | null;
    name?: string;
    goal?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    capacity_points?: number | null;
  }) => api.post<Sprint>("/api/work/sprints", input),
  updateSprint: (id: string, input: Record<string, unknown>) => api.put<Sprint>(`/api/work/sprints/${id}`, input),
  removeSprint: (id: string) => api.delete<{ id: string; released: number }>(`/api/work/sprints/${id}`),
  startSprint: (id: string, input: { start_date?: string; end_date?: string; goal?: string } = {}) =>
    api.post<Sprint>(`/api/work/sprints/${id}/start`, input),
  /** `backlog`, `next`, `new`, or a planned sprint's id. */
  completeSprint: (id: string, carry_over: string) =>
    api.post<Sprint & { report: SprintReport }>(`/api/work/sprints/${id}/complete`, { carry_over }),
  velocity: (params: { project_id?: string; limit?: number } = {}, signal?: AbortSignal) =>
    api.get<Velocity>("/api/work/velocity", { params, signal }),
  backlog: (params: { project_id?: string; q?: string } = {}, signal?: AbortSignal) =>
    api.get<{ items: SprintCard[]; total: number; total_points: number; can_manage: boolean }>(
      "/api/work/backlog",
      { params, signal },
    ),
  place: (input: { task_id: string; sprint_id: string | null; after_id: string | null; before_id: string | null }) =>
    api.post<SprintCard>("/api/work/backlog/place", input),

  planning: (id: string, signal?: AbortSignal) => api.get<TaskPlanning>(`/api/tasks/${id}/planning`, { signal }),
  watch: (id: string) => api.post<{ watching: boolean; watchers: number }>(`/api/tasks/${id}/watchers`, {}),
  unwatch: (id: string) => api.delete<{ watching: boolean; watchers: number }>(`/api/tasks/${id}/watchers`),
  setRecurrence: (id: string, input: Partial<Recurrence>) =>
    api.put<{ recurrence: Recurrence }>(`/api/tasks/${id}/recurrence`, input),
  clearRecurrence: (id: string) => api.delete<{ recurrence: null }>(`/api/tasks/${id}/recurrence`),
  saveAsTemplate: (id: string, name: string) => api.post<TaskTemplate>(`/api/tasks/${id}/save-as-template`, { name }),

  templates: (params: { q?: string } = {}, signal?: AbortSignal) =>
    api.get<{ items: TaskTemplate[]; can_manage: boolean }>("/api/work/templates", { params, signal }),
  createTemplate: (input: Partial<TaskTemplate>) => api.post<TaskTemplate>("/api/work/templates", input),
  updateTemplate: (id: string, input: Partial<TaskTemplate>) => api.put<TaskTemplate>(`/api/work/templates/${id}`, input),
  removeTemplate: (id: string) => api.delete<{ id: string }>(`/api/work/templates/${id}`),
  useTemplate: (id: string, input: { title?: string; project_id?: string; assignee_id?: string; start_date?: string; status?: string }) =>
    api.post<{ id: string; title: string }>(`/api/work/templates/${id}/use`, input),

  lanes: (signal?: AbortSignal) => api.get<{ items: LaneSetting[]; can_manage: boolean }>("/api/work/lanes", { signal }),
  setLanes: (limits: Record<string, number | null>) =>
    api.put<{ items: LaneSetting[]; can_manage: boolean }>("/api/work/lanes", { limits }),
  epics: (params: { project_id?: string } = {}, signal?: AbortSignal) =>
    api.get<{ items: Epic[] }>("/api/work/epics", { params, signal }),
  runScheduler: () => api.post<{ ran_at: string; results: Record<string, unknown> }>("/api/work/scheduler/run"),
};
