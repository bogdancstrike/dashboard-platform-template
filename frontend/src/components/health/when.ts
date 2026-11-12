/**
 * Short, readable moments for the health cards (§24).
 *
 * A card 340 pixels wide cannot carry "09/10/2026, 18:55:12 — 09/10/2026,
 * 19:55:12" and still be read; what a person scanning for "was it down at
 * four" needs is the day *named* and the clock time. The exact instant stays
 * one hover away, in a tooltip, for whoever has to quote it.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** "07:24". */
export function clock(moment: Date): string {
  return `${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

function startOfDay(moment: Date): number {
  return new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).valueOf();
}

/** "Today", "Yesterday", "Mon", or "12 Sep" — the day as a reader would say it. */
export function dayName(moment: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(moment)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return moment.toLocaleDateString(undefined, { weekday: "short" });
  return moment.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Today 02:55". */
export function shortWhen(value: string, now: Date = new Date()): string {
  const moment = new Date(value);
  if (Number.isNaN(moment.valueOf())) return "—";
  return `${dayName(moment, now)} ${clock(moment)}`;
}

/** "Today 02:55–03:55", or "Yesterday 23:10 – Today 01:40" across midnight. */
export function shortRange(from: string, to: string, now: Date = new Date()): string {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.valueOf()) || Number.isNaN(b.valueOf())) return "—";
  if (a.valueOf() === b.valueOf()) return shortWhen(from, now);
  if (startOfDay(a) === startOfDay(b)) return `${dayName(a, now)} ${clock(a)}–${clock(b)}`;
  return `${shortWhen(from, now)} – ${shortWhen(to, now)}`;
}

/** "200 ms", "1.2 s" — latency in the unit that keeps it short. */
export function latency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  return `${Math.round(ms)} ms`;
}

/** "just now", "2 min ago", "5 h ago", "3 days ago", "2 months ago" — never a bare date. */
export function ago(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const moment = new Date(value);
  if (Number.isNaN(moment.valueOf())) return "—";
  const minutes = Math.floor((now.valueOf() - moment.valueOf()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** A round ceiling for an axis: 47 → 50, 812 → 1000, 1430 → 1500. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const factor of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (factor * step >= value) return factor * step;
  }
  return 10 * step;
}
