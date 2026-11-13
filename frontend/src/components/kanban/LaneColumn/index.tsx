/**
 * One column of a board: its header, its cards, and the ways to change it (§18).
 *
 * **Drag *and* a keyboard menu, always both.** A board that can only be
 * rearranged by dragging is a board somebody using a keyboard cannot use at
 * all, and drag-and-drop is the single least accessible interaction in a
 * product. Every card carries a "Move" menu that does exactly what the drag
 * does, through the same mutation (§64).
 *
 * **The header says what the server counted.** "In progress 12/3" is the whole
 * match against the limit, not the cards drawn — a lane shows the first
 * hundred. And when a lane is over its limit it says so, in words, and lets
 * the drop happen anyway: a board that argues gets worked around in a
 * spreadsheet, and then nobody can see the work at all.
 *
 * **Adding a card is one field, in place.** Description, assignee and points
 * are edited afterwards in the drawer; being asked for all of it before the
 * title exists is how a backlog stops being written down.
 *
 * **A drag shows where the card is going, not merely that it is moving.**
 * Unlike `/tasks`, this board is *arranged* rather than sorted, so dropping
 * between two cards is a real instruction — which makes it worth aiming at,
 * and worth drawing. A slot opens at the position under the pointer, the lane
 * says what the drop will do, and the card being carried steps back so the
 * slot is the thing that reads. Before this the whole gesture was a one-pixel
 * border change on the column, and the only way to find out where a card had
 * landed was to drop it.
 */

import { Input } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

import type { KanbanLane } from "@/api/kanban";
import { DropGap, type useBoardDrag } from "@/components/kanban/useBoardDrag";

import { KanbanCardTile } from "../KanbanCardTile";

import { LaneDialogs } from "./LaneDialogs";
import { LaneHeader } from "./LaneHeader";

export interface LaneColumnProps {
  lane: KanbanLane;
  canEdit: boolean;
  /** The other lanes, for the keyboard move menu and for re-homing cards. */
  others: KanbanLane[];
  onOpenCard: (id: string) => void;
  /** The board's drag engine — one for the whole board, because a drag crosses lanes. */
  board: ReturnType<typeof useBoardDrag>;
  /** Reorder within this lane, at `position`. */
  onMove: (cardId: string, position: number) => void;
  /** Move a card to another lane — the keyboard equivalent of the drag. */
  onMoveToLane: (cardId: string, laneId: string) => void;
  onAddCard: (title: string) => void;
  /** One call for every change to the lane itself — it is one row. */
  onChange: (input: { name?: string; wip_limit?: number | null; is_done?: boolean }) => void;
  onRemove: (moveTo?: string) => void;
}

export function LaneColumn({
  lane,
  canEdit,
  board,
  others,
  onOpenCard,
  onMove,
  onMoveToLane,
  onAddCard,
  onChange,
  onRemove,
}: LaneColumnProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dialog, setDialog] = useState<"rename" | "limit" | "remove" | null>(null);
  const [name, setName] = useState(lane.name);
  const [limit, setLimit] = useState<number | null>(lane.wip_limit);
  const [destination, setDestination] = useState<string>(others[0]?.id ?? "");

  /**
   * Create the card, from the field's *own* value.
   *
   * Not from the `title` state: React batches the update, so a reader who
   * types and hits Enter in the same tick — and every automated test that
   * fills and presses — submits the value the state had *before* the
   * keystroke, which is nothing. The card silently was not created.
   */
  const submit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) onAddCard(trimmed);
    setTitle("");
    setAdding(false);
  };

  const openDialog = (which: "rename" | "limit" | "remove") => {
    // Seeded on open rather than held in sync: the lane's own values are the
    // starting point, and a stale draft from a dialog somebody cancelled is
    // the classic way a rename applies the wrong name.
    setName(lane.name);
    setLimit(lane.wip_limit);
    setDestination(others[0]?.id ?? "");
    setDialog(which);
  };

  const drop = board.laneProps(lane.id);
  const carried = board.drag;
  const isSource = carried?.over.lane === lane.id && carried.from === lane.id;

  return (
    <section
      className={`nu-lane-col nx-rec-klane ${drop.className}${lane.over_limit ? " is-over-limit" : ""}`}
      data-drop-lane={drop["data-drop-lane"]}
      aria-label={lane.name}
      data-testid={`lane-${lane.id}`}
    >
      <LaneHeader lane={lane} canEdit={canEdit} others={others} onAdd={() => setAdding(true)} onChange={onChange} onDialog={openDialog} />

      {lane.over_limit && (
        <p className="nu-lane-col-warning">
          Over its limit of {lane.wip_limit}. Nothing is stopping you — it is worth a
          conversation.
        </p>
      )}

      <ol className="nu-lane-col-cards" data-drop-list={lane.id}>
        {board.renderLane(
          lane.id,
          lane.cards,
          (card) => card.id,
          (card, index) => (
            <li key={card.id}>
              <KanbanCardTile
                card={card}
                canEdit={canEdit}
                lanes={[lane, ...others]}
                currentLane={lane}
                index={index}
                laneSize={lane.cards.length}
                drag={board.cardProps(card.id, lane.id)}
                onOpen={() => onOpenCard(card.id)}
                onMoveWithin={(position) => onMove(card.id, position)}
                onMoveToLane={(laneId) => onMoveToLane(card.id, laneId)}
              />
            </li>
          ),
          (height) => (
            <DropGap key="gap" height={height} label={isSource ? "Back where it was" : "Drop here"} />
          ),
        )}
      </ol>

      {canEdit &&
        (adding ? (
          <Input.TextArea
            autoFocus
            rows={2}
            value={title}
            placeholder="What needs doing?"
            aria-label={`New card in ${lane.name}`}
            data-testid={`new-card-${lane.id}`}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={(event) => submit(event.target.value)}
            onPressEnter={(event) => {
              event.preventDefault();
              submit((event.target as HTMLTextAreaElement).value);
            }}
          />
        ) : (
          <button
            type="button"
            className="nu-lane-col-new"
            onClick={() => setAdding(true)}
            data-testid={`add-card-${lane.id}`}
          >
            <PlusOutlined /> Add a card
          </button>
        ))}

      <LaneDialogs
        lane={lane}
        others={others}
        dialog={dialog}
        onClose={() => setDialog(null)}
        name={name}
        onName={setName}
        limit={limit}
        onLimit={setLimit}
        destination={destination}
        onDestination={setDestination}
        onChange={onChange}
        onRemove={onRemove}
      />
    </section>
  );
}
