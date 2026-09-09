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
 * Dragging is not the only way to do it. `Move to` on every card is the same
 * action from the keyboard (§54, §55), because a board reachable only by
 * pointer is a board half the readers cannot use.
 */

import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Dropdown,
  Empty,
  Progress,
  Skeleton,
  Space,
  
  Tooltip,
  Typography,
} from "antd";
import { ClockCircleOutlined, DragOutlined, TableOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { explorerApi, type ExplorerRequest } from "@/api/explorer";
import { recordsApi } from "@/api/records";
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

const { Text } = Typography;

/** Rows fetched per lane. A lane is scanned, not read to the end. */
const PER_LANE = 12;

const COLUMNS = [
  "reference", "title", "status", "priority", "kind",
  "due_date", "progress", "estimate_hours", "logged_hours", "updated_at",
];

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

  /** The lane a card is being dragged over, so the target is visible. */
  const [over, setOver] = useState<string | null>(null);
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
            sort: "priority",
            order: "asc",
          } satisfies ExplorerRequest,
          signal,
        ),
      enabled: Boolean(resource),
    })),
  });

  /**
   * Moving a card writes the record's status.
   *
   * Optimistic, then reconciled: the card lands immediately, and every lane is
   * refetched on the way out whether the write succeeded or failed. The totals
   * beside each lane name are counted over the whole dataset, so they cannot
   * be adjusted here without lying about the rows nobody has loaded.
   */
  const move = useMutation({
    mutationFn: ({ task, to }: { task: TaskRow; to: string }) =>
      recordsApi.update("task", task.id, {
        status: to,
        expected_updated_at: task.updated_at ?? null,
      }),
    onMutate: async ({ task, to }) => {
      await queryClient.cancelQueries({ queryKey: ["task-lane"] });
      // Move the card between the two lane caches by hand, so the drop lands
      // before the round trip. Counts are left alone deliberately — see above.
      queryClient.setQueryData(["task-lane", task.status ?? "", term, filters], (current: unknown) =>
        withoutTask(current, task.id),
      );
      queryClient.setQueryData(["task-lane", to, term, filters], (current: unknown) =>
        withTask(current, { ...task, status: to }),
      );
    },
    onError: (error, { task }) => {
      // A refused move snaps back — `onSettled` refetches every lane — and
      // says why, because a card that returns to where it was with no
      // explanation reads as a broken drag rather than a lost race.
      const conflict = error instanceof ApiError && error.status === 409;
      message.error(
        conflict
          ? `${task.title ?? "That task"} moved on somebody else's screen — reloading the board.`
          : error instanceof ApiError
            ? error.message
            : "That move could not be saved.",
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["task-lane"] });
      void queryClient.invalidateQueries({ queryKey: ["entity-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["entity-insights"] });
    },
  });

  const canEdit = records.canEdit;

  const moveTo = (task: TaskRow, to: string) => {
    if (!canEdit || to === task.status) return;
    move.mutate({ task, to });
  };

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
      <div className="nu-board" data-testid="task-board">
        {lanes.map((lane, index) => {
          const query = laneQueries[index];
          const items = (query?.data?.items ?? []) as TaskRow[];
          const total = query?.data?.total ?? lane.total;
          return (
            <section
              key={lane.status}
              className={`nu-lane${over === lane.status ? " nu-lane-over" : ""}`}
              aria-label={lane.status}
              data-testid={`lane-${lane.status}`}
              onDragOver={(event) => {
                if (!canEdit) return;
                // Preventing the default is what marks this a valid drop
                // target; without it the browser refuses every drop silently.
                event.preventDefault();
                setOver(lane.status);
              }}
              onDragLeave={() => setOver((current) => (current === lane.status ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const payload = event.dataTransfer.getData("application/x-nucleus-task");
                if (!payload) return;
                moveTo(JSON.parse(payload) as TaskRow, lane.status);
              }}
            >
              <header className="nu-lane-head">
                <span
                  className="nu-lane-dot"
                  style={{ background: knownStatusColor(lane.status) ?? "var(--nu-border-strong)" }}
                  aria-hidden
                />
                <span className="nu-lane-title">{lane.status.replace(/_/g, " ")}</span>
                <span className="nu-lane-count">{total.toLocaleString()}</span>
              </header>

              {query?.isLoading ? (
                <Skeleton active title={false} paragraph={{ rows: 4 }} />
              ) : items.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<Text type="secondary">Nothing here</Text>}
                />
              ) : (
                <ul className="nu-lane-cards">
                  {items.map((task) => (
                    <li key={task.id}>
                      <TaskCard
                        task={{ ...task, status: task.status ?? lane.status }}
                        lane={lane.status}
                        lanes={lanes.map((item) => item.status)}
                        canEdit={canEdit}
                        records={records}
                        onOpen={() => navigate(`/tasks/${task.id}`)}
                        onMove={moveTo}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {total > items.length && (
                <Button
                  type="link"
                  size="small"
                  block
                  onClick={() => navigate(`/explore?resource=task&f.status=${lane.status}`)}
                >
                  All {total.toLocaleString()} in this lane
                </Button>
              )}
            </section>
          );
        })}
      </div>
      )}

      {records.drawer}
    </>
  );
}

/**
 * One card.
 *
 * Draggable with a pointer and movable with the keyboard, by the same call.
 * The `Move to` menu is not a fallback for the drag — it is the drag, for
 * anybody not using a mouse, and it names the lanes so the choice does not
 * depend on seeing where the columns are.
 */
function TaskCard({
  task,
  lane,
  lanes,
  canEdit,
  records,
  onOpen,
  onMove,
}: {
  task: TaskRow;
  lane: string;
  lanes: string[];
  canEdit: boolean;
  records: RecordEditing;
  onOpen: () => void;
  onMove: (task: TaskRow, to: string) => void;
}) {
  return (
    <Card
      size="small"
      className="nu-task-card"
      hoverable
      draggable={canEdit}
      data-testid={`task-card-${task.reference ?? task.id}`}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-nucleus-task", JSON.stringify(task));
      }}
      onClick={onOpen}
    >
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        <Space size={6} wrap>
          <StatusTag status={task.priority} bordered={false} />
          <Text type="secondary" className="nu-task-ref">
            {task.reference}
          </Text>
          <RecordActions
            records={records}
            id={task.id}
            label={task.reference ?? task.title ?? "this task"}
          />
          {canEdit && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: lanes
                  .filter((status) => status !== lane)
                  .map((status) => ({ key: status, label: status.replace(/_/g, " ") })),
                onClick: ({ key, domEvent }) => {
                  // The menu is portalled to the body, and a React portal
                  // still bubbles through the *component* tree — so without
                  // this the click also opens the card underneath it.
                  domEvent.stopPropagation();
                  onMove(task, key);
                },
              }}
            >
              <Button
                size="small"
                type="text"
                aria-label={`Move ${task.title ?? task.reference} to another lane`}
                onClick={(event) => event.stopPropagation()}
              >
                Move to
              </Button>
            </Dropdown>
          )}
        </Space>
        <Text strong className="nu-task-title">
          {task.title}
        </Text>
        <Progress
          aria-label={`${task.reference}: ${Number(task.progress ?? 0)}% done`}
          percent={Number(task.progress ?? 0)}
          size="small"
          showInfo={false}
          strokeColor={knownStatusColor(lane)}
        />
        <Space size={10} className="nu-task-meta">
          <Text type="secondary">{task.kind}</Text>
          {task.due_date && (
            <Tooltip title={absoluteTime(task.due_date)}>
              <Text type="secondary">
                <ClockCircleOutlined /> {relativeTime(task.due_date)}
              </Text>
            </Tooltip>
          )}
          <Text type="secondary">
            {Math.round(Number(task.logged_hours ?? 0))}/
            {Math.round(Number(task.estimate_hours ?? 0))}h
          </Text>
        </Space>
      </Space>
    </Card>
  );
}

/** A lane's cached page, without one card. */
function withoutTask(current: unknown, id: string) {
  const page = current as { items?: TaskRow[] } | undefined;
  if (!page?.items) return current;
  return { ...page, items: page.items.filter((item) => item.id !== id) };
}

/** A lane's cached page, with one card at the top of it. */
function withTask(current: unknown, task: TaskRow) {
  const page = current as { items?: TaskRow[] } | undefined;
  if (!page?.items) return current;
  return { ...page, items: [task, ...page.items.filter((item) => item.id !== task.id)] };
}
