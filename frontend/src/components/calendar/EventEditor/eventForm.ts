import dayjs,{ type Dayjs } from "dayjs";

import { type CalendarEvent, type EventRecurrence } from "@/api/calendar";

/** The unit an interval counts, per repeat. */
export const INTERVAL_UNIT: Record<string, string> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
};

export interface FormValues {
  title: string;
  category: string;
  location?: string;
  description?: string;
  when: [Dayjs, Dayjs];
  all_day: boolean;
  participants?: string[];
  repeat: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  interval?: number;
  byday?: string[];
  until?: Dayjs | null;
  reminder_minutes?: number | null;
}

/**
 * The form's repeat answers, as the server's rule document.
 *
 * Pure and exported: "every second week on Tuesday and Thursday" is a claim
 * worth asserting directly, and a wrong rule here produces a series nobody
 * ever sees — the quietest failure a calendar has.
 */
export function recurrenceOf(values: {
  repeat: string;
  interval?: number;
  byday?: string[];
}): EventRecurrence | null {
  if (values.repeat === "NONE") return null;
  const rule: EventRecurrence = {
    freq: values.repeat as EventRecurrence["freq"],
    interval: Math.max(Number(values.interval ?? 1) || 1, 1),
  };
  // `byday` is only meaningful weekly. Sending it with a monthly rule would
  // be a document the server accepts and the expander ignores, which reads as
  // the form having been ignored.
  if (values.repeat === "WEEKLY" && values.byday?.length) rule.byday = values.byday;
  return rule;
}

/** An existing event, as the form's values. */
export function valuesOf(event: CalendarEvent | null): Partial<FormValues> {
  if (!event) {
    const start = dayjs().add(1, "hour").startOf("hour");
    return {
      category: "MEETING",
      all_day: false,
      repeat: "NONE",
      interval: 1,
      when: [start, start.add(1, "hour")],
    };
  }
  return {
    title: event.title,
    category: event.category,
    location: event.location ?? undefined,
    description: event.description ?? undefined,
    all_day: event.all_day,
    when: [dayjs(event.starts_at), dayjs(event.ends_at)],
    participants: event.participants.map((person) => person.user_id),
    repeat: event.recurrence?.freq ?? "NONE",
    interval: event.recurrence?.interval ?? 1,
    byday: event.recurrence?.byday ?? [],
    until: event.recurrence_until ? dayjs(event.recurrence_until) : null,
    reminder_minutes: event.reminder_minutes,
  };
}
