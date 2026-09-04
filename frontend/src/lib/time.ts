/**
 * Timestamps, rendered the two ways an operational screen needs them.
 *
 * A feed wants "12 minutes ago", because the reader is asking *how fresh is
 * this*. A tooltip, an audit row or anything somebody may quote in a ticket
 * wants the absolute instant, because "2 hours ago" in a screenshot is
 * unfalsifiable a day later. Every relative timestamp in the app therefore
 * carries the absolute one within reach rather than instead of it.
 */

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
  return moment.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** The full instant, for tooltips and anything that may be quoted. */
export function absoluteTime(value: string | null | undefined): string {
  const moment = parseInstant(value);
  return moment ? moment.toLocaleString() : "—";
}
