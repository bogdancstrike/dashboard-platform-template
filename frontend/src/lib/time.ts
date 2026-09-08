/**
 * Timestamps, rendered the two ways an operational screen needs them.
 *
 * A feed wants "12 minutes ago", because the reader is asking *how fresh is
 * this*. A tooltip, an audit row or anything somebody may quote in a ticket
 * wants the absolute instant, because "2 hours ago" in a screenshot is
 * unfalsifiable a day later. Every relative timestamp in the app therefore
 * carries the absolute one within reach rather than instead of it.
 */

import { formatDate, formatDateTime } from "./formats";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Parse an API timestamp, or `null` when it is absent or unparseable. */
export function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/**
 * "just now" · "12m ago" · "3h ago" · "2d ago" · a date beyond a week.
 *
 * Deliberately not a live-updating component. A list of forty rows each
 * re-rendering every second to advance a minute counter is a lot of work for
 * an effect nobody is watching for.
 */
export function relativeTime(value: string | null | undefined, now: Date = new Date()): string {
  const moment = parseInstant(value);
  if (!moment) return "—";

  const delta = now.valueOf() - moment.valueOf();
  if (delta < 0) return moment.toLocaleDateString();
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return formatDate(moment);
}

/** The full instant, for tooltips and anything that may be quoted. */
export function absoluteTime(value: string | null | undefined): string {
  const moment = parseInstant(value);
  // The reader's own format (§40), not the browser's locale: somebody who has
  // asked for ISO dates has asked for them everywhere, including here.
  return moment ? formatDateTime(moment) : "—";
}

/**
 * The day a timestamp belongs to, named the way a reader would name it.
 *
 * A feed of forty rows each stamped "3d ago" is a wall of text; the same rows
 * under *Today* / *Yesterday* / *Monday 2 September* are skimmable, because
 * the eye can find the boundary between "while I was here" and "before I
 * arrived" without reading a single row.
 */
export function dayBucket(value: string | null | undefined, now: Date = new Date()): string {
  const moment = parseInstant(value);
  if (!moment) return "Undated";

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((midnight.valueOf() - moment.valueOf()) / DAY) + 1;

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) {
    return moment.toLocaleDateString(undefined, { weekday: "long" });
  }
  return moment.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(moment.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * Rows in the order they arrived, split into runs that share a day.
 *
 * Written here because two pages already needed it and a third was about to
 * write it again: the notifications page and the activity feed both take a
 * list the server has already ordered and put a heading in wherever the day
 * changes. Three copies of a loop like this is three chances to get the
 * boundary condition wrong, and the mistake — a heading repeated because two
 * adjacent buckets compared unequal — is one nobody reads a diff to find.
 *
 * The list is *not* re-sorted. The server decided the order, and a client that
 * sorted again would disagree with the pagination that produced it.
 */
export function groupByDay<T>(
  items: readonly T[],
  instantOf: (item: T) => string | null | undefined,
  now: Date = new Date(),
): { label: string; items: T[] }[] {
  const buckets: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayBucket(instantOf(item), now);
    const last = buckets[buckets.length - 1];
    if (last && last.label === label) last.items.push(item);
    else buckets.push({ label, items: [item] });
  }
  return buckets;
}
