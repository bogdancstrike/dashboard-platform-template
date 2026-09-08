/**
 * A month, six weeks of it (§19, §20).
 *
 * Three decisions worth stating.
 *
 * **The grid fills the window and the cells share what is left.** A calendar
 * that ends where its rows do leaves a third of the page blank, and a month
 * view is the page somebody leaves open — so the rows are `1fr` each and the
 * *cell* scrolls when a day has more events than fit, rather than the page.
 *
 * **A day that cannot show everything says how many are left**, and the number
 * is a button that opens that day. "+3 more" that does nothing is the worst
 * possible version of this control: it tells a reader something is hidden and
 * offers no way to see it.
 *
 * **Colour is never the only carrier.** A cancelled event is struck through, a
 * clash carries a warning icon, and an unanswered invitation is outlined —
 * each of which survives being printed, screenshotted or read by somebody who
 * cannot separate the two greens (§64).
 */

import { Tooltip } from "antd";
import { ExclamationCircleFilled } from "@ant-design/icons";

import type { CalendarOccurrence } from "@/api/calendar";
import { isSameMonth, isToday, isoDay } from "@/lib/calendarGrid";

/** How many events one month cell shows before it starts counting. */
export const CELL_LIMIT = 3;

const WEEKDAY_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

export function MonthGrid({
  days,
  anchor,
  items,
  onOpen,
  onOpenDay,
}: {
  days: Date[];
  anchor: Date;
  items: CalendarOccurrence[];
  onOpen: (occurrence: CalendarOccurrence) => void;
  onOpenDay: (day: Date) => void;
}) {
  const buckets = byDay(items);

  return (
    <div className="nu-month" data-testid="calendar-month">
      <div className="nu-month-headings" aria-hidden="true">
        {WEEKDAY_HEADINGS.map((label) => (
          <div key={label} className="nu-month-heading">
            {label}
          </div>
        ))}
      </div>

      <div className="nu-month-grid">
        {days.map((day) => {
          const key = isoDay(day);
          const own = buckets.get(key) ?? [];
          const outside = !isSameMonth(day, anchor);
          const shown = own.slice(0, CELL_LIMIT);
          const hidden = own.length - shown.length;

          return (
            <section
              key={key}
              className={[
                "nu-month-cell",
                outside ? "nu-month-cell--outside" : "",
                isToday(day) ? "nu-month-cell--today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              // The label carries the count, so a reader on a screen reader
              // hears "10 March, 3 events" rather than counting list items.
              aria-label={`${day.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}, ${own.length} ${own.length === 1 ? "event" : "events"}`}
              data-testid={`day-${key}`}
            >
              <header className="nu-month-cell-head">
                <button
                  type="button"
                  className="nu-month-cell-date"
                  onClick={() => onOpenDay(day)}
                  aria-label={`Open ${key}`}
                >
                  {day.getDate()}
                </button>
              </header>

              <div className="nu-month-cell-body">
                {shown.map((item) => (
                  <EventChip key={item.id} item={item} onOpen={onOpen} />
                ))}
                {hidden > 0 && (
                  // A button, never a label: telling somebody three things are
                  // hidden and giving them no way to look is worse than not
                  // saying so.
                  <button
                    type="button"
                    className="nu-month-more"
                    onClick={() => onOpenDay(day)}
                    data-testid={`more-${key}`}
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** One event in a month cell: the time, the title, and what is wrong with it. */
export function EventChip({
  item,
  onOpen,
}: {
  item: CalendarOccurrence;
  onOpen: (occurrence: CalendarOccurrence) => void;
}) {
  const cancelled = item.status === "CANCELLED";
  const unanswered = item.involves_me && item.my_response === "NEEDS_ACTION";

  return (
    <button
      type="button"
      className={[
        "nu-event-chip",
        cancelled ? "nu-event-chip--cancelled" : "",
        unanswered ? "nu-event-chip--unanswered" : "",
        item.involves_me ? "nu-event-chip--mine" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ borderInlineStartColor: item.color }}
      onClick={() => onOpen(item)}
      data-testid={`event-${item.id}`}
      title={item.title}
    >
      {!item.all_day && <span className="nu-event-chip-time">{clock(item.starts_at)}</span>}
      <span className="nu-event-chip-title">{item.title}</span>
      {item.clashes_with.length > 0 && (
        // An icon *and* a sentence in the tooltip: colour alone is not a fact,
        // and "clashes" with no names is a hunt (§64).
        <Tooltip title={`Clashes with ${item.clashes_with.join(", ")}`}>
          <ExclamationCircleFilled className="nu-event-chip-clash" aria-label="Clashes" />
        </Tooltip>
      )}
    </button>
  );
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
