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
import { CheckSquareOutlined, DragOutlined } from "@ant-design/icons";

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
  onOpen: () => void;
  /** A card dropped onto this one takes its place. */
  onDropBefore: (cardId: string) => void;
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
  onOpen,
  onDropBefore,
  onMoveToLane,
}: KanbanCardTileProps) {
  const overdue =
    card.due_date !== null && card.completed_at === null && new Date(card.due_date) < new Date();

  return (
    <article
      className={`nu-card nu-card--${card.kind.toLowerCase()}`}
      data-testid={`card-${card.id}`}
      draggable={canEdit}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-nucleus-card", card.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        if (canEdit) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        // Stopped here so the lane's own handler does not also append it: a
        // drop on a card means "in front of this one".
        event.stopPropagation();
        const dropped = event.dataTransfer.getData("application/x-nucleus-card");
        if (dropped && dropped !== card.id) onDropBefore(dropped);
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
              // The keyboard equivalent of the drag, through the same call.
              items: lanes
                .filter((lane) => lane.id !== currentLane.id)
                .map((lane) => ({ key: lane.id, label: `Move to ${lane.name}` })),
              onClick: ({ key }) => onMoveToLane(String(key)),
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
