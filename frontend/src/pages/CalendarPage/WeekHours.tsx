import { Typography } from "antd";
import { type CalendarOccurrence } from "@/api/calendar";
import { EventChip, byDay, hourLabel, hourOf, hourSpan } from "@/components/calendar/MonthGrid";
import { isToday, isoDay } from "@/lib/calendarGrid";

const { Text } = Typography;

/**
 * A week, as an hour grid.
 *
 * The first version of this was seven full-height columns of chips, and it
 * left six hundred pixels of nothing below a fortnight's meetings — the exact
 * "big empty space" the layout rules exist to remove (§20). An hour band fills
 * that space with the thing a week view is *for*: when in the day the work
 * actually sits.
 *
 * Placed by CSS grid and not by pixels. A desktop client positions events by
 * offset and width to lay overlaps side by side; that needs measurement, it
 * breaks under a font change, and it is unreadable below about 900 pixels.
 * Here an hour is a row, a day is a column, and two events in the same hour
 * simply stack in the cell — with the clash badge saying so, which is more
 * useful than two half-width boxes.
 *
 * The band is derived from the events, so a 07:03 standup is not hidden by a
 * grid that starts at 08:00, and a quiet week is not one row tall.
 */
export function WeekHours({
  days,
  items,
  onOpen,
  onAddAt,
}: {
  days: Date[];
  items: CalendarOccurrence[];
  onOpen: (occurrence: CalendarOccurrence) => void;
  /** Press an empty part of an hour to start an event there. */
  onAddAt?: (when: Date) => void;
}) {
  const now = new Date();
  const buckets = byDay(items);
  const span = hourSpan(items);
  const hours = Array.from(
    { length: span.to - span.from + 1 },
    (_unused, index) => span.from + index,
  );
  const allDay = items.filter((item) => item.all_day);

  return (
    <div
      className="nu-weekhours"
      data-testid="calendar-week"
      style={{ ["--days" as string]: days.length }}
    >
      <div className="nu-weekhours-head">
        <div className="nu-weekhours-corner" aria-hidden="true" />
        {days.map((day) => (
          <div
            key={isoDay(day)}
            className={`nu-weekhours-day${isToday(day) ? " nu-weekhours-day--today" : ""}`}
            data-testid={`week-day-${isoDay(day)}`}
          >
            <Text strong>{day.toLocaleDateString(undefined, { weekday: "short" })}</Text>{" "}
            <Text type={isToday(day) ? undefined : "secondary"}>{day.getDate()}</Text>
          </div>
        ))}
      </div>

      {/* All-day markers get a band of their own: a holiday placed at 00:00
          would push the hour band to midnight and leave eight empty rows. */}
      {allDay.length > 0 && (
        <div className="nu-weekhours-allday" data-testid="week-allday">
          <div className="nu-weekhours-axis">All day</div>
          {days.map((day) => (
            <div key={isoDay(day)} className="nu-weekhours-cell">
              {(buckets.get(isoDay(day)) ?? [])
                .filter((item) => item.all_day)
                .map((item) => (
                  <EventChip key={item.id} item={item} onOpen={onOpen} />
                ))}
            </div>
          ))}
        </div>
      )}

      <div className="nu-weekhours-body">
        {hours.map((hour) => (
          <div key={hour} className="nu-weekhours-row">
            <div className="nu-weekhours-axis">{hourLabel(hour)}</div>
            {days.map((day) => {
              const own = (buckets.get(isoDay(day)) ?? []).filter(
                (item) => !item.all_day && hourOf(item) === hour,
              );
              return (
                <div
                  key={isoDay(day)}
                  className={`nu-weekhours-cell${isToday(day) ? " nu-weekhours-cell--today" : ""}`}
                  // Labelled so a screen reader hears "Tuesday 09:00, 2
                  // events" rather than walking an unlabelled grid.
                  aria-label={`${day.toLocaleDateString(undefined, {
                    weekday: "long",
                  })} ${hourLabel(hour)}, ${own.length} ${own.length === 1 ? "event" : "events"}`}
                >
                  {isToday(day) && now.getHours() === hour && (
                    // Where "now" is, as a line across today's column.
                    <span
                      className="nx-cal-now"
                      aria-hidden
                      style={{ top: `${(now.getMinutes() / 60) * 100}%` }}
                    />
                  )}
                  {own.map((item) => (
                    <EventChip key={item.id} item={item} onOpen={onOpen} />
                  ))}
                  {onAddAt && (
                    <button
                      type="button"
                      className="nx-cal-slot"
                      aria-label={`New event ${day.toLocaleDateString(undefined, {
                        weekday: "long",
                      })} at ${hourLabel(hour)}`}
                      onClick={() => {
                        const when = new Date(day);
                        when.setHours(hour, 0, 0, 0);
                        onAddAt(when);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
