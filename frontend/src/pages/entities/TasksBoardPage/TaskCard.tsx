import { Tooltip } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";

import type { useBoardDrag } from "@/components/kanban/useBoardDrag";
import { AgeDots, CardBadges } from "@/components/planning/BoardExtras";
import { RecordActions, type RecordEditing } from "@/components/records/useRecordEditing";
import { StatusTag } from "@/components/StatusTag";
import { absoluteTime, relativeTime } from "@/lib/time";
import { knownStatusColor } from "@/theme/tokens";

import type { TaskRow } from "./types";

/**
 * One card.
 *
 * The whole card is the handle: pressed and moved with a mouse, held and
 * moved with a finger, or focused and carried with the keyboard (Space, the
 * arrows, Space). There is no separate "Move to" control — the drag *is* the
 * way to move a card, and it works for every way of pointing (§54).
 */
export function TaskCard({
  task,
  lane,
  drag,
  saving,
  records,
  onOpen,
  epicName,
}: {
  /** The card's epic, named — a chip on the card (§18). */
  epicName?: string;
  task: TaskRow;
  lane: string;
  drag: ReturnType<ReturnType<typeof useBoardDrag>["cardProps"]>;
  /** Its move is written and not yet confirmed. */
  saving: boolean;
  records: RecordEditing;
  onOpen: () => void;
}) {
  const { className, ...handlers } = drag;
  const overdue =
    task.due_date && lane !== "DONE" && lane !== "CANCELLED" && new Date(task.due_date) < new Date();
  const progress = Number(task.progress ?? 0);
  return (
    <article
      {...handlers}
      className={`nu-task-card nx-rec-card ${className}${saving ? " is-saving" : ""}`}
      data-testid={`task-card-${task.reference ?? task.id}`}
      data-board-card
      aria-label={`${task.reference ?? ""} ${task.title ?? ""}`.trim()}
      onClick={onOpen}
      onKeyDown={(event) => {
        handlers.onKeyDown(event);
        if (!event.defaultPrevented && event.key === "Enter" && event.target === event.currentTarget) {
          onOpen();
        }
      }}
    >
      {task.cover_color && (
        <span className="nx-pl-cover" style={{ ["--nx-pl-tone" as string]: task.cover_color }} aria-hidden />
      )}
      <div className="nx-rec-card-top">
        <StatusTag status={task.priority} />
        <span className="nu-task-ref">{task.reference}</span>
        <AgeDots since={task.status_changed_at} closed={lane === "DONE" || lane === "CANCELLED"} />
        <span className="nx-rec-spacer" />
        <span onClick={(event) => event.stopPropagation()} data-no-drag>
          <RecordActions
            records={records}
            id={task.id}
            label={task.reference ?? task.title ?? "this task"}
          />
        </span>
      </div>
      <span className="nu-task-title">{task.title}</span>
      <CardBadges task={task} epicName={epicName} />
      <span
        className="nx-rec-card-bar"
        role="img"
        aria-label={`${task.reference}: ${progress}% done`}
      >
        <i style={{ width: `${Math.min(100, progress)}%`, background: knownStatusColor(lane) }} />
      </span>
      <span className="nu-task-meta">
        <span>{task.kind ? task.kind.charAt(0) + task.kind.slice(1).toLowerCase() : ""}</span>
        {task.due_date && (
          <Tooltip title={absoluteTime(task.due_date)}>
            <span className={overdue ? "is-late" : undefined}>
              <ClockCircleOutlined /> {relativeTime(task.due_date)}
            </span>
          </Tooltip>
        )}
        <span className="nx-rec-spacer" />
        <span className="nx-rec-num">
          {Math.round(Number(task.logged_hours ?? 0))}/{Math.round(Number(task.estimate_hours ?? 0))}h
        </span>
      </span>
    </article>
  );
}
