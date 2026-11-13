import { useQuery } from "@tanstack/react-query";
import { List, Space, Typography } from "antd";
import { Link } from "react-router-dom";

import type { DashboardWidget } from "@/api/dashboards";
import { explorerApi } from "@/api/explorer";
import { kanbanApi } from "@/api/kanban";
import { StatusTag } from "@/components/StatusTag";
import { asText } from "@/lib/text";
import { knownStatusColor } from "@/theme/tokens";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/**
 * Work in flight — either one kanban board's lanes, or the task dataset.
 *
 * Two modes because they answer different questions. A *board* is a team's
 * agreed process, so its lanes are the ones that team named; the *dataset* is
 * every task there is, and its lanes are the status vocabulary. Somebody
 * choosing this widget is picking one of those two questions, not a data
 * source.
 *
 * Either way the lane counts come from the server. A card that counted the
 * rows it had loaded would say "3 in progress" about a lane holding ninety —
 * which is the specific lie a board exists to prevent.
 */
export function TasksBody({ widget, fallback }: ModuleBodyProps) {
  const board = widget.config.board_id ?? "";
  return board ? <BoardLanes id={board} fallback={fallback} /> : <TaskLanes widget={widget} fallback={fallback} />;
}

function BoardLanes({ id, fallback }: { id: string; fallback: ModuleBodyProps["fallback"] }) {
  const detail = useQuery({
    queryKey: queryKeys.kanbanBoard(id, {}),
    queryFn: ({ signal }) => kanbanApi.board(id, {}, signal),
    staleTime: STALE.short,
  });

  if (detail.isLoading) return <Loading />;
  if (detail.isError) return fallback(detail.error, "this board");

  const lanes = detail.data?.lanes ?? [];
  if (lanes.length === 0) return <Nothing what="This board has no lanes yet" />;

  return (
    <>
      <div className="nu-widget-lanes">
        {lanes.map((lane) => (
          <Link
            key={lane.id}
            to={`/kanban?board=${id}`}
            className={`nu-widget-lane${lane.over_limit ? " is-over" : ""}`}
          >
            <span className="nu-widget-lane-count">{lane.total.toLocaleString()}</span>
            <span className="nu-widget-lane-name">{lane.name}</span>
            {lane.wip_limit !== null && (
              <span className="nu-widget-lane-limit">of {lane.wip_limit}</span>
            )}
          </Link>
        ))}
      </div>
      <MoreLink to={`/kanban?board=${id}`}>Open {detail.data?.board.name}</MoreLink>
    </>
  );
}

function TaskLanes({ widget, fallback }: { widget: DashboardWidget; fallback: ModuleBodyProps["fallback"] }) {
  const config = widget.config;
  const filters: Record<string, unknown> = { ...(config.filters ?? {}) };
  if (config.status) filters["status"] = config.status;

  const request = {
    resource_type: "task",
    filters,
    columns: ["reference", "title", "status", "priority", "due_date", "progress"],
    sort: "updated_at",
    order: "desc" as const,
    page_size: ROWS,
    // The lane counts are the point of this widget, and they are a GROUP BY
    // the server only runs when asked.
    facets: true,
  };

  const rows = useQuery({
    queryKey: queryKeys.entityRows(request),
    queryFn: ({ signal }) => explorerApi.query(request, signal),
    staleTime: STALE.short,
  });

  if (rows.isLoading) return <Loading />;
  if (rows.isError) return fallback(rows.error, "task");

  const lanes = (rows.data?.facets["status"] ?? []).filter((lane) => lane.count > 0);
  const items = rows.data?.items ?? [];
  if (items.length === 0) return <Nothing what="No work items match" />;

  return (
    <>
      {lanes.length > 0 && (
        <div className="nu-widget-lanes">
          {lanes.slice(0, 5).map((lane) => (
            <Link
              key={lane.value}
              to={`/tasks?f.status=${encodeURIComponent(lane.value)}`}
              className="nu-widget-lane"
              style={{ borderTopColor: knownStatusColor(lane.value) ?? undefined }}
            >
              <span className="nu-widget-lane-count">{lane.count.toLocaleString()}</span>
              <span className="nu-widget-lane-name">{lane.value.replace(/_/g, " ")}</span>
            </Link>
          ))}
        </div>
      )}
      <List
        size="small"
        dataSource={items}
        renderItem={(row) => (
          <List.Item>
            <Link to={`/tasks/${row["id"]}`} className="nu-widget-row">
              <Text ellipsis>{asText(row["title"])}</Text>
              <Space size={4}>
                {Number(row["progress"] ?? 0) > 0 && (
                  <Text type="secondary" className="nu-widget-dim">
                    {Math.round(Number(row["progress"]))}%
                  </Text>
                )}
                <StatusTag status={asText(row["status"])} bordered={false} />
              </Space>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/tasks">All {(rows.data?.total ?? 0).toLocaleString()} tasks</MoreLink>
    </>
  );
}
