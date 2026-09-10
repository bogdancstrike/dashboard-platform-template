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

import {
  Button,
  Dropdown,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { Fragment, useState } from "react";

import type { KanbanLane } from "@/api/kanban";

import { KanbanCardTile } from "./KanbanCardTile";

const { Text } = Typography;

/**
 * The gap a card will drop into.
 *
 * A card-sized space rather than a line between two cards. On a board where
 * position is a real instruction, the honest picture of "it goes here" is the
 * room it will take up — and a two-pixel line is a target nobody can see
 * against a column of bordered tiles.
 */
function DropSlot() {
  return (
    <li className="nu-lane-col-slot" aria-hidden data-testid="drop-slot">
      <span>lands here</span>
    </li>
  );
}

export interface LaneColumnProps {
  lane: KanbanLane;
  canEdit: boolean;
  /** The other lanes, for the keyboard move menu and for re-homing cards. */
  others: KanbanLane[];
  onOpenCard: (id: string) => void;
  /** The card currently in the air, so the lane can show where it will land. */
  carried: { id: string; laneId: string } | null;
  /** Announce the card being dragged — see `carried`. */
  onCarry: (card: { id: string; laneId: string } | null) => void;
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
  carried,
  others,
  onOpenCard,
  onMove,
  onMoveToLane,
  onAddCard,
  onChange,
  onRemove,
  onCarry,
}: LaneColumnProps) {
  const [over, setOver] = useState(false);
  /**
   * The index the slot is open at, or `null` while nothing is over this lane.
   *
   * Held here rather than derived from the pointer on every frame: the tiles
   * report which of them is being crossed, and the lane itself reports the
   * space below the last one. Two sources, one answer, so the slot cannot
   * appear twice.
   */
  const [slot, setSlot] = useState<number | null>(null);
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

  return (
    <section
      className={`nu-lane-col${over ? " is-over" : ""}${lane.over_limit ? " is-over-limit" : ""}`}
      aria-label={lane.name}
      data-testid={`lane-${lane.id}`}
      onDragOver={(event) => {
        if (!canEdit || !carried) return;
        // Preventing the default is what marks this a valid drop target;
        // without it the browser refuses every drop silently.
        event.preventDefault();
        // And this is what makes the *cursor* agree: until a drop effect is
        // named the browser draws a "no entry" pointer, which is the loudest
        // "this will not work" a drag can say.
        event.dataTransfer.dropEffect = "move";
        setOver(true);
        // The column itself only ever means "at the end". A tile crossed on
        // the way down will have said otherwise, and it wins because it is the
        // more specific answer — hence `setSlot` only when nothing has.
        setSlot((current) => current ?? lane.cards.length);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
        setSlot(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const target = slot ?? lane.cards.length;
        setOver(false);
        setSlot(null);
        onCarry(null);
        const cardId = event.dataTransfer.getData("application/x-nucleus-card");
        // The position the slot was open at, which is the position the reader
        // was looking at when they let go. Appending regardless — which is what
        // this did — is a board that ignores half of every drag.
        if (cardId) onMove(cardId, target);
      }}
    >
      <header className="nu-lane-col-head">
        <span className="nu-lane-col-name">
          <Text strong>{lane.name}</Text>
          {lane.is_done && (
            <Tooltip title="Arriving here marks a card finished">
              <Tag bordered={false} color="success">
                done
              </Tag>
            </Tooltip>
          )}
        </span>

        <Space size={4}>
          <Tooltip
            title={
              lane.wip_limit === null
                ? `${lane.total} cards match`
                : `${lane.total} of a limit of ${lane.wip_limit}`
            }
          >
            {/* The server's count over the whole match, not the cards drawn. */}
            <Tag
              bordered={false}
              color={lane.over_limit ? "warning" : undefined}
              className="nu-lane-col-count"
            >
              {lane.wip_limit === null ? lane.total : `${lane.total}/${lane.wip_limit}`}
            </Tag>
          </Tooltip>

          {canEdit && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "add", icon: <PlusOutlined />, label: "Add a card" },
                  { key: "rename", label: "Rename this lane" },
                  {
                    key: "limit",
                    label:
                      lane.wip_limit === null
                        ? "Set a work-in-progress limit"
                        : "Change the limit",
                  },
                  {
                    key: "done",
                    label: lane.is_done ? "No longer the done lane" : "Make this the done lane",
                  },
                  {
                    key: "remove",
                    danger: true,
                    // Says what happens to the work, because that is the
                    // question somebody is actually asking.
                    // "1 card moves" and "2 cards move": the verb agrees
                    // with the noun, which the first version did not.
                    label:
                      lane.total > 0
                        ? `Remove — ${lane.total === 1 ? "1 card moves" : `${lane.total} cards move`}`
                        : "Remove this lane",
                    disabled: others.length === 0,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "add") setAdding(true);
                  else if (key === "done") onChange({ is_done: !lane.is_done });
                  else openDialog(key as "rename" | "limit" | "remove");
                },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                aria-label={`Actions for ${lane.name}`}
                data-testid={`lane-actions-${lane.id}`}
              />
            </Dropdown>
          )}
        </Space>
      </header>

      {lane.over_limit && (
        <p className="nu-lane-col-warning">
          Over its limit of {lane.wip_limit}. Nothing is stopping you — it is worth a
          conversation.
        </p>
      )}

      <ol className="nu-lane-col-cards">
        {lane.cards.map((card, index) => (
          <Fragment key={card.id}>
            {slot === index && carried && <DropSlot />}
            <li>
              <KanbanCardTile
                card={card}
                canEdit={canEdit}
                lanes={[lane, ...others]}
                currentLane={lane}
                index={index}
                laneSize={lane.cards.length}
                carried={carried?.id === card.id}
                onOpen={() => onOpenCard(card.id)}
                onDropBefore={(cardId, position) => onMove(cardId, position)}
                onHoverAt={(position) => setSlot(position)}
                onCarry={(dragged) => onCarry(dragged ? { id: card.id, laneId: lane.id } : null)}
                onMoveWithin={(position) => onMove(card.id, position)}
                onMoveToLane={(laneId) => onMoveToLane(card.id, laneId)}
              />
            </li>
          </Fragment>
        ))}
        {carried && slot !== null && slot >= lane.cards.length && <DropSlot />}
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

      <Modal
        open={dialog === "rename"}
        title={`Rename ${lane.name}`}
        okText="Rename"
        okButtonProps={{ disabled: !name.trim() }}
        onCancel={() => setDialog(null)}
        onOk={() => {
          onChange({ name: name.trim() });
          setDialog(null);
        }}
      >
        <Input
          autoFocus
          value={name}
          aria-label="Lane name"
          onChange={(event) => setName(event.target.value)}
        />
      </Modal>

      <Modal
        open={dialog === "limit"}
        title={`Work-in-progress limit for ${lane.name}`}
        okText="Save"
        onCancel={() => setDialog(null)}
        onOk={() => {
          onChange({ wip_limit: limit && limit > 0 ? limit : null });
          setDialog(null);
        }}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <InputNumber
            min={1}
            value={limit ?? undefined}
            placeholder="No limit"
            aria-label="Work-in-progress limit"
            style={{ width: "100%" }}
            onChange={(value) => setLimit(value ?? null)}
          />
          <Text type="secondary">
            A limit warns when the lane goes over it. It never stops a card moving — a board
            that argues gets worked around.
          </Text>
        </Space>
      </Modal>

      <Modal
        open={dialog === "remove"}
        title={`Remove ${lane.name}?`}
        okText="Remove the lane"
        okButtonProps={{ danger: true }}
        onCancel={() => setDialog(null)}
        onOk={() => {
          onRemove(destination || undefined);
          setDialog(null);
        }}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>
            {lane.total > 0
              ? `${lane.total} card${lane.total === 1 ? "" : "s"} will move. Nothing is deleted.`
              : "The lane is empty."}
          </Text>
          {lane.total > 0 && (
            <Select
              aria-label="Move the cards to"
              style={{ width: "100%" }}
              value={destination || others[0]?.id}
              onChange={setDestination}
              options={others.map((item) => ({ value: item.id, label: item.name }))}
            />
          )}
        </Space>
      </Modal>
    </section>
  );
}
