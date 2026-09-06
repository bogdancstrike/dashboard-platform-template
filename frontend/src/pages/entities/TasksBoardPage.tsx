/**
 * Tasks as a board (§7, §18, §33).
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
 * Drag is not here yet — writes are §9 — and the board says so rather than
 * offering a handle that silently does nothing.
 */

import { useQueries } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Progress, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { AppstoreOutlined, ClockCircleOutlined, TableOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { explorerApi, type ExplorerRequest } from "@/api/explorer";
import { usePageCommands } from "@/commands/CommandContext";
import { EntityError, EntityFilters, EntityHeader, MetricStrip } from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime, relativeTime } from "@/lib/time";
import { knownStatusColor } from "@/theme/tokens";

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
  const view = useEntityView("task", { columns: COLUMNS, defaultSort: "priority" });
  const { resource, rows, filters, term, setFilter } = view;

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

  usePageCommands("entity:task", [
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
          <Button icon={<TableOutlined />} onClick={() => navigate("/explore?resource=task")}>
            As a table
          </Button>
        }
      />

      <MetricStrip view={view} accents={["accent", "info", "neutral", "success"]} />
      <EntityFilters view={view} only={["priority", "kind"]} />
      <EntityError view={view} />

      <Alert
        className="nu-block"
        type="info"
        showIcon
        icon={<AppstoreOutlined />}
        message="This board is read-only for now"
        description="Moving a card between lanes writes to the record, and record editing (§9) has not shipped yet. Every lane is counted and paged by the server, so the numbers are the whole dataset rather than this page of it."
      />

      <div className="nu-board" data-testid="task-board">
        {lanes.map((lane, index) => {
          const query = laneQueries[index];
          const items = (query?.data?.items ?? []) as TaskRow[];
          const total = query?.data?.total ?? lane.total;
          return (
            <section key={lane.status} className="nu-lane" aria-label={lane.status}>
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
                      <Card
                        size="small"
                        className="nu-task-card"
                        hoverable
                        onClick={() => navigate(`/tasks/${task.id}`)}
                      >
                        <Space direction="vertical" size={6} style={{ width: "100%" }}>
                          <Space size={6} wrap>
                            <Tag color={knownStatusColor(task.priority ?? "")} bordered={false}>
                              {task.priority}
                            </Tag>
                            <Text type="secondary" className="nu-task-ref">
                              {task.reference}
                            </Text>
                          </Space>
                          <Text strong className="nu-task-title">
                            {task.title}
                          </Text>
                          <Progress
                            percent={Number(task.progress ?? 0)}
                            size="small"
                            showInfo={false}
                            strokeColor={knownStatusColor(lane.status)}
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
    </>
  );
}
