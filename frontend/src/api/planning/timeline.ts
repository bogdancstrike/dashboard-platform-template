/** The shapes of the timeline: bars, groups, dependencies and scheduling results. */

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
