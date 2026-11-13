/**
 * The column beside the calendar (§19): a month to jump through, the
 * invitations waiting on an answer, and the kinds of event as toggles.
 *
 * Everything here reads the window the page already fetched — no second
 * request — so the counts beside a kind are the counts the grid is drawing.
 * Each section folds, and one control folds them all.
 */

import { Button, Space } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useState } from "react";

import type { CalendarOccurrence, EventResponse } from "@/api/calendar";
import { CollapseAllToggle } from "@/components/CollapseAllToggle";
import { humanStatus } from "@/components/StatusTag";
import { isToday, isoDay, monthGrid } from "@/lib/calendarGrid";
import { relativeTime } from "@/lib/time";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
type Section = "month" | "invites" | "kinds";
const SECTIONS: Section[] = ["month", "invites", "kinds"];

/** The colour each kind is drawn in, taken from the events themselves. */
export function colourByCategory(items: CalendarOccurrence[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) if (!out[item.category]) out[item.category] = item.color;
  return out;
}

export function CalendarAside({
  anchor,
  items,
  categories,
  counts,
  category,
  colours,
  onPick,
  onCategory,
  onOpen,
  onAnswer,
}: {
  anchor: Date;
  items: CalendarOccurrence[];
  categories: string[];
  counts: Record<string, number>;
  /** The kind the grid is narrowed to, or "" for every kind. */
  category: string;
  colours: Record<string, string>;
  onPick: (day: Date) => void;
  onCategory: (next: string | null) => void;
  onOpen: (item: CalendarOccurrence) => void;
  onAnswer: (eventId: string, response: EventResponse) => void;
}) {
  const [folded, setFolded] = useState<Set<Section>>(new Set());
  const [shown, setShown] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const toggle = (section: Section) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const busy = new Set(items.map((item) => item.day));
  const days = monthGrid(shown);
  // One row per *event*, not per occurrence: a weekly stand-up awaiting an
  // answer is one question, however many times it appears in the window.
  const seen = new Set<string>();
  const invites = items
    .filter((item) => item.involves_me && item.my_response === "NEEDS_ACTION")
    .filter((item) => (seen.has(item.event_id) ? false : (seen.add(item.event_id), true)))
    .slice(0, 5);

  const section = (key: Section, title: React.ReactNode, body: React.ReactNode) => (
    <section className="nx-rec-panel nx-cal-side" aria-label={typeof title === "string" ? title : undefined}>
      <button
        type="button"
        className="nx-cal-side-head"
        aria-expanded={!folded.has(key)}
        onClick={() => toggle(key)}
      >
        <h2>{title}</h2>
        <RightOutlined className={folded.has(key) ? "" : "is-open"} aria-hidden />
      </button>
      {!folded.has(key) && body}
    </section>
  );

  return (
    <aside className="nx-cal-aside" aria-label="Calendar tools">
      <div className="nx-cal-aside-top">
        <CollapseAllToggle
          allCollapsed={folded.size === SECTIONS.length}
          onToggle={(collapse) => setFolded(collapse ? new Set(SECTIONS) : new Set())}
          label="calendar sections"
        />
      </div>

      {section(
        "month",
        shown.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        <div className="nx-cal-mini" data-testid="mini-month">
          <div className="nx-cal-mini-nav">
            <Button
              type="text"
              icon={<LeftOutlined />}
              aria-label="Previous month"
              onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))}
            />
            <Button
              type="text"
              icon={<RightOutlined />}
              aria-label="Next month"
              onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))}
            />
          </div>
          <div className="nx-cal-mini-grid">
            {WEEKDAYS.map((label, index) => (
              <span key={`${label}${index}`} className="nx-cal-mini-wd" aria-hidden>
                {label}
              </span>
            ))}
            {days.map((day) => (
              <button
                key={isoDay(day)}
                type="button"
                className={[
                  "nx-cal-mini-day",
                  day.getMonth() !== shown.getMonth() ? "is-outside" : "",
                  isToday(day) ? "is-today" : "",
                  isoDay(day) === isoDay(anchor) ? "is-on" : "",
                  busy.has(isoDay(day)) ? "is-busy" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={day.toLocaleDateString(undefined, { dateStyle: "full" })}
                onClick={() => onPick(day)}
              >
                {day.getDate()}
              </button>
            ))}
          </div>
        </div>,
      )}

      {section(
        "invites",
        <>Invitations{invites.length > 0 && <span className="nx-cal-badge">{invites.length}</span>}</>,
        invites.length === 0 ? (
          <span className="nx-rec-panel-sub">Nothing waiting on an answer in this window.</span>
        ) : (
          <ul className="nx-cal-invites" data-testid="calendar-invitations">
            {invites.map((item) => (
              <li key={item.event_id}>
                <button type="button" className="nx-cal-invite-title" onClick={() => onOpen(item)}>
                  {item.title}
                </button>
                <span className="nx-cal-invite-meta">
                  {item.starts_at ? relativeTime(item.starts_at) : item.day}
                  {item.organizer.name ? ` · from ${item.organizer.name}` : ""}
                </span>
                <Space size={6} className="nx-cal-invite-actions">
                  <Button type="primary" onClick={() => onAnswer(item.event_id, "ACCEPTED")}>
                    Accept
                  </Button>
                  <Button onClick={() => onAnswer(item.event_id, "TENTATIVE")}>
                    Maybe
                  </Button>
                  <Button onClick={() => onAnswer(item.event_id, "DECLINED")}>
                    Decline
                  </Button>
                </Space>
              </li>
            ))}
          </ul>
        ),
      )}

      {section(
        "kinds",
        "Calendars",
        <ul className="nx-cal-kinds" data-testid="calendar-kinds">
          {categories.map((kind) => {
            const on = !category || category === kind;
            return (
              <li key={kind}>
                <button
                  type="button"
                  aria-pressed={category === kind}
                  className={on ? "is-on" : ""}
                  onClick={() => onCategory(category === kind ? null : kind)}
                >
                  <i style={{ background: colours[kind] ?? "var(--nu-accent)" }} aria-hidden />
                  <span>{humanStatus(kind)}</span>
                  <b>{(counts[kind] ?? 0).toLocaleString()}</b>
                </button>
              </li>
            );
          })}
        </ul>,
      )}
    </aside>
  );
}
