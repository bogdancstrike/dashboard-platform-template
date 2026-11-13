/**
 * Tasks as a board (§7, §18, §33, §73).
 *
 * Work items are the one dataset where the *state* is the organising idea
 * rather than a column, so this is a board and not a table: lanes are the
 * status vocabulary, and the question it answers at a glance — where is
 * everything piled up? — is one a table answers only after sorting.
 *
 * Each lane is its **own query**. That is deliberate and it is the difference
 * between a board and a grouped page: a lane knows its own total from the
 * server, pages independently, and a hundred blocked tasks cannot push the
 * "in review" column off the screen. Grouping one downloaded page of rows
 * would show "3 in progress" for a project with ninety.
 *
 * **A move is a write to the record** (§9). It is applied optimistically —
 * a card that waits for a round trip before it lands does not feel like a
 * board — and then reconciled against the server rather than trusted: the
 * lane totals are aggregates only the database can compute, and a card that
 * moved on somebody else's screen has to come back to this one. A refused
 * move snaps back and says why.
 *
 * **A drag says what it is about to do, before it is dropped.** This is the
 * part a board lives or dies on, and the first version of this page had none
 * of it: a card was picked up and nothing on screen changed except a tint on
 * whichever column the pointer happened to be over. Somebody dragging had no
 * way to know whether the drop would take, and — because the lane is sorted
 * rather than arranged — no way to see where the card would end up.
 *
 * So four things happen while a card is in the air:
 *
 * * the card lifts, so it is obvious which one is moving;
 * * the lane under the pointer is marked, and its heading says the state the
 *   drop will write — "→ In review", not a highlight somebody has to
 *   interpret;
 * * a **slot opens where the card will actually land**, computed from the same
 *   ordering the server sorts by. On a sorted board you do not aim between two
 *   cards, and a board that lets you try is a board that then puts the card
 *   somewhere else. Showing the destination is the honest version of that;
 * * the lane it came from says "back where it was", because a drop that
 *   changes nothing should look like one.
 *
 * And after the drop the card stays marked until the server has confirmed it,
 * and the confirmation carries **Undo** — a move made by accident is one
 * gesture, and so is taking it back.
 *
 * Dragging is not the only way to do it. `Move to` on every card is the same
 * action from the keyboard (§54, §55), because a board reachable only by
 * pointer is a board half the readers cannot use.
 */

import { Alert, Button, Skeleton } from "antd";
import { DragOutlined, HolderOutlined, TableOutlined } from "@ant-design/icons";
import { useState } from "react";

import { PlanIcon } from "@/components/icons/PlanIcon";
import { ShortcutsModal, TemplatePicker, useBoardShortcuts, WipLimitsModal } from "@/components/planning/BoardExtras";
import { NewRecordButton } from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { useEntityList } from "@/entities/list";
import "@/styles/planning.css";

import { BoardToolbar } from "./BoardToolbar";
import { TaskLane } from "./TaskLane";
import { COLUMNS, type TaskRow } from "./types";
import { useTasksBoard } from "./useTasksBoard";

