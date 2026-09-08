/**
 * The arithmetic behind a calendar grid (§19).
 *
 * Pure functions in a module of their own, because date arithmetic is where
 * calendars go wrong and none of these mistakes are visible in a screenshot: a
 * month grid that starts on the wrong weekday, a "next month" that lands on
 * the 31st and skips February, a week view whose Monday is last Monday. Each
 * is one assertion away from being ruled out and one afternoon away from being
 * found by a user.
 *
 * Two conventions held throughout.
 *
 * **The week starts on Monday.** Not configurable, and stated once here rather
 * than assumed in four places. A locale-aware first day is a real feature and a
 * different one; hard-coding it in two components and forgetting the third is
 * how a grid comes to disagree with its own column headings.
 *
 * **A window is half-open: `[from, to)`.** Midnight to midnight, so a day
 * belongs to exactly one window and an event at 00:00 is not in two of them.
 * The server's range filter reads it the same way.
 */

export type CalendarView = "month" | "week" | "day" | "agenda";

export const VIEWS: readonly CalendarView[] = ["month", "week", "day", "agenda"];

/** How many days forward an agenda looks. A fortnight is what fits a screen. */
export const AGENDA_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight, local, on the day the given moment falls in. */
export function startOfDay(when: Date): Date {
  const copy = new Date(when);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** The Monday of the given moment's week. */
export function startOfWeek(when: Date): Date {
  const day = startOfDay(when);
  // `getDay()` is 0 for Sunday, so Sunday is six days after its Monday.
  const offset = (day.getDay() + 6) % 7;
  return new Date(day.valueOf() - offset * DAY_MS);
}

export function startOfMonth(when: Date): Date {
  const day = startOfDay(when);
  day.setDate(1);
  return day;
}

/**
 * Add months without ever landing in the wrong one.
 *
 * `setMonth` on the 31st of January gives the 2nd or 3rd of March, because
 * February has no 31st — which is how a "next month" button skips a month
 * entirely. Anchoring to the 1st first makes that impossible, and the grid
 * only ever needs the month, not the day within it.
 */
export function addMonths(when: Date, months: number): Date {
  const first = startOfMonth(when);
  first.setMonth(first.getMonth() + months);
  return first;
}

export function addDays(when: Date, days: number): Date {
  return new Date(startOfDay(when).valueOf() + days * DAY_MS);
}

/**
 * The six-week grid a month view draws.
 *
 * Always six weeks — 42 cells — rather than however many the month needs. A
 * grid that changes height between May and June makes the whole page jump when
 * somebody pages through it, and the two trailing rows are the neighbouring
 * days a month view is supposed to show anyway.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_unused, index) => addDays(first, index));
}

export function weekGrid(anchor: Date): Date[] {
  const first = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_unused, index) => addDays(first, index));
}

/**
 * The window to ask the server for, given a view and where it is anchored.
 *
 * The *grid's* window and not the month's: a month view draws six weeks, and
 * asking for the month alone leaves the leading and trailing days empty for no
 * reason a reader can see.
 */
export function rangeFor(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  switch (view) {
    case "month": {
      const grid = monthGrid(anchor);
      return { from: grid[0]!, to: addDays(grid[41]!, 1) };
    }
    case "week": {
      const first = startOfWeek(anchor);
      return { from: first, to: addDays(first, 7) };
    }
    case "day": {
      const first = startOfDay(anchor);
      return { from: first, to: addDays(first, 1) };
    }
    case "agenda": {
      const first = startOfDay(anchor);
      return { from: first, to: addDays(first, AGENDA_DAYS) };
    }
  }
}

/** One step forward or back, in the unit the view is showing. */
export function shift(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  switch (view) {
    case "month":
      return addMonths(anchor, direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "day":
      return addDays(anchor, direction);
    case "agenda":
      return addDays(anchor, AGENDA_DAYS * direction);
  }
}

/** What the header says, in the unit the view is showing. */
export function titleFor(view: CalendarView, anchor: Date): string {
  const month = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  switch (view) {
    case "month":
      return month;
    case "week": {
      const days = weekGrid(anchor);
      return `${dayLabel(days[0]!)} – ${dayLabel(days[6]!)}`;
    }
    case "day":
      return anchor.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    case "agenda": {
      const last = addDays(anchor, AGENDA_DAYS - 1);
      return `${dayLabel(anchor)} – ${dayLabel(last)}`;
    }
  }
}

function dayLabel(when: Date): string {
  return when.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** `2026-03-10`, which is how the server keys an occurrence's day. */
export function isoDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

/**
 * Parse `2026-03-10` as a *local* day.
 *
 * `new Date("2026-03-10")` is parsed as UTC midnight, which in any negative
 * offset is the day before — so a calendar anchored from the address would
 * open on the 9th for a reader in New York. The parts are handed to the
 * constructor instead, which is local by definition.
 */
export function fromIsoDay(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function isSameDay(left: Date, right: Date): boolean {
  return isoDay(left) === isoDay(right);
}

export function isToday(when: Date, now: Date = new Date()): boolean {
  return isSameDay(when, now);
}

export function isSameMonth(when: Date, anchor: Date): boolean {
  return when.getFullYear() === anchor.getFullYear() && when.getMonth() === anchor.getMonth();
}

/**
 * A forward-looking day heading — "Today", "Tomorrow", then the date.
 *
 * `lib/time.dayBucket` exists and is not this: it labels the *past* ("Today",
 * "Yesterday", "Monday") because a feed looks backwards. An agenda looks
 * forwards, and "Yesterday" is not a heading it ever needs.
 */
export function agendaHeading(when: Date, now: Date = new Date()): string {
  const days = Math.round(
    (startOfDay(when).valueOf() - startOfDay(now).valueOf()) / DAY_MS,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return when.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
