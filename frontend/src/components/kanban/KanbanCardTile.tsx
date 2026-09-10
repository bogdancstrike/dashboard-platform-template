/**
 * One card on a board (§18).
 *
 * **Draggable and keyboard-movable, both through the same call.** Drag-and-drop
 * is the least accessible interaction there is, so the tile carries a "Move"
 * menu naming every lane. The two paths go through one mutation, which is what
 * stops them from diverging — a keyboard route that took a different endpoint
 * would be the one that breaks unnoticed (§64).
 *
 * **What is on the face is what a reader scans for**: the kind, the reference,
 * the title, and only the facts that are *there* — an assignee, a due date,
 * points, a checklist in progress. A tile with five empty slots on it is a
 * tile that says nothing about the card that has none of them.
 *
 * **The kind is a coloured edge, never a coloured tile.** A board of tinted
 * cards cannot also use colour for priority or lateness, and a tinted card
 * behind body text is a contrast failure waiting to be reported (§64).
 */

import { Dropdown, Progress, Tag, Tooltip, Typography } from "antd";
import { CheckSquareOutlined, DragOutlined, MessageOutlined } from "@ant-design/icons";

import type { KanbanCard, KanbanLane } from "@/api/kanban";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

/** What each kind is called on screen, and how its edge is coloured. */
export const KIND_LABELS: Record<string, string> = {
  EPIC: "Epic",
  STORY: "Story",
  TASK: "Task",
  BUG: "Bug",
};

export interface KanbanCardTileProps {
  card: KanbanCard;
  canEdit: boolean;
  /** Every lane on the board, for the keyboard move menu. */
  lanes: KanbanLane[];
  currentLane: KanbanLane;
  index: number;
  /** This is the card in the air, so it steps back and lets the slot lead. */
  carried?: boolean;
  onOpen: () => void;
  /** A card dropped on this tile, and the position the slot was open at. */
  onDropBefore: (cardId: string, position: number) => void;
  /**
   * The position the slot should open at while a card crosses this tile.
   *
   * Above its midpoint means *before* it, below means after — the same rule
   * every list with a drop indicator uses, and the reason a card dragged to
   * the bottom half of the last tile lands at the end rather than second-last.
   */
  onHoverAt: (position: number) => void;
  /** Announce that this tile is being dragged, or has stopped being. */
  onCarry: (dragging: boolean) => void;
  /** How many cards are in this lane, so the ends can be said to be ends. */
  laneSize: number;
  /** Reorder within the lane — the keyboard's equivalent of a short drag. */
  onMoveWithin: (position: number) => void;
  /**
   * The keyboard equivalent of dragging this card to another lane.
   *
   * A separate prop rather than reusing `onDropBefore`, because they are
   * different moves: one reorders within a lane, the other changes lane. The
   * *page* routes both through one mutation, which is what keeps the drag and
   * the menu from diverging.
   */
  onMoveToLane: (laneId: string) => void;
}

