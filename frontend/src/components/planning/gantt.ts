/**
 * The arithmetic of the timeline (§18), kept out of the component so it can be
 * read and tested without a chart on screen.
 *
 * Days are whole numbers — days since 1970-01-01 in UTC — because a Gantt
 * chart is a calendar of days: a bar that starts "at 14:00" is a bar that
 * starts on that day, and doing the sums in milliseconds is how a bar ends up
 * a pixel short across a daylight-saving change.
 */

import type { Dependency, TimelineBar, TimelineGroup } from "@/api/planning";

export type Zoom = "day" | "week" | "month" | "quarter";

export const ZOOMS: Record<Zoom, { px: number; label: string; before: number; after: number }> = {
  day: { px: 40, label: "Day", before: 10, after: 35 },
  week: { px: 18, label: "Week", before: 21, after: 90 },
  month: { px: 6, label: "Month", before: 45, after: 240 },
  quarter: { px: 2.4, label: "Quarter", before: 90, after: 540 },
};

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

export function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function parts(day: number) {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate(), w: (date.getUTCDay() + 6) % 7 };
}

/** "12 Nov" — the way a date reads on a bar's tooltip. */
export function shortDate(iso: string): string {
  const { m, d } = parts(toDay(iso));
  return `${d} ${MONTHS[m]}`;
}

/** The window a zoom shows around today, as ISO dates. */
export function windowFor(zoom: Zoom, today: string): { from: string; to: string } {
  const centre = toDay(today);
  return { from: fromDay(centre - ZOOMS[zoom].before), to: fromDay(centre + ZOOMS[zoom].after) };
}

export interface Tick {
  x: number;
  label: string;
  /** Saturday or Sunday, on the day zoom. */
  weekend?: boolean;
}

/**
 * The two header rows: a coarse one (months, or years) and a fine one (days,
 * weeks, months or quarters), positioned in pixels from the window's start.
 */
export function ticks(from: string, to: string, zoom: Zoom): { major: Tick[]; minor: Tick[] } {
  const start = toDay(from);
  const end = toDay(to);
  const px = ZOOMS[zoom].px;
  const major: Tick[] = [];
  const minor: Tick[] = [];
  for (let day = start; day <= end; day += 1) {
    const { y, m, d, w } = parts(day);
    const x = (day - start) * px;
    const monthStart = d === 1 || day === start;
    if (zoom === "day" || zoom === "week") {
      if (monthStart) major.push({ x, label: `${MONTHS[m]} ${y}` });
    } else if ((m === 0 && d === 1) || day === start) {
      major.push({ x, label: String(y) });
    }
    if (zoom === "day") minor.push({ x, label: String(d), weekend: w >= 5 });
    else if (zoom === "week" && w === 0) minor.push({ x, label: `${d} ${MONTHS[m]}` });
    else if (zoom === "month" && d === 1) minor.push({ x, label: MONTHS[m]! });
    else if (zoom === "quarter" && d === 1 && m % 3 === 0) minor.push({ x, label: `Q${m / 3 + 1}` });
  }
  return { major, minor };
}

/** Where a bar sits: left edge and width in pixels (a day is drawn whole). */
export function geometry(start: string, end: string, from: string, zoom: Zoom): { x: number; width: number } {
  const px = ZOOMS[zoom].px;
  const x = (toDay(start) - toDay(from)) * px;
  const width = Math.max(px, (toDay(end) - toDay(start) + 1) * px);
  return { x, width };
}

export type DragMode = "move" | "start" | "end";

/**
 * A bar after it has been dragged `delta` days. Moving keeps its length;
 * resizing keeps the other end, and never lets a bar shrink below a day.
 */
export function dragged(start: string, end: string, mode: DragMode, delta: number): { start: string; end: string } {
  const a = toDay(start);
  const b = toDay(end);
  if (mode === "move") return { start: fromDay(a + delta), end: fromDay(b + delta) };
  if (mode === "start") return { start: fromDay(Math.min(b, a + delta)), end };
  return { start, end: fromDay(Math.max(a, b + delta)) };
}

/** Pixels of pointer travel, as whole days at this zoom. */
export function daysFor(pixels: number, zoom: Zoom): number {
  return Math.round(pixels / ZOOMS[zoom].px);
}

/** Finish-to-start: the successor may start the day after, plus the lag. */
export function violates(predecessorEnd: string, successorStart: string, lag = 0): boolean {
  return toDay(successorStart) <= toDay(predecessorEnd) + lag;
}

export type Row =
  | { kind: "group"; key: string; group: TimelineGroup; y: number }
  | { kind: "bar"; key: string; bar: TimelineBar; group: string; y: number };

/** The chart's rows top to bottom: each group's header, then its bars unless folded. */
export function layout(groups: TimelineGroup[], folded: Set<string>, rowHeight: number): Row[] {
  const rows: Row[] = [];
  let y = 0;
  for (const group of groups) {
    rows.push({ kind: "group", key: `g:${group.key}`, group, y });
    y += rowHeight;
    if (folded.has(group.key)) continue;
    for (const bar of group.items) {
      rows.push({ kind: "bar", key: bar.id, bar, group: group.key, y });
      y += rowHeight;
    }
  }
  return rows;
}

/**
 * An arrow from the end of one bar to the start of another, drawn the way Jira
 * and MS Project draw it: out to the right, down (or up) to the successor's
 * row, and in from the left — doubling back underneath when the successor
 * starts before the predecessor ends.
 */
export function arrowPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rowHeight: number,
): string {
  const out = from.x + 10;
  const into = to.x - 10;
  if (into >= out) {
    return `M${from.x},${from.y} H${out} V${to.y} H${to.x}`;
  }
  const mid = from.y + (to.y >= from.y ? rowHeight / 2 : -rowHeight / 2);
  return `M${from.x},${from.y} H${out} V${mid} H${into} V${to.y} H${to.x}`;
}

/** Bars by id, with their row's centre, for drawing arrows. */
export function anchors(rows: Row[], from: string, zoom: Zoom, rowHeight: number) {
  const map = new Map<string, { x1: number; x2: number; y: number }>();
  for (const row of rows) {
    if (row.kind !== "bar") continue;
    const { x, width } = geometry(row.bar.start, row.bar.end, from, zoom);
    map.set(row.bar.id, { x1: x, x2: x + width, y: row.y + rowHeight / 2 });
  }
  return map;
}

/** Dependencies whose two ends are both drawn. */
export function visibleLinks(links: Dependency[], drawn: Map<string, unknown>): Dependency[] {
  return links.filter((link) => drawn.has(link.predecessor_id) && drawn.has(link.successor_id));
}

/**
 * Which links a proposed move would break, before it is written — the bar
 * turns amber under the pointer instead of after the round trip.
 */
export function brokenBy(
  id: string,
  start: string,
  end: string,
  links: Dependency[],
  bars: Map<string, TimelineBar>,
): Dependency[] {
  return links.filter((link) => {
    if (link.successor_id === id) {
      const pred = bars.get(link.predecessor_id);
      return pred ? violates(pred.end, start, link.lag_days) : false;
    }
    if (link.predecessor_id === id) {
      const succ = bars.get(link.successor_id);
      return succ ? violates(end, succ.start, link.lag_days) : false;
    }
    return false;
  });
}
