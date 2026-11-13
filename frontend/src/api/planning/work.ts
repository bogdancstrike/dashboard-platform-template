/** The shapes of sprints, the backlog, task planning, templates and lanes. */

import type { PlanPerson } from "./timeline";

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
