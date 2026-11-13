import type { CalendarOccurrence } from "@/api/calendar";

/**
 * Occurrences bucketed by the day they belong to.
 *
 * Keyed on the server's own `day`, not on a date parsed in the browser: the
 * server decided which day an occurrence falls in, and a second opinion
 * computed from a timestamp is how an event at 00:30 ends up in yesterday's
 * cell for readers in one half of the world.
 */
export function byDay(
  items: readonly CalendarOccurrence[],
): Map<string, CalendarOccurrence[]> {
  const buckets = new Map<string, CalendarOccurrence[]>();
  for (const item of items) {
    const bucket = buckets.get(item.day);
    if (bucket) bucket.push(item);
    else buckets.set(item.day, [item]);
  }
  return buckets;
}

/** `09:30`, in the reader's own locale. */
export function clock(value: string | null): string {
  if (!value) return "";
  const moment = new Date(value);
  if (Number.isNaN(moment.valueOf())) return "";
  return moment.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * The band of hours a week view needs to draw.
 *
 * Derived from the events rather than fixed at 00:00–23:00, because a grid of
 * twenty-four rows is twenty of them empty — and fixed at 08:00–18:00 it
 * silently hides the 07:30 standup. Clamped to a working day so a week with
 * one lunchtime meeting is not a single row either.
 *
 * Pure and exported: "the earliest event is at 07:03, so the grid starts at
 * 07" is a claim worth asserting without a browser.
 */
export function hourSpan(
  items: readonly CalendarOccurrence[],
  { earliest = 8, latest = 18 } = {},
): { from: number; to: number } {
  let from = earliest;
  let to = latest;
  for (const item of items) {
    if (item.all_day) continue;
    const start = new Date(item.starts_at ?? "");
    const end = new Date(item.ends_at ?? "");
    if (!Number.isNaN(start.valueOf())) from = Math.min(from, start.getHours());
    if (!Number.isNaN(end.valueOf())) {
      // An event ending exactly on the hour does not need that hour's row.
      const hour = end.getMinutes() === 0 ? end.getHours() - 1 : end.getHours();
      to = Math.max(to, hour);
    }
  }
  return { from: Math.max(0, from), to: Math.min(23, Math.max(to, from)) };
}

/** `09:00`, for an hour axis label. */
export function hourLabel(hour: number): string {
  const at = new Date();
  at.setHours(hour, 0, 0, 0);
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Which hour row an occurrence belongs to. */
export function hourOf(item: CalendarOccurrence): number {
  const start = new Date(item.starts_at ?? "");
  return Number.isNaN(start.valueOf()) ? 0 : start.getHours();
}
