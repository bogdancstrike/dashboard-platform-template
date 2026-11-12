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

import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Skeleton, Tooltip } from "antd";
import { ClockCircleOutlined, DragOutlined, HolderOutlined, PlusOutlined, TableOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { explorerApi, type ExplorerRequest } from "@/api/explorer";
import { taskBoardApi } from "@/api/taskBoard";
import {
  NewRecordButton,
  RecordActions,
  useRecordEditing,
  type RecordEditing,
} from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime, relativeTime } from "@/lib/time";
import { knownStatusColor } from "@/theme/tokens";
import { StatusTag } from "@/components/StatusTag";
import { refreshRecordViews } from "@/lib/refresh";
import { EmptyState } from "@/components/EmptyState";
import { DropGap, useBoardDrag, type DropTarget } from "@/components/kanban/useBoardDrag";

/** Rows fetched per lane. A lane is scanned, not read to the end. */
const PER_LANE = 12;

const COLUMNS = [
  "reference", "title", "status", "priority", "kind",
  "due_date", "progress", "estimate_hours", "logged_hours", "updated_at", "board_position",
];

/** One drop: where to, between whom, and how to take it back. */
interface Move {
  task: TaskRow;
  to: string;
  /** Position in the target lane, counted without the card. */
  index: number;
  afterId: string | null;
  beforeId: string | null;
  undo?: Omit<Move, "task" | "undo">;
}

interface TaskRow {
  id: string;
  reference?: string;
  title?: string;
  status?: string;
  priority?: string;
  kind?: string;
  due_date?: string | null;
  progress?: number;
  estimate_hours?: number;
  logged_hours?: number;
  updated_at?: string | null;
}

