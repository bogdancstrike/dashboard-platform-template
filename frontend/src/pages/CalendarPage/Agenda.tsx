import { Typography } from "antd";
import { type CalendarOccurrence, type EventResponse } from "@/api/calendar";
import { clock } from "@/components/calendar/MonthGrid";
import { ResponseButtons } from "@/components/calendar/ResponseButtons";
import { EmptyState } from "@/components/EmptyState";
import { agendaHeading, fromIsoDay } from "@/lib/calendarGrid";

const { Text } = Typography;

/**
 * A list of what is coming, grouped by day.
 *
 * The view that answers "what am I doing" rather than "what does the month
 * look like" — and the only one where answering an invitation is one click,
 * because that is the reason somebody opens a list of their own events.
 */
export function Agenda({
  items,
  onOpen,
  onAnswer,
}: {
  items: CalendarOccurrence[];
  onOpen: (occurrence: CalendarOccurrence) => void;
  onAnswer: (id: string, response: EventResponse) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState compact title="Nothing in this stretch of the calendar" />
    );
  }

  // Grouped on the server's own `day`, and the headings look *forwards* —
  // `lib/time.dayBucket` labels the past because a feed does.
  const groups: Array<{ day: string; items: CalendarOccurrence[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.day === item.day) last.items.push(item);
    else groups.push({ day: item.day, items: [item] });
  }

  return (
    <div className="nu-agenda" data-testid="calendar-agenda">
      {groups.map((group) => (
        <section key={group.day} className="nu-agenda-day">
          <header className="nu-agenda-head">
            <Text strong>{agendaHeading(fromIsoDay(group.day) ?? new Date())}</Text>
            <Text type="secondary">
              {group.items.length} {group.items.length === 1 ? "event" : "events"}
            </Text>
          </header>

          {group.items.map((item) => (
            <div
              key={item.id}
              className={`nu-agenda-row${item.status === "CANCELLED" ? " nu-agenda-row--cancelled" : ""}`}
              data-testid={`agenda-${item.id}`}
            >
              <div className="nu-agenda-when">
                <Text strong>{item.all_day ? "All day" : clock(item.starts_at)}</Text>
                {!item.all_day && (
                  <Text type="secondary">{clock(item.ends_at)}</Text>
                )}
              </div>

              <div className="nu-agenda-what">
                <button
                  type="button"
                  className="nu-link-button"
                  onClick={() => onOpen(item)}
                >
                  {item.title}
                </button>
                <Text type="secondary" className="nu-agenda-meta">
                  {[
                    item.category.toLowerCase(),
                    item.location,
                    item.is_occurrence ? item.recurrence_text : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {item.clashes_with.length > 0 && (
                  <Text type="warning" className="nu-agenda-clash">
                    Clashes with {item.clashes_with.join(", ")}
                  </Text>
                )}
              </div>

              {/* One click, in the list — the reason somebody opens their own
                  agenda is usually to answer these. */}
              {item.involves_me && item.status !== "CANCELLED" && (
                <ResponseButtons
                  label={`Your answer to ${item.title}`}
                  value={item.my_response}
                  onChange={(response) => onAnswer(item.event_id, response)}
                />
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
