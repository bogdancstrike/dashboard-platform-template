import { Card, Progress, Segmented, Skeleton, Space, Table, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { ProjectTimeline } from "@/components/planning/ProjectTimeline";
import { humanStatus, StatusTag } from "@/components/StatusTag";
import { formatNumber } from "@/lib/formats";
import { absoluteTime, relativeTime } from "@/lib/time";
import { knownStatusColor } from "@/theme/tokens";

import type { TaskRow } from "./types";
import type { useProjectWork } from "./useProjectWork";

const { Text } = Typography;

/** The soonest few: what, its state, when, how far along. */
const NEXT_UP_COLUMNS: ColumnsType<TaskRow> = [
  {
    title: "Due next",
    dataIndex: "title",
    render: (title: string, row) => (
      <Space direction="vertical" size={0}>
        <Text>{title}</Text>
        <Text type="secondary" className="nu-mono">
          {row.reference}
        </Text>
      </Space>
    ),
  },
  {
    title: "Status",
    dataIndex: "status",
    width: 140,
    render: (status: string) => <StatusTag status={status} />,
  },
  {
    title: "Due",
    dataIndex: "due_date",
    width: 130,
    render: (due: string | null) =>
      due ? (
        <Tooltip title={absoluteTime(due)}>
          <span>{relativeTime(due)}</span>
        </Tooltip>
      ) : (
        <Text type="secondary">—</Text>
      ),
  },
  {
    title: "Progress",
    dataIndex: "progress",
    width: 120,
    render: (value: number, row) => (
      <Progress
        aria-label={`${row.title ?? "Task"} is ${Number(value)}% done`}
        className="nu-gauge"
        percent={Number(value)}
        size="small"
      />
    ),
  },
];

/** The work under the project: lane counts over all of it, then the soonest few — or the timeline. */
export function ProjectWork({
  id,
  rollup,
  nextUp,
}: {
  id: string;
} & Pick<ReturnType<typeof useProjectWork>, "rollup" | "nextUp">) {
  /** The work as a list or on the timeline (§18) — a way of looking, so not in the address. */
  const [workView, setWorkView] = useState<"list" | "timeline">("list");
  const navigate = useNavigate();
  const lanes = (rollup.data?.rows ?? []).map((row) => ({
    status: row.keys[0] ?? "—",
    count: Number(row.values.count ?? 0),
  }));
  const totalTasks = rollup.data?.matched ?? 0;

  return (
    <Card
      size="small"
      title="The work"
      data-testid="project-work"
      extra={
        <Space size={10} wrap>
          <Segmented
            size="small"
            aria-label="Show the work as"
            data-testid="project-work-view"
            value={workView}
            onChange={(value) => setWorkView(value as "list" | "timeline")}
            options={[
              { value: "list", label: "List" },
              { value: "timeline", label: "Timeline" },
            ]}
          />
          <Link to={`/tasks?f.project_id=${id}`}>
            {totalTasks === 1 ? "1 task" : `all ${formatNumber(totalTasks)} tasks`}
          </Link>
        </Space>
      }
    >
      {workView === "timeline" ? (
        <ProjectTimeline projectId={id} />
      ) : (
      <>
      {rollup.isLoading ? (
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
      ) : lanes.length === 0 ? (
        <EmptyState compact title="No work has been raised under this project yet" />
      ) : (
        <div className="nu-rollup">
          {lanes.map((lane) => (
            <Link
              key={lane.status}
              className="nu-rollup-cell"
              to={`/tasks?f.project_id=${id}&f.status=${lane.status}`}
            >
              <span
                className="nu-rollup-value"
                style={{ color: knownStatusColor(lane.status) }}
              >
                {formatNumber(lane.count)}
              </span>
              <span className="nu-rollup-label">{humanStatus(lane.status)}</span>
            </Link>
          ))}
        </div>
      )}

      <Table<TaskRow>
        className="nu-block nx-rec-table"
        size="small"
        rowKey="id"
        pagination={false}
        loading={nextUp.isLoading}
        dataSource={nextUp.data?.items ?? []}
        locale={{ emptyText: "Nothing is scheduled" }}
        onRow={(row) => ({
          onClick: () => navigate(`/tasks/${row.id}`),
          style: { cursor: "pointer" },
        })}
        columns={NEXT_UP_COLUMNS}
      />
      </>
      )}
    </Card>
  );
}