export default function TasksBoardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const view = useEntityView("task", { columns: COLUMNS, defaultSort: "priority" });
  const { resource, rows, filters, term, setFilter } = view;

  /** Cards whose move is written and not yet confirmed, so they stay marked. */
  const [pending, setPending] = useState<string[]>([]);
  const records = useRecordEditing(resource, {
    onCreated: (id) => navigate(`/tasks/${id}`),
  });

  /**
   * The lanes, and their order.
   *
   * Taken from the field's declared choices rather than from the values that
   * happen to be present: an empty "Blocked" lane is information, and a board
   * whose columns appear and disappear as work moves is one nobody can learn.
   */
  const lanes = useMemo(() => {
    const field = resource?.fields.find((item) => item.name === "status");
    const counts = new Map(
      (rows.data?.facets["status"] ?? []).map((facet) => [facet.value, facet.count]),
    );
    return (field?.choices ?? []).map((status) => ({
      status,
      total: counts.get(status) ?? 0,
    }));
  }, [resource, rows.data]);

  const laneQueries = useQueries({
    queries: lanes.map((lane) => ({
      queryKey: ["task-lane", lane.status, term, filters],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        explorerApi.query(
          {
            resource_type: "task",
            query_text: term,
            filters: { ...filters, status: lane.status },
            columns: COLUMNS,
            page: 1,
            page_size: PER_LANE,
            // The board's own, hand-made order (§18): what a drop wrote is
            // what a reload shows.
            sort: "board_position",
            order: "asc",
          } satisfies ExplorerRequest,
          signal,
        ),
      enabled: Boolean(resource),
    })),
  });

  /** What a lane is called on screen — the vocabulary, not the enum. */
  const laneName = (status: string) => status.replace(/_/g, " ").toLowerCase();

  /**
   * Moving a card writes the record's status.
   *
   * Optimistic, then reconciled: the card lands immediately, and every lane is
   * refetched on the way out whether the write succeeded or failed. The totals
   * beside each lane name are counted over the whole dataset, so they cannot
   * be adjusted here without lying about the rows nobody has loaded.
   */
  const move = useMutation({
    mutationFn: ({ task, to, afterId, beforeId }: Move) =>
      taskBoardApi.place(task.id, {
        status: to,
        after_id: afterId,
        before_id: beforeId,
        expected_updated_at: task.updated_at ?? null,
      }),
    onMutate: async ({ task, to, index }) => {
      setPending((current) => [...current, task.id]);
      await queryClient.cancelQueries({ queryKey: ["task-lane"] });
      const fromKey = ["task-lane", task.status ?? "", term, filters];
      const toKey = ["task-lane", to, term, filters];
      const previous = [
        [fromKey, queryClient.getQueryData(fromKey)],
        [toKey, queryClient.getQueryData(toKey)],
      ] as const;
      // Move the card between the two lane caches by hand, so the drop lands
      // exactly where the gap was drawn before the round trip. Counts are
      // left alone deliberately — see above.
      queryClient.setQueryData(fromKey, (current: unknown) => withoutTask(current, task.id));
      queryClient.setQueryData(toKey, (current: unknown) =>
        withTask(current, { ...task, status: to }, index),
      );
      return { previous };
    },
    onError: (error, { task }, context) => {
      // Put both lanes back exactly as they were, so the card is seen to
      // return rather than vanish, and say why: a card that snaps back with
      // no explanation reads as a broken drag rather than a lost race.
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      const conflict = error instanceof ApiError && error.status === 409;
      message.error(
        conflict
          ? `${task.title ?? "That task"} moved on somebody else's screen — reloading the board.`
          : error instanceof ApiError
            ? error.message
            : "That move could not be saved.",
      );
    },
    onSuccess: (saved, { task, to, undo }) => {
      const from = task.status ?? "";
      if (!undo) return;
      // Confirmed, and taking it back is one press. A board is a surface
      // people drag on quickly, which means it is a surface people drop on
      // the wrong place quickly.
      message.success({
        content: (
          <span>
            {task.reference ?? "Task"} {from === to ? "reordered in" : "moved to"}{" "}
            {laneName(to)}{" "}
            <Button
              type="text"
              onClick={() =>
                move.mutate({
                  ...undo,
                  task: { ...task, status: to, updated_at: saved.updated_at ?? task.updated_at },
                })
              }
            >
              Undo
            </Button>
          </span>
        ),
        duration: 6,
      });
    },
    onSettled: (_saved, _error, { task }) => {
      setPending((current) => current.filter((id) => id !== task.id));
      void queryClient.invalidateQueries({ queryKey: ["task-lane"] });
      refreshRecordViews(queryClient);
    },
  });

  const canEdit = records.canEdit;

  /** Every card drawn, by id, so the drag can name and move it. */
  const laneRows = lanes.map((lane, index) =>
    ((laneQueries[index]?.data?.items ?? []) as TaskRow[]).map((task) => ({
      ...task,
      status: task.status ?? lane.status,
    })),
  );
  const byId = new Map(laneRows.flat().map((task) => [task.id, task]));
  const laneIds = lanes.map((lane) => lane.status);

  /** The neighbours a card would have at `index` of `lane`, counted without it. */
  const neighbours = (lane: string, index: number, id: string) => {
    const rows = (laneRows[laneIds.indexOf(lane)] ?? []).filter((row) => row.id !== id);
    return { afterId: rows[index - 1]?.id ?? null, beforeId: rows[index]?.id ?? null };
  };

  const board = useBoardDrag({
    enabled: canEdit,
    lanes: laneIds,
    items: (lane) => (laneRows[laneIds.indexOf(lane)] ?? []).map((task) => task.id),
    // The lanes are arranged by hand, so a card lands exactly where the gap
    // was open: between any two cards, at the top, at the bottom, in its own
    // lane or another one.
    onDrop: (id, from, to: DropTarget) => {
      const task = byId.get(id);
      if (!task || !canEdit) return;
      const origin = Math.max(0, (laneRows[laneIds.indexOf(from)] ?? []).findIndex((row) => row.id === id));
      move.mutate({
        task,
        to: to.lane,
        index: to.index,
        ...neighbours(to.lane, to.index, id),
        undo: { to: from, index: origin, ...neighbours(from, origin, id) },
      });
    },
    describe: (id) => {
      const task = byId.get(id);
      return [task?.reference, task?.title].filter(Boolean).join(" ") || "the card";
    },
    laneName: (lane) => laneName(lane),
  });
  const carried = board.drag;

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
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="Where the work is piled up, lane by lane — each column counted by the server."
        actions={
          <>
            <NewRecordButton records={records} resource={resource} />
            <Button icon={<TableOutlined />} onClick={() => navigate("/explore?resource=task")}>
              As a table
            </Button>
          </>
        }
      />

      <MetricStrip view={view} accents={["accent", "info", "neutral", "success"]} />
      <EntityFilters view={view} only={["priority", "kind"]} />
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
      <div
        className={`nu-board nx-rec-board${carried ? " is-dragging" : ""}`}
        data-testid="task-board"
        data-drag-scroll
      >
        {lanes.map((lane, index) => {
          const query = laneQueries[index];
          const items = laneRows[index] ?? [];
          const total = query?.data?.total ?? lane.total;
          const drop = board.laneProps(lane.status);
          const targeted = carried?.over.lane === lane.status;
          // Dropping a card back where it came from changes nothing, and a
          // lane that lights up promising a move it will not make is worse
          // than one that stays quiet.
          const isSource =
            targeted && carried.from === lane.status && carried.over.index === carried.origin;
          const reorder = targeted && carried.from === lane.status && !isSource;

          return (
            <section
              key={lane.status}
              className={`nu-lane nx-rec-lane ${drop.className}${
                targeted ? (isSource ? " nu-lane-source" : " nu-lane-over") : ""
              }`}
              data-drop-lane={drop["data-drop-lane"]}
              aria-label={lane.status}
              data-testid={`lane-${lane.status}`}
            >
              <header className="nu-lane-head">
                <span
                  className="nu-lane-dot"
                  style={{ background: knownStatusColor(lane.status) ?? "var(--nu-border-strong)" }}
                  aria-hidden
                />
                <span className="nu-lane-title">{lane.status.replace(/_/g, " ")}</span>
                {/* What the drop will do, in words. A tint is a signal
                    somebody has to have learned; "→ in review" is one they
                    can read the first time (§34). */}
                {targeted ? (
                  <span className={`nu-lane-intent${isSource ? " is-noop" : ""}`}>
                    {isSource ? "back where it was" : reorder ? "↕ new place" : `→ ${laneName(lane.status)}`}
                  </span>
                ) : (
                  <span className="nu-lane-count">{total.toLocaleString()}</span>
                )}
              </header>

              {query?.isLoading ? (
                <Skeleton active title={false} paragraph={{ rows: 4 }} />
              ) : (
                <ul className="nu-lane-cards" data-drop-list={lane.status}>
                  {items.length === 0 && !targeted ? (
                    <li className="nx-rec-lane-empty">
                      <EmptyState compact title="Nothing here" />
                    </li>
                  ) : (
                    board.renderLane(
                      lane.status,
                      items,
                      (task) => task.id,
                      (task) => (
                        <li key={task.id}>
                          <TaskCard
                            task={task}
                            lane={lane.status}
                            drag={board.cardProps(task.id, lane.status)}
                            saving={pending.includes(task.id)}
                            records={records}
                            onOpen={() => navigate(`/tasks/${task.id}`)}
                          />
                        </li>
                      ),
                      (height) => (
                        <DropGap
                          key="gap"
                          height={height}
                          label={isSource ? "back where it was" : "lands here"}
                        />
                      ),
                    )
                  )}
                </ul>
              )}

              {total > items.length && (
                <Button
                  type="text"
                  block
                  className="nx-rec-lane-more"
                  onClick={() => navigate(`/explore?resource=task&f.status=${lane.status}`)}
                >
                  All {total.toLocaleString()} in this lane
                </Button>
              )}
              {index === 0 && records.canCreate && (
                <button type="button" className="nx-rec-lane-new" onClick={records.create}>
                  <PlusOutlined /> New task
                </button>
              )}
            </section>
          );
        })}
      </div>
      {board.overlay}
      </>
      )}

      {records.drawer}
    </>
  );
}

