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
 *
 * **An event can be dragged to another day, and the arrow keys do the same
 * thing.** Rescheduling was a four-step journey — open the event, open the
 * editor, change two datetimes, save — for the commonest change anybody makes
 * to a calendar. The keyboard path is not a consolation prize: a focused chip
 * takes ±1 day on Left/Right and ±7 on Up/Down, which is *faster* than the
 * mouse for "next Tuesday" and is the only path that works without one.
 *
 * A chip that cannot move says why on hover rather than simply failing to
 * lift — and the one that matters is a recurring series, because the platform
 * stores the rule and expands it, so moving one appearance would move them all
 * (§76).
 */

import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

import type { CalendarOccurrence } from "@/api/calendar";
import { addDays, isSameMonth, isToday, isoDay } from "@/lib/calendarGrid";

import { EventChip } from "./EventChip";
import { byDay } from "./hours";

export { EventChip } from "./EventChip";
export { byDay, clock, hourLabel, hourOf, hourSpan } from "./hours";

/** How many events one month cell shows before it starts counting. */
const CELL_LIMIT = 3;

const WEEKDAY_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthGrid({
  days,
  anchor,
  items,
  onOpen,
  onOpenDay,
  onMove,
  onAddOn,
}: {
  days: Date[];
  anchor: Date;
  items: CalendarOccurrence[];
  onOpen: (occurrence: CalendarOccurrence) => void;
  onOpenDay: (day: Date) => void;
  /** Reschedule to another day. Absent when the reader may not manage events. */
  onMove?: (occurrence: CalendarOccurrence, day: Date) => void;
  /** Start a new event on a day. Absent for the same reason. */
  onAddOn?: (day: Date) => void;
}) {
  const buckets = byDay(items);
  /** The day currently under a dragged chip, so the cell can say so. */
  const [over, setOver] = useState<string | null>(null);

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
                over === key ? "nu-month-cell--over" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              // `preventDefault` on drag-over is what makes a drop land at all;
              // without it the browser treats every element as hostile ground.
              onDragOver={
                onMove
                  ? (event) => {
                      event.preventDefault();
                      setOver(key);
                    }
                  : undefined
              }
              onDragLeave={onMove ? () => setOver((current) => (current === key ? null : current)) : undefined}
              onDrop={
                onMove
                  ? (event) => {
                      event.preventDefault();
                      setOver(null);
                      const moved = items.find(
                        (candidate) => candidate.id === event.dataTransfer.getData("text/plain"),
                      );
                      // Dropping an event back on its own day is not a change,
                      // and sending the write anyway would flash a toast for a
                      // gesture that did nothing.
                      if (moved && moved.day !== key) onMove(moved, day);
                    }
                  : undefined
              }
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
                {onAddOn && (
                  // Quiet until the cell is hovered or focused, so a month of
                  // thirty plus signs does not compete with the events.
                  <button
                    type="button"
                    className="nu-month-cell-add"
                    onClick={() => onAddOn(day)}
                    aria-label={`Add an event on ${key}`}
                    data-testid={`add-${key}`}
                  >
                    <PlusOutlined />
                  </button>
                )}
              </header>

              <div className="nu-month-cell-body">
                {shown.map((item) => (
                  <EventChip
                    key={item.id}
                    item={item}
                    onOpen={onOpen}
                    onMove={onMove ? (by) => onMove(item, addDays(day, by)) : undefined}
                  />
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