export function KanbanCardTile({
  card,
  canEdit,
  lanes,
  currentLane,
  index,
  laneSize,
  carried = false,
  onOpen,
  onDropBefore,
  onHoverAt,
  onCarry,
  onMoveWithin,
  onMoveToLane,
}: KanbanCardTileProps) {
  const overdue =
    card.due_date !== null && card.completed_at === null && new Date(card.due_date) < new Date();

  return (
    <article
      className={`nu-card nu-card--${card.kind.toLowerCase()}${carried ? " is-carried" : ""}`}
      data-testid={`card-${card.id}`}
      draggable={canEdit}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-nucleus-card", card.id);
        event.dataTransfer.effectAllowed = "move";
        // Also as React state, up in the lane: `dataTransfer` is unreadable
        // while a drag is in flight, so every hint drawn mid-gesture needs the
        // identity from somewhere the browser is not hiding it.
        onCarry(true);
      }}
      // Fires on an abandoned drag as well as a completed one, which is what
      // clears the slot when somebody presses Escape.
      onDragEnd={() => onCarry(false)}
      onDragOver={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        // Which half of the tile the pointer is in decides whether the card
        // goes before it or after it. Without this a drop anywhere on a tile
        // means "before", and reaching the end of a lane is impossible.
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > box.top + box.height / 2;
        onHoverAt(after ? index + 1 : index);
      }}
      onDrop={(event) => {
        event.preventDefault();
        // Stopped here so the lane's own handler does not also append it: a
        // drop on a card means "at the place the slot is open".
        event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > box.top + box.height / 2;
        const dropped = event.dataTransfer.getData("application/x-nucleus-card");
        onCarry(false);
        if (dropped && dropped !== card.id) onDropBefore(dropped, after ? index + 1 : index);
      }}
    >
      <header className="nu-card-head">
        <Tooltip title={KIND_LABELS[card.kind]}>
          <span className="nu-card-kind" aria-label={KIND_LABELS[card.kind]}>
            {card.kind.charAt(0)}
          </span>
        </Tooltip>
        <button type="button" className="nu-card-ref" onClick={onOpen}>
          {card.reference}
        </button>

        {canEdit && (
          <Dropdown
            trigger={["click"]}
            menu={{
              // The keyboard equivalent of the drag, through the same calls.
              // Both directions of it: dragging a card *within* a lane is a
              // reorder, and offering only "move to another lane" left the
              // ordering half of this board mouse-only (§18, §54).
              items: [
                {
                  key: "up",
                  label: "Move up in this lane",
                  disabled: index === 0,
                },
                {
                  key: "down",
                  label: "Move down in this lane",
                  disabled: index >= laneSize - 1,
                },
                ...(lanes.length > 1
                  ? [{ type: "divider" as const, key: "between" }]
                  : []),
                ...lanes
                  .filter((lane) => lane.id !== currentLane.id)
                  .map((lane) => ({ key: `lane:${lane.id}`, label: `Move to ${lane.name}` })),
              ],
              onClick: ({ key }) => {
                if (key === "up") onMoveWithin(index - 1);
                else if (key === "down") onMoveWithin(index + 1);
                else if (key.startsWith("lane:")) onMoveToLane(key.slice("lane:".length));
              },
            }}
          >
            <button
              type="button"
              className="nu-card-grip"
              aria-label={`Move ${card.reference}`}
            >
              <DragOutlined />
            </button>
          </Dropdown>
        )}
      </header>

      <button type="button" className="nu-card-title" onClick={onOpen}>
        {card.title}
      </button>

      <footer className="nu-card-foot">
        {/* Only what is *there*: a tile with five empty slots says nothing
            about a card that has none of them. */}
        {card.priority !== "NORMAL" && (
          <Tag
            bordered={false}
            color={card.priority === "CRITICAL" ? "error" : card.priority === "HIGH" ? "warning" : undefined}
          >
            {card.priority.toLowerCase()}
          </Tag>
        )}
        {card.labels.slice(0, 2).map((label) => (
          <Tag key={label} bordered={false}>
            {label}
          </Tag>
        ))}
        {card.labels.length > 2 && (
          <Tooltip title={card.labels.slice(2).join(", ")}>
            <Tag bordered={false}>+{card.labels.length - 2}</Tag>
          </Tooltip>
        )}
        {card.story_points !== null && (
          <Tooltip title={`${card.story_points} points`}>
            <span className="nu-card-points">{card.story_points}</span>
          </Tooltip>
        )}
        {card.checklist.length > 0 && (
          <Tooltip title={`${card.checklist_done} of ${card.checklist.length} done`}>
            <span className="nu-card-checklist">
              <CheckSquareOutlined /> {card.checklist_done}/{card.checklist.length}
            </span>
          </Tooltip>
        )}
        {/* Two comments is often the reason to open *this* card rather than
            the next one, and a tile that cannot say so makes the reader open
            all of them (§18). Drawn only when there is something to say. */}
        {card.comment_count > 0 && (
          <Tooltip
            title={`${card.comment_count} comment${card.comment_count === 1 ? "" : "s"}`}
          >
            <span className="nu-card-said" data-testid={`card-comments-${card.id}`}>
              <MessageOutlined /> {card.comment_count}
            </span>
          </Tooltip>
        )}
        {card.due_date && (
          <Tooltip title={absoluteTime(card.due_date)}>
            <Text type={overdue ? "danger" : "secondary"} className="nu-card-due">
              {relativeTime(card.due_date)}
            </Text>
          </Tooltip>
        )}
        {card.assignee.initials && (
          <Tooltip title={card.assignee.name}>
            <span className="nu-card-who" aria-label={card.assignee.name ?? undefined}>
              {card.assignee.initials}
            </span>
          </Tooltip>
        )}
      </footer>

      {card.checklist.length > 0 && (
        <Progress
          className="nu-card-progress"
          percent={Math.round((card.checklist_done / card.checklist.length) * 100)}
          size="small"
          showInfo={false}
          aria-label={`${card.reference}: ${card.checklist_done} of ${card.checklist.length} done`}
        />
      )}

      <span className="nu-card-position" hidden>
        {index}
      </span>
    </article>
  );
}
