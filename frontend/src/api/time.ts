import { api, download } from "./client";

/**
 * Time tracking (Time & decisions): the timer, entries, the week grid,
 * timesheets, reports and the export. See `services/timekeeping.py`.
 *
 * `minutes` is always the number that counts; a running timer reports its
 * elapsed seconds as well so the header pill can tick without asking again.
 */

export type SubjectType = "task" | "ticket" | "project";
export type SheetStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export interface TimeEntry {
  id: string;
  user_id: string;
  user_name: string | null;
  subject_type: SubjectType;
  subject_id: string | null;
  subject_label: string | null;
  link: string | null;
  project_id: string | null;
  customer_id: string | null;
  work_date: string | null;
  started_at: string | null;
  ended_at: string | null;
  minutes: number;
  elapsed_seconds: number | null;
  running: boolean;
  note: string;
  billable: boolean;
  source: "TIMER" | "MANUAL" | "GRID";
}

export interface TimerState {
  running: TimeEntry | null;
  today_minutes?: number;
  stopped?: TimeEntry | null;
}

export interface WeekRow {
  subject_type: SubjectType;
  subject_id: string;
  label: string | null;
  link: string | null;
  cells: Record<string, number>;
  fixed: Record<string, number>;
  total: number;
  billable_minutes: number;
}

export interface Timesheet {
  id: string | null;
  week_start: string;
  status: SheetStatus;
  submitted_at: string | null;
  decided_at: string | null;
  decision_comment: string;
  approval_id: string | null;
  total_minutes?: number;
}

export interface Week {
  user: { id: string; name: string };
  week_start: string;
  previous_week: string;
  next_week: string;
  days: string[];
  rows: WeekRow[];
  day_totals: Record<string, number>;
  total_minutes: number;
  billable_minutes: number;
  entries: TimeEntry[];
  timesheet: Timesheet;
  locked: boolean;
  can_edit: boolean;
  can_submit: boolean;
}

export interface TeamRow {
  user: { id: string; name: string; avatar_url: string | null; job_title: string | null };
  total_minutes: number;
  billable_minutes: number;
  status: SheetStatus;
  approval_id: string | null;
  submitted_at: string | null;
}

export interface Team {
  week_start: string;
  previous_week: string;
  next_week: string;
  items: TeamRow[];
  counts: Partial<Record<SheetStatus, number>>;
}

export type ReportGroup = "person" | "project" | "customer" | "subject" | "day";

export interface ReportRow {
  key: string | null;
  label: string;
  minutes: number;
  billable_minutes: number;
  entries: number;
}

export interface TimeReport {
  group_by: ReportGroup;
  items: ReportRow[];
  total_minutes: number;
  billable_minutes: number;
  people: number | null;
  can_see_everyone: boolean;
}

export interface Subject {
  subject_type: SubjectType;
  subject_id: string;
  label: string;
  recent: boolean;
}

export interface EntryList {
  items: TimeEntry[];
  total: number;
  page: number;
  page_size: number;
  total_minutes: number;
}

export interface EntryInput {
  subject_type: SubjectType;
  subject_id: string;
  work_date?: string;
  minutes?: number;
  started_at?: string;
  ended_at?: string;
  note?: string;
  billable?: boolean;
}

export interface ReportFilter {
  from?: string;
  to?: string;
  group_by?: ReportGroup;
  billable?: "true" | "false" | "";
  user_id?: string;
}

const T = "/api/time";

export const timeApi = {
  timer: (signal?: AbortSignal) => api.get<TimerState>(`${T}/timer`, { signal }),
  start: (body: { subject_type: SubjectType; subject_id: string; note?: string; billable?: boolean }) =>
    api.post<TimerState>(`${T}/timer`, body),
  stop: (body: { note?: string; billable?: boolean } = {}) => api.post<TimerState>(`${T}/timer/stop`, body),
  entries: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<EntryList>(`${T}/entries`, { params, signal }),
  create: (body: EntryInput) => api.post<TimeEntry>(`${T}/entries`, body),
  update: (id: string, body: Partial<EntryInput>) => api.put<TimeEntry>(`${T}/entries/${id}`, body),
  remove: (id: string) => api.delete<{ id: string; removed: boolean }>(`${T}/entries/${id}`),
  week: (params: { week?: string; user_id?: string }, signal?: AbortSignal) =>
    api.get<Week>(`${T}/week`, { params, signal }),
  cell: (body: { subject_type: SubjectType; subject_id: string; date: string; minutes: number }) =>
    api.put<Week>(`${T}/cell`, body),
  submit: (body: { week: string; note?: string }) => api.post<Week>(`${T}/submit`, body),
  team: (week: string | undefined, signal?: AbortSignal) =>
    api.get<Team>(`${T}/team`, { params: { week }, signal }),
  report: (params: ReportFilter, signal?: AbortSignal) =>
    api.get<TimeReport>(`${T}/report`, { params: { ...params }, signal }),
  exportFile: (params: ReportFilter & { format: "csv" | "xlsx" }) =>
    download(`${T}/export`, { params: { ...params }, fallbackName: `time-entries.${params.format}` }),
  subjects: (q: string, signal?: AbortSignal) =>
    api.get<{ items: Subject[] }>(`${T}/subjects`, { params: { q }, signal }),
  on: (subject_type: SubjectType, subject_id: string, signal?: AbortSignal) =>
    api.get<{ total_minutes: number; my_minutes: number; entries: TimeEntry[] }>(`${T}/on`, {
      params: { subject_type, subject_id },
      signal,
    }),
};

/** Minutes as "7h 30m", "45m", "0h". */
export function hours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const value = Math.abs(Math.round(minutes));
  const h = Math.floor(value / 60);
  const m = value % 60;
  if (!h) return `${sign}${m}m`;
  return m ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
}

/** Minutes as a decimal for the grid's input: 90 → "1.5". */
export function decimalHours(minutes: number): string {
  if (!minutes) return "";
  const value = Math.round((minutes / 60) * 100) / 100;
  return String(value);
}

/** What a person types into a cell — "1.5", "1:30", "90m", "2h" — as minutes. */
export function parseDuration(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return 0;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const parts = /^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text);
  if (parts && (parts[1] || parts[2])) {
    return Math.round(Number((parts[1] ?? "0").replace(",", ".")) * 60) + Number(parts[2] ?? 0);
  }
  const decimal = Number(text.replace(",", "."));
  if (Number.isFinite(decimal) && decimal >= 0) return Math.round(decimal * 60);
  return null;
}

/** Seconds as the pill's clock: 0:04:12. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** The Monday of the week a day falls in, as YYYY-MM-DD (local). */
export function mondayOf(day: Date = new Date()): string {
  const copy = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return isoDay(copy);
}

export function isoDay(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
