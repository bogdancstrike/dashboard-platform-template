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

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Segmented, Select, Skeleton, Tooltip } from "antd";
import { ClockCircleOutlined, DragOutlined, HolderOutlined, TableOutlined } from "@ant-design/icons";
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
import { planningApi } from "@/api/planning";
import { recordsApi } from "@/api/records";
import { useAuth } from "@/auth/AuthProvider";
import { humanStatus } from "@/components/StatusTag";
import {
  AgeDots,
  CardBadges,
  laneKey,
  parseLane,
  QuickCreate,
  SWIMLANE_FIELD,
  SWIMLANES,
  ShortcutsModal,
  swimlaneOrder,
  swimOf,
  TemplatePicker,
  useBoardShortcuts,
  useLaneSettings,
  usePeopleNames,
  WipBadge,
  WipLimitsModal,
  type Swimlane,
} from "@/components/planning/BoardExtras";
import { PlanIcon } from "@/components/planning/planIcons";
import "@/styles/planning.css";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** Rows fetched per lane. A lane is scanned, not read to the end. */
const PER_LANE = 12;

const COLUMNS = [
  "reference", "title", "status", "priority", "kind",
  "due_date", "progress", "estimate_hours", "logged_hours", "updated_at", "board_position",
  // Work planning (§18): what a card shows beyond its title.
  "story_points", "cover_color", "blocked_reason", "checklist", "epic_id", "assignee_id",
  "status_changed_at",
];
/** Rows per lane with swimlanes on: each swimlane takes its share of a lane. */
const PER_LANE_SWIMMING = 40;

/** One drop: where to, between whom, and how to take it back. */
interface Move {
  task: TaskRow;
  to: string;
  /** A drop into another swimlane also writes the field the swimlanes are. */
  field?: { name: string; value: string | null };
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
  story_points?: number | null;
  cover_color?: string | null;
  blocked_reason?: string | null;
  checklist?: { text?: string; done?: boolean }[] | null;
  epic_id?: string | null;
  assignee_id?: string | null;
  status_changed_at?: string | null;
}

