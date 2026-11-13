import { useQuery } from "@tanstack/react-query";
import { Tag, Typography } from "antd";
import { CheckCircleTwoTone } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { calendarApi } from "@/api/calendar";
import { SEMANTIC } from "@/theme/tokens";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/**
 * What is coming up, grouped by the day it lands on.
 *
 * An agenda rather than a month grid, because a month at card size is
 * forty-two boxes with nothing readable in them. What a person wants from a
 * calendar on a dashboard is the next few things and whether they have
 * answered the invitation.
 */
export function CalendarBody({ widget, fallback }: ModuleBodyProps) {
  const days = Math.max(1, Math.min(60, Number(widget.config.days ?? 7)));
  // Whole days, so the window is stable between renders and the query is not
  // refetched every time the clock ticks a second.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);

  const ahead = useQuery({
    queryKey: queryKeys.calendarWindow(from, to),
    queryFn: ({ signal }) => calendarApi.window({ from, to }, signal),
    staleTime: STALE.minute,
  });

  if (ahead.isLoading) return <Loading />;
  if (ahead.isError) return fallback(ahead.error, "calendar");

  const items = (ahead.data?.items ?? [])
    .slice()
    .sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""))
    .slice(0, ROWS);

  if (items.length === 0) {
    return <Nothing what={`Nothing in the next ${days} ${days === 1 ? "day" : "days"}`} />;
  }

  const awaiting = ahead.data?.counts.awaiting_response ?? 0;

  return (
    <>
      <ul className="nu-widget-agenda">
        {items.map((event, index) => {
          const newDay = index === 0 || event.day !== items[index - 1]?.day;
          return (
            <li key={event.id}>
              {newDay && <span className="nu-widget-agenda-day">{dayLabel(event.day)}</span>}
              <Link to={`/calendar?event=${event.event_id}`} className="nu-widget-agenda-row">
                <span className="nu-widget-agenda-time">
                  {event.all_day ? "all day" : timeOf(event.starts_at)}
                </span>
                <span className="nu-widget-agenda-bar" style={{ background: event.color }} aria-hidden />
                <Text ellipsis>{event.title}</Text>
                {event.my_response === "NEEDS_ACTION" && (
                  <Tag bordered={false} color="warning">
                    reply
                  </Tag>
                )}
                {event.my_response === "ACCEPTED" && (
                  <CheckCircleTwoTone twoToneColor={SEMANTIC.success} aria-label="Accepted" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <MoreLink to="/calendar">
        {awaiting > 0 ? `${awaiting} awaiting your reply` : "Open the calendar"}
      </MoreLink>
    </>
  );
}

/** "Today", "Tomorrow", then the weekday — how a person reads an agenda. */
function dayLabel(day: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${day}T00:00:00`);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return target.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function timeOf(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
