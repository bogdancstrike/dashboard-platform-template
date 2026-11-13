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

import { Alert, Button, Card, Segmented, Skeleton, Space, Tag, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { CalendarAside, colourByCategory } from "@/components/calendar/CalendarAside";

import { ApiError } from "@/api/client";
import { EventDrawer } from "@/components/calendar/EventDrawer";
import { EventEditor } from "@/components/calendar/EventEditor";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { PageHeader } from "@/components/PageHeader";
import { isoDay, monthGrid, weekGrid, type CalendarView } from "@/lib/calendarGrid";

import { Agenda } from "./Agenda";
import { WeekHours } from "./WeekHours";
import { VIEW_LABELS } from "./views";

import { CalendarBar } from "./CalendarBar";
import { useCalendarPage } from "./useCalendarPage";

export default function CalendarPage() {
  const m = useCalendarPage();
  const { opened, setOpened, editing, setEditing, creatingOn, setCreatingOn, composing, setComposing, view, anchor, category, onlyMine, set, events, refresh, answer, reschedule } = m;

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

      <div className="nu-fill nx-cal-layout">
        <Card
          size="small"
          className="nu-pane"
          data-testid="calendar-pane"
          title={
            <CalendarBar view={view} anchor={anchor} category={category} onlyMine={onlyMine} data={data} set={set} />
          }
        >
          {view === "month" && (
            <MonthGrid
              days={monthGrid(anchor)}
              anchor={anchor}
              items={items}
              onOpen={setOpened}
              onOpenDay={openDay}
              // Both absent for a reader who may not manage events, so the
              // chips are not draggable and the cells offer no plus — rather
              // than gestures that end in a refusal (§76).
              onMove={
                data?.can_manage
                  ? (item, day) => reschedule.mutate({ item, day })
                  : undefined
              }
              onAddOn={
                data?.can_manage
                  ? (day) => {
                      setCreatingOn(day);
                      setComposing(true);
                    }
                  : undefined
              }
            />
          )}

          {(view === "week" || view === "day") && (
            <WeekHours
              days={view === "week" ? weekGrid(anchor) : [anchor]}
              items={items}
              onOpen={setOpened}
              onAddAt={
                data?.can_manage
                  ? (when) => {
                      setCreatingOn(when);
                      setComposing(true);
                    }
                  : undefined
              }
            />
          )}

          {view === "agenda" && (
            <Agenda
              items={items}
              onOpen={setOpened}
              onAnswer={(id, response) => answer.mutate({ id, response })}
            />
          )}
        </Card>
        <CalendarAside
          anchor={anchor}
          items={items}
          categories={data?.categories ?? []}
          counts={counts?.by_category ?? {}}
          category={category}
          colours={colourByCategory(items)}
          onPick={(day) => set({ on: isoDay(day) })}
          onCategory={(next) => set({ category: next })}
          onOpen={setOpened}
          onAnswer={(id, response) => answer.mutate({ id, response })}
        />
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