export default function TasksBoardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const view = useEntityView("task", { columns: COLUMNS, defaultSort: "priority" });
  const { resource, rows, filters, term, setFilter } = view;
  const { profile } = useAuth();
  const swim = (["assignee", "priority", "epic"].includes(view.params.get("swim") ?? "")
    ? view.params.get("swim")
    : "none") as Swimlane;
  const perLane = swim === "none" ? PER_LANE : PER_LANE_SWIMMING;
  const [templating, setTemplating] = useState(false);
  const [limiting, setLimiting] = useState(false);
  const [helping, setHelping] = useState(false);
  const laneSettings = useLaneSettings();
  const epics = useQuery({ queryKey: queryKeys.epics(""), queryFn: ({ signal }) => planningApi.epics({}, signal), staleTime: STALE.minute });
  const epicName = useMemo(() => new Map((epics.data?.items ?? []).map((epic) => [epic.id, epic.title])), [epics.data]);
  const people = usePeopleNames(swim === "assignee");

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
      queryKey: queryKeys.taskLane(lane.status, term, filters, perLane),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        explorerApi.query(
          {
            resource_type: "task",
            query_text: term,
            filters: { ...filters, status: lane.status },
            columns: COLUMNS,
            page: 1,
            page_size: perLane,
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
    mutationFn: async ({ task, to, afterId, beforeId, field }: Move) => {
      const placed = await taskBoardApi.place(task.id, {
        status: to,
        after_id: afterId,
        before_id: beforeId,
        expected_updated_at: task.updated_at ?? null,
      });
      if (!field) return placed;
      const saved = await recordsApi.update("task", task.id, {
        [field.name]: field.value,
        expected_updated_at: placed.updated_at,
      });
      return { ...placed, updated_at: saved.updated_at };
    },
    onMutate: async ({ task, to, index, field }) => {
      setPending((current) => [...current, task.id]);
      await queryClient.cancelQueries({ queryKey: queryKeys.taskLane() });
      const fromKey = queryKeys.taskLane(task.status ?? "", term, filters, perLane);
      const toKey = queryKeys.taskLane(to, term, filters, perLane);
      const previous = [
        [fromKey, queryClient.getQueryData(fromKey)],
        [toKey, queryClient.getQueryData(toKey)],
      ] as const;
      // Move the card between the two lane caches by hand, so the drop lands
      // exactly where the gap was drawn before the round trip. Counts are
      // left alone deliberately — see above.
      queryClient.setQueryData(fromKey, (current: unknown) => withoutTask(current, task.id));
      queryClient.setQueryData(toKey, (current: unknown) =>
        withTask(current, { ...task, status: to, ...(field ? { [field.name]: field.value } : {}) }, index),
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskLane() });
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

  /**
   * Swimlanes (§18): each status lane is split by assignee, priority or epic.
   * A drag lane is then `swimlane|status`, and a drop into another swimlane
   * also writes the field the swimlanes are drawn by.
   */
  const swimLabel = (key: string) =>
    swim === "assignee"
      ? key ? people.data?.get(key)?.name ?? "Someone" : "Unassigned"
      : swim === "epic"
        ? key ? epicName.get(key) ?? "An epic" : "No epic"
        : swim === "priority"
          ? humanStatus(key || "NORMAL")
          : "";
  const swimKeys = swimlaneOrder(
    laneRows.flat().map((task) => swimOf(task as Record<string, unknown>, swim)),
    swim,
    swimLabel,
  );
  if (swimKeys.length === 0) swimKeys.push(swim === "none" ? "all" : "");
  // Without swimlanes a drag lane is just its status, as it always was.
  const keyFor = (swimKey: string, status: string) => (swim === "none" ? status : laneKey(swimKey, status));
  const dragLanes = swimKeys.flatMap((key) => laneIds.map((status) => keyFor(key, status)));
  const rowsIn = (lane: string) => {
    const { swim: key, status } = parseLane(lane);
    return (laneRows[laneIds.indexOf(status)] ?? []).filter(
      (task) => swim === "none" || swimOf(task as Record<string, unknown>, swim) === key,
    );
  };

  /** The neighbours a card would have at `index` of `lane`, counted without it. */
  const neighbours = (lane: string, index: number, id: string) => {
    const rows = rowsIn(lane).filter((row) => row.id !== id);
    return { afterId: rows[index - 1]?.id ?? null, beforeId: rows[index]?.id ?? null };
  };

  const board = useBoardDrag({
    enabled: canEdit,
    lanes: dragLanes,
    items: (lane) => rowsIn(lane).map((task) => task.id),
    // The lanes are arranged by hand, so a card lands exactly where the gap
    // was open: between any two cards, at the top, at the bottom, in its own
    // lane or another one.
    onDrop: (id, from, to: DropTarget) => {
      const task = byId.get(id);
      if (!task || !canEdit) return;
      const origin = Math.max(0, rowsIn(from).findIndex((row) => row.id === id));
      const target = parseLane(to.lane);
      const source = parseLane(from);
      const field =
        swim !== "none" && target.swim !== source.swim
          ? { name: SWIMLANE_FIELD[swim], value: target.swim || null }
          : undefined;
      // The index is within the swimlane; the cache holds the whole status lane.
      const before = neighbours(to.lane, to.index, id).beforeId;
      const statusRows = (laneRows[laneIds.indexOf(target.status)] ?? []).filter((row) => row.id !== id);
      const at = before ? Math.max(0, statusRows.findIndex((row) => row.id === before)) : statusRows.length;
      move.mutate({
        task,
        to: target.status,
        index: swim === "none" ? to.index : at,
        field,
        ...neighbours(to.lane, to.index, id),
        undo: field ? undefined : { to: source.status, index: origin, ...neighbours(from, origin, id) },
      });
    },
    describe: (id) => {
      const task = byId.get(id);
      return [task?.reference, task?.title].filter(Boolean).join(" ") || "the card";
    },
    laneName: (lane) => {
      const { swim: key, status } = parseLane(lane);
      return swim === "none" ? laneName(status) : `${laneName(status)} in ${swimLabel(key)}`;
    },
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
  const settingFor = (status: string) => laneSettings.data?.items.find((item) => item.status === status);

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
      <div className="nx-pl-toolbar" data-testid="board-toolbar">
        <Segmented
          aria-label="View"
          value="board"
          onChange={(value) => value !== "board" && navigate(`/${String(value)}`)}
          options={[
            { value: "board", label: "Board" },
            { value: "timeline", label: "Timeline" },
            { value: "sprints", label: "Sprints" },
          ]}
        />
        <Select
          aria-label="Swimlanes"
          data-testid="board-swimlanes"
          style={{ minWidth: 160 }}
          value={swim}
          onChange={(value: Swimlane) => view.set({ swim: value === "none" ? null : value })}
          options={SWIMLANES}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          aria-label="Epic"
          placeholder="Any epic"
          style={{ minWidth: 180 }}
          value={filters["epic_id"] || undefined}
          onChange={(value: string | undefined) => setFilter("epic_id", value ?? null)}
          options={(epics.data?.items ?? []).map((epic) => ({ value: epic.id, label: epic.title }))}
        />
        <Button
          type={filters["assignee_id"] && filters["assignee_id"] === profile?.user.id ? "primary" : "default"}
          onClick={() =>
            setFilter("assignee_id", filters["assignee_id"] === profile?.user.id ? null : (profile?.user.id ?? null))
          }
          data-testid="board-mine"
        >
          Only mine
        </Button>
        <span className="nx-pl-spacer" />
        {laneSettings.data?.can_manage && (
          <Button onClick={() => setLimiting(true)} data-testid="board-wip">
            Lane limits
          </Button>
        )}
        <Tooltip title="Keyboard shortcuts (?)">
          <Button aria-label="Keyboard shortcuts" onClick={() => setHelping(true)}>
            ?
          </Button>
        </Tooltip>
      </div>
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
        {lanes.map((lane, index) => {
          const key = keyFor(swimKey, lane.status);
          const query = laneQueries[index];
          const items = rowsIn(key);
          const total = query?.data?.total ?? lane.total;
          const drop = board.laneProps(key);
          const targeted = carried?.over.lane === key;
          // Dropping a card back where it came from changes nothing, and a
          // lane that lights up promising a move it will not make is worse
          // than one that stays quiet.
          const isSource =
            targeted && carried.from === key && carried.over.index === carried.origin;
          const reorder = targeted && carried.from === key && !isSource;

          return (
            <section
              key={lane.status}
              className={`nu-lane nx-rec-lane ${drop.className}${
                targeted ? (isSource ? " nu-lane-source" : " nu-lane-over") : ""
              }`}
              data-drop-lane={drop["data-drop-lane"]}
              aria-label={swim === "none" ? lane.status : `${lane.status} · ${swimLabel(swimKey)}`}
              data-testid={swim === "none" ? `lane-${lane.status}` : `lane-${swimKey || "none"}-${lane.status}`}
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
                  <>
                    {settingFor(lane.status)?.wip_limit ? (
                      <WipBadge count={total} setting={settingFor(lane.status)} />
                    ) : (
                      <span className="nu-lane-count">{swim === "none" ? total.toLocaleString() : items.length}</span>
                    )}
                  </>
                )}
              </header>

              {query?.isLoading ? (
                <Skeleton active title={false} paragraph={{ rows: 4 }} />
              ) : (
                <ul className="nu-lane-cards" data-drop-list={key}>
                  {items.length === 0 && !targeted ? (
                    <li className="nx-rec-lane-empty">
                      <EmptyState compact title="Nothing here" />
                    </li>
                  ) : (
                    board.renderLane(
                      key,
                      items,
                      (task) => task.id,
                      (task) => (
                        <li key={task.id}>
                          <TaskCard
                            task={task}
                            lane={lane.status}
                            drag={board.cardProps(task.id, key)}
                            epicName={task.epic_id ? epicName.get(task.epic_id) : undefined}
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

              {swim === "none" && total > items.length && (
                <Button
                  type="text"
                  block
                  className="nx-rec-lane-more"
                  onClick={() => navigate(`/explore?resource=task&f.status=${lane.status}`)}
                >
                  All {total.toLocaleString()} in this lane
                </Button>
              )}
              {records.canCreate && (
                <QuickCreate
                  status={lane.status}
                  extra={swim !== "none" && swimKey ? { [SWIMLANE_FIELD[swim]]: swimKey } : undefined}
                />
              )}
            </section>
          );
        })}
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
