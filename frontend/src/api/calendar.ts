import { api } from "./client";

/**
 * The calendar (§19).
 *
 * The collection is a *window*, and what comes back are **occurrences** rather
 * than rows: the server expands a recurring series over the range asked for.
 * That is the one thing to keep in mind reading these types — `id` is
 * `<event id>:<start>` and only `event_id` is a primary key. Expanding a
 * series here would mean a second implementation of the recurrence rule, and
 * the two would disagree about the last Friday of a month long before anybody
 * noticed.
 *
 * See `services/calendar.py`.
 */

export type EventResponse = "NEEDS_ACTION" | "ACCEPTED" | "TENTATIVE" | "DECLINED";

export interface EventParticipant {
  user_id: string;
  name: string | null;
  email: string | null;
  /**
   * From the server, like every other person the platform draws:
   * `core/naming.initials` is the one rule, and computing them here is how
   * "Ada Marie Administrator" came to be `AA` on one screen and `AM` on
   * another.
   */
  initials: string;
  response: EventResponse;
}

/** An RRULE-shaped repeat. The server both expands and describes it. */
export interface EventRecurrence {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byday?: string[];
}

export interface CalendarEvent {
  /** For an occurrence, `<event id>:<start>`. For the series itself, its id. */
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  category: string;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  organizer: { id: string | null; name: string | null };
  project_id: string | null;
  task_id: string | null;
  participants: EventParticipant[];
  recurrence: EventRecurrence | null;
  recurrence_until: string | null;
  /** Rendered by the module that expands it, so the two cannot disagree. */
  recurrence_text: string;
  reminder_minutes: number | null;
  color: string;
  involves_me: boolean;
  my_response: EventResponse | null;
  /** The server's answer, so a control is disabled for a reason it knows. */
  can_edit: boolean;
}

/** One appearance of an event inside the requested window. */
export interface CalendarOccurrence extends CalendarEvent {
  /** `2026-03-10` — the day this occurrence belongs to. */
  day: string;
  minutes: number;
  is_occurrence: boolean;
  /**
   * The titles it overlaps *for this reader*. Named rather than counted:
   * "clashes with the Design review" is actionable, "1 clash" is a hunt.
   */
  clashes_with: string[];
}

export interface CalendarWindow {
  from: string;
  to: string;
  items: CalendarOccurrence[];
  total: number;
  counts: {
    total: number;
    mine: number;
    /** Invitations nobody has answered — the only count that is a to-do list. */
    awaiting_response: number;
    by_category: Record<string, number>;
  };
  categories: string[];
  statuses: string[];
  responses: EventResponse[];
  can_manage: boolean;
}

export type CalendarEventInput = Partial<{
  title: string;
  description: string | null;
  category: string;
  status: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  participants: Array<{ user_id: string; response?: EventResponse }>;
  recurrence: EventRecurrence | null;
  recurrence_until: string | null;
  reminder_minutes: number | null;
  project_id: string | null;
  task_id: string | null;
}>;

export const calendarApi = {
  /**
   * Everything in a window, expanded. Both ends are required — the server
   * refuses an open range rather than expanding every series it holds.
   */
  window: (
    params: { from: string; to: string; category?: string; mine?: string },
    signal?: AbortSignal,
  ) => api.get<CalendarWindow>("/api/calendar/events", { params, signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<CalendarEvent>(`/api/calendar/events/${id}`, { signal }),
  create: (body: CalendarEventInput) =>
    api.post<CalendarEvent>("/api/calendar/events", body),
  /** Changes the whole series. The page says so before it is used. */
  update: (id: string, body: CalendarEventInput) =>
    api.put<CalendarEvent>(`/api/calendar/events/${id}`, body),
  remove: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/api/calendar/events/${id}`),
  /** Say whether *you* are coming. Needs only `calendar.view`. */
  respond: (id: string, response: EventResponse) =>
    api.post<CalendarEvent>(`/api/calendar/events/${id}/respond`, { response }),
};
