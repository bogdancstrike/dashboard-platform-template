/**
 * `/calendar` — a window of time, and what is in it (§19, §20).
 *
 * Four decisions worth stating.
 *
 * **The view and the day live in the address.** `?view=week&on=2026-03-10` is
 * a link somebody can send, and the back button steps through where they have
 * been (§69). A calendar whose position is component state is a calendar you
 * cannot point at.
 *
 * **The window asked for is the *grid's*, not the month's.** A month view
 * draws six weeks; asking the server for the month alone leaves the leading and
 * trailing days blank for no reason a reader can see. `rangeFor` decides it
 * once, and the same function tells the header what it is looking at.
 *
 * **The grid fills the window and the cells scroll, never the page.** A
 * calendar is the page people leave open, and one that ends where its rows do
 * wastes a third of the screen (§20).
 *
 * **Unanswered invitations are the only count that is a to-do list.** So that
 * is the one on the header, as a filter — "17 events this month" is a fact
 * nobody acts on, and "3 you have not answered" is three clicks of work.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { LeftOutlined, PlusOutlined, RightOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  calendarApi,
  type CalendarEvent,
  type CalendarOccurrence,
  type EventResponse,
} from "@/api/calendar";
import { ApiError } from "@/api/client";
import { EventDrawer } from "@/components/calendar/EventDrawer";
import { EventEditor } from "@/components/calendar/EventEditor";
import {
  EventChip,
  MonthGrid,
  byDay,
  clock,
  hourLabel,
  hourOf,
  hourSpan,
} from "@/components/calendar/MonthGrid";
import { ResponseButtons } from "@/components/calendar/ResponseButtons";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { EmptyState } from "@/components/EmptyState";
import {
  agendaHeading,
  fromIsoDay,
  isToday,
  isoDay,
  monthGrid,
  rangeFor,
  shift,
  titleFor,
  weekGrid,
  type CalendarView,
} from "@/lib/calendarGrid";

const { Text, Title } = Typography;

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  agenda: "Agenda",
};

function asView(raw: string | null): CalendarView {
  return raw === "week" || raw === "day" || raw === "agenda" ? raw : "month";
}

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const [opened, setOpened] = useState<CalendarOccurrence | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creatingOn, setCreatingOn] = useState<Date | null>(null);
  const [composing, setComposing] = useState(false);

  const view = asView(params.get("view"));
  // Memoised on the *parameter*, not recomputed: `?? new Date()` is a fresh
  // object every render, so the window below it changed identity every render,
  // the query key with it, and the calendar refetched forever. The lint rule
  // called this a dependency warning; it was an infinite loop.
  const on = params.get("on");
  const anchor = useMemo(() => fromIsoDay(on) ?? new Date(), [on]);
  const category = params.get("category") ?? "";
  const onlyMine = params.get("mine") === "1";

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const events = useQuery({
    queryKey: ["calendar", range.from.toISOString(), range.to.toISOString(), category, onlyMine],
    queryFn: ({ signal }) =>
      calendarApi.window(
        {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          ...(category ? { category } : {}),
          ...(onlyMine ? { mine: "1" } : {}),
        },
        signal,
      ),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["calendar-event"] });
  };

  const answer = useMutation({
    mutationFn: ({ id, response }: { id: string; response: EventResponse }) =>
      calendarApi.respond(id, response),
    onSuccess: (updated) => {
      message.success(`Answered for ${updated.title}`);
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That answer was refused."),
  });

  usePageCommands("calendar", [
    {
      id: "calendar.new",
      label: "Add an event",
      keywords: "meeting calendar event new",
      run: () => {
        setCreatingOn(anchor);
        setComposing(true);
      },
    },
    {
      id: "calendar.today",
      label: "Go to today in the calendar",
      keywords: "today now jump",
      run: () => set({ on: null }),
    },
    {
      id: "calendar.unanswered",
      label: "Show the invitations I have not answered",
      keywords: "rsvp invitation unanswered",
      run: () => set({ view: "agenda", mine: "1" }),
    },
  ]);

  if (events.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (events.isError) {
    return (
      <>
        <PageHeader title="Calendar" />
        <Alert
          type="error"
          showIcon
          message={
            events.error instanceof ApiError
              ? events.error.message
              : "The calendar could not be loaded."
          }
          action={
            <Button onClick={() => void events.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const data = events.data;
  const items = data?.items ?? [];
  const counts = data?.counts;

  const step = (direction: 1 | -1) => set({ on: isoDay(shift(view, anchor, direction)) });

  const openDay = (day: Date) => set({ view: "day", on: isoDay(day) });

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="What is happening, who is coming, and what you have not answered yet."
        tag={
          counts && counts.awaiting_response > 0 ? (
            // The only count worth acting on, so it is the only one promoted
            // to the header — and it is a filter, not a decoration.
            <Tooltip title="Invitations you have not answered. Everything else is a fact, this is a to-do list.">
              <Tag
                color="blue"
                className="nu-clickable-tag"
                onClick={() => set({ view: "agenda", mine: "1" })}
              >
                {counts.awaiting_response} to answer
              </Tag>
            </Tooltip>
          ) : undefined
        }
        actions={
          <Space size={8}>
            <Segmented
              aria-label="View"
              data-testid="calendar-view"
              value={view}
              onChange={(next) => set({ view: String(next) })}
              options={(Object.keys(VIEW_LABELS) as CalendarView[]).map((item) => ({
                value: item,
                label: VIEW_LABELS[item],
              }))}
            />
            {data?.can_manage && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setCreatingOn(anchor);
                  setComposing(true);
                }}
                data-testid="new-event"
              >
                Add one
              </Button>
            )}
          </Space>
        }
      />

      <div className="nu-fill">
        <Card
          size="small"
          className="nu-pane"
          data-testid="calendar-pane"
          title={
            <div className="nu-cal-bar">
              <Space size={4}>
                <Button
                  type="text"
                  icon={<LeftOutlined />}
                  onClick={() => step(-1)}
                  aria-label="Previous"
                  data-testid="cal-prev"
                />
                <Button
                  type="text"
                  icon={<RightOutlined />}
                  onClick={() => step(1)}
                  aria-label="Next"
                  data-testid="cal-next"
                />
                <Button onClick={() => set({ on: null })} data-testid="cal-today">
                  Today
                </Button>
              </Space>

              <Title level={5} className="nu-cal-title" data-testid="cal-title">
                {titleFor(view, anchor)}
              </Title>

              <Space size={8}>
                <Select
                  aria-label="Kind"
                  allowClear
                  placeholder="Every kind"
                  value={category || undefined}
                  onChange={(next: string | undefined) => set({ category: next ?? null })}
                  style={{ minWidth: 148 }}
                  options={(data?.categories ?? []).map((item) => ({
                    value: item,
                    label: `${item.charAt(0)}${item.slice(1).toLowerCase()}${
                      counts?.by_category[item] ? ` (${counts.by_category[item]})` : ""
                    }`,
                  }))}
                />
                <Segmented
                  aria-label="Whose"
                  value={onlyMine ? "mine" : "all"}
                  onChange={(next) => set({ mine: next === "mine" ? "1" : null })}
                  options={[
                    { value: "all", label: `Everybody (${counts?.total ?? 0})` },
                    { value: "mine", label: `Mine (${counts?.mine ?? 0})` },
                  ]}
                />
              </Space>
            </div>
          }
        >
          {view === "month" && (
            <MonthGrid
              days={monthGrid(anchor)}
              anchor={anchor}
              items={items}
              onOpen={setOpened}
              onOpenDay={openDay}
            />
          )}

          {view === "week" && (
            <WeekHours days={weekGrid(anchor)} items={items} onOpen={setOpened} />
          )}

          {(view === "day" || view === "agenda") && (
            <Agenda
              items={items}
              onOpen={setOpened}
              onAnswer={(id, response) => answer.mutate({ id, response })}
            />
          )}
        </Card>
      </div>

      <EventDrawer
        occurrence={opened}
        onClose={() => setOpened(null)}
        onChanged={refresh}
        onEdit={(occurrence) => {
          setEditing(occurrence);
          setComposing(true);
          setOpened(null);
        }}
      />

      <EventEditor
        open={composing}
        event={editing}
        day={creatingOn}
        categories={data?.categories ?? []}
        onClose={() => {
          setComposing(false);
          setEditing(null);
        }}
        onSaved={() => {
          setComposing(false);
          setEditing(null);
          refresh();
        }}
      />
    </>
  );
}

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
function WeekHours({
  days,
  items,
  onOpen,
}: {
  days: Date[];
  items: CalendarOccurrence[];
  onOpen: (occurrence: CalendarOccurrence) => void;
}) {
  const buckets = byDay(items);
  const span = hourSpan(items);
  const hours = Array.from(
    { length: span.to - span.from + 1 },
    (_unused, index) => span.from + index,
  );
  const allDay = items.filter((item) => item.all_day);

  return (
    <div className="nu-weekhours" data-testid="calendar-week">
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
                  {own.map((item) => (
                    <EventChip key={item.id} item={item} onOpen={onOpen} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}


/**
 * A list of what is coming, grouped by day.
 *
 * The view that answers "what am I doing" rather than "what does the month
 * look like" — and the only one where answering an invitation is one click,
 * because that is the reason somebody opens a list of their own events.
 */
function Agenda({
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
