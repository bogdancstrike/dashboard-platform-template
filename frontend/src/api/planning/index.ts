/**
 * Work planning (§18): the timeline, sprints and backlog, templates and
 * recurring tasks. Every one reads the same `tasks` rows the board does.
 */

import { api } from "../client";

import type { Dependency, ScheduleResult, Timeline, TimelineGrouping } from "./timeline";
import type {
  Epic, LaneSetting, Recurrence, Sprint, SprintCard, SprintDetail, SprintReport, SprintState, TaskPlanning,
  TaskTemplate, Velocity,
} from "./work";

export type * from "./timeline";
export type * from "./work";

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