/**
 * One card.
 *
 * The whole card is the handle: pressed and moved with a mouse, held and
 * moved with a finger, or focused and carried with the keyboard (Space, the
 * arrows, Space). There is no separate "Move to" control — the drag *is* the
 * way to move a card, and it works for every way of pointing (§54).
 */
function TaskCard({
  task,
  lane,
  drag,
  saving,
  records,
  onOpen,
}: {
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
      aria-label={`${task.reference ?? ""} ${task.title ?? ""}`.trim()}
      onClick={onOpen}
      onKeyDown={(event) => {
        handlers.onKeyDown(event);
        if (!event.defaultPrevented && event.key === "Enter" && event.target === event.currentTarget) {
          onOpen();
        }
      }}
    >
      <div className="nx-rec-card-top">
        <StatusTag status={task.priority} />
        <span className="nu-task-ref">{task.reference}</span>
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

/** A lane's cached page, without one card. */
function withoutTask(current: unknown, id: string) {
  const page = current as { items?: TaskRow[] } | undefined;
  if (!page?.items) return current;
  return { ...page, items: page.items.filter((item) => item.id !== id) };
}

/** A lane's cached page, with one card at `index` in it. */
function withTask(current: unknown, task: TaskRow, index: number) {
  const page = current as { items?: TaskRow[] } | undefined;
  if (!page?.items) return current;
  const rest = page.items.filter((item) => item.id !== task.id);
  const at = Math.min(Math.max(0, index), rest.length);
  return { ...page, items: [...rest.slice(0, at), task, ...rest.slice(at)] };
}
