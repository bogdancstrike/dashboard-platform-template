import { Tooltip } from "antd";
import { ExclamationCircleFilled } from "@ant-design/icons";

import type { CalendarOccurrence } from "@/api/calendar";
import { whyNotMovable } from "@/lib/calendarGrid";

import { clock } from "./hours";


/**
 * What each arrow key moves a focused chip by, in days.
 *
 * A week vertically and a day horizontally, because that is the shape of the
 * grid the chip is sitting in: Down lands in the cell directly below, which is
 * the same day next week.
 */
const KEY_MOVES: Record<string, number | undefined> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/** One event in a month cell: the time, the title, and what is wrong with it. */
export function EventChip({
  item,
  onOpen,
  onMove,
}: {
  item: CalendarOccurrence;
  onOpen: (occurrence: CalendarOccurrence) => void;
  /** Reschedule by a number of days. Absent where rescheduling is not offered. */
  onMove?: (byDays: number) => void;
}) {
  const cancelled = item.status === "CANCELLED";
  const unanswered = item.involves_me && item.my_response === "NEEDS_ACTION";
  const refusal = onMove ? whyNotMovable(item) : "Rescheduling is not yours to do";
  const movable = Boolean(onMove) && refusal === null;

  return (
    <button
      type="button"
      className={[
        "nu-event-chip",
        cancelled ? "nu-event-chip--cancelled" : "",
        unanswered ? "nu-event-chip--unanswered" : "",
        item.involves_me ? "nu-event-chip--mine" : "",
        movable ? "nu-event-chip--movable" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ borderInlineStartColor: item.color, ["--chip" as string]: item.color }}
      onClick={() => onOpen(item)}
      draggable={movable}
      onDragStart={
        movable
          ? (event) => {
              // The occurrence id, which the cell looks back up — rather than
              // a serialised event, because the two copies would disagree the
              // moment anything else refetched.
              event.dataTransfer.setData("text/plain", item.id);
              event.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      onKeyDown={
        movable && onMove
          ? (event) => {
              const by = KEY_MOVES[event.key];
              if (by === undefined || event.metaKey || event.ctrlKey) return;
              // Claimed before the page can scroll: arrows in a grid otherwise
              // move the viewport and the event at the same time.
              event.preventDefault();
              onMove(by);
            }
          : undefined
      }
      data-testid={`event-${item.id}`}
      title={movable ? `${item.title} — drag or use the arrow keys to move it` : item.title}
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