export default function TasksBoardPage() {
  const { view, records, navigate } = useEntityList<TaskRow>("task", "/tasks", { columns: COLUMNS, defaultSort: "priority" });
  const { resource, rows, setFilter } = view;
  const [templating, setTemplating] = useState(false);
  const [limiting, setLimiting] = useState(false);
  const [helping, setHelping] = useState(false);
  const canEdit = records.canEdit;
  const model = useTasksBoard(view, canEdit);
  const { swim, lanes, laneIds, swimKeys, swimLabel, keyFor, rowsIn, board, carried } = model;

  usePageCommands("entity:task", [
    {
      id: "task.new",
      label: "Create a task",
      keywords: "new add create",
      run: records.create,
    },
    {
      id: "task.overdue",
      label: "Show work that is behind",
      keywords: "late overdue due",
      run: () => setFilter("status", "BLOCKED"),
    },
    {
      id: "task.table",
      label: "See tasks as a table instead",
      keywords: "list grid columns",
      run: () => navigate("/explore?resource=task"),
    },
    {
      id: "task.template",
      label: "Create a task from a template",
      keywords: "new template checklist",
      run: () => setTemplating(true),
    },
    {
      id: "task.swim-assignee",
      label: "Split the board into swimlanes by assignee",
      keywords: "swimlane group person",
      run: () => view.set({ swim: "assignee" }),
    },
  ]);

  useBoardShortcuts({ onCreate: records.create, onHelp: () => setHelping(true) });

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="Where the work is piled up, lane by lane — each column counted by the server."
        actions={
          <>
            <NewRecordButton records={records} resource={resource} />
            <Button icon={<PlanIcon name="template" size={16} />} onClick={() => setTemplating(true)} data-testid="task-from-template">
              From template
            </Button>
            <Button icon={<TableOutlined />} onClick={() => navigate("/explore?resource=task")}>
              As a table
            </Button>
          </>
        }
      />

      <MetricStrip view={view} accents={["accent", "info", "neutral", "success"]} />
      <EntityFilters view={view} only={["priority", "kind"]} />
      <BoardToolbar view={view} model={model} onLimits={() => setLimiting(true)} onHelp={() => setHelping(true)} />
      <EntityError view={view} />

      {!canEdit && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          icon={<DragOutlined />}
          message="This board is read-only for you"
          description="Moving a card writes the task's status, which needs the records.update permission. Every lane is still counted and paged by the server, so the numbers are the whole dataset rather than this page of it."
        />
      )}

      {/* An empty board says so *once*, above the lanes (§34).
          Seven lanes each saying "Nothing here" is seven pieces of the same
          news, and it leaves the reader unsure whether the dataset is empty or
          their filter is — which is exactly the distinction these two states
          exist to draw. */}
      {(rows.data?.total ?? 0) === 0 && !rows.isLoading ? (
        <EntityEmpty
          view={view}
          title="No work items yet"
          hint="A task is a piece of work with an owner and a state."
          action={<NewRecordButton records={records} resource={view.resource} />}
        />
      ) : (
      <>
      {canEdit && (
        <div className="nx-rec-boardhint">
          <span>
            <HolderOutlined /> Drag a card anywhere — between two cards, to the top or bottom, or
            into another lane. Or focus it and press <kbd>Space</kbd>, the arrows, <kbd>Space</kbd>.
          </span>
          <span className="nx-rec-spacer" />
          <span>
            Each lane is counted by the server · {(rows.data?.total ?? 0).toLocaleString()} work
            items
          </span>
        </div>
      )}
      <div data-testid="task-board">
      {swimKeys.map((swimKey) => (
      <div key={swimKey || "none"} className={swim === "none" ? undefined : "nx-pl-swimlane"} data-testid={swim === "none" ? undefined : `swimlane-${swimKey || "none"}`}>
      {swim !== "none" && (
        <div className="nx-pl-swimlane-head">
          <span>{swimLabel(swimKey)}</span>
          <span className="nx-pl-count">
            {laneIds.reduce((sum, status) => sum + rowsIn(keyFor(swimKey, status)).length, 0)}
          </span>
        </div>
      )}
      <div
        className={`nu-board nx-rec-board${carried ? " is-dragging" : ""}`}
        data-drag-scroll
      >
        {lanes.map((lane, index) => (
          <TaskLane key={lane.status} model={model} lane={lane} index={index} swimKey={swimKey} records={records} />
        ))}
      </div>
      </div>
      ))}
      </div>
      {board.overlay}
      </>
      )}

      {records.drawer}
      <TemplatePicker open={templating} onClose={() => setTemplating(false)} onCreated={(id) => navigate(`/tasks/${id}`)} />
      <WipLimitsModal open={limiting} onClose={() => setLimiting(false)} />
      <ShortcutsModal open={helping} onClose={() => setHelping(false)} />
    </>
  );
}
