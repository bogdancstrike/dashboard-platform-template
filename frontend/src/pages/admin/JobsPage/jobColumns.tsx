import { Button, Progress, Space, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, RedoOutlined, StopOutlined } from "@ant-design/icons";

import type { Job, JobStatus } from "@/api/jobs";
import type { RowCard } from "@/components/listing/ResponsiveTable";
import { StatusTag } from "@/components/StatusTag";
import { absoluteTime, relativeTime } from "@/lib/time";

import { JobAction } from "./JobAction";
import { formatDuration, progressLabel, toneFor, type Verb } from "./jobFormat";

const { Text } = Typography;

type Act = (args: { id: string; action: Verb; job?: Job }) => void;

const BASE_COLUMNS: ColumnsType<Job> = [
  {
    title: "Job",
    dataIndex: "name",
    render: (name: string, row) => (
      <div className="nu-job-what">
        <Text strong className="nu-job-name">
          {name}
        </Text>
        <Text type="secondary" className="nu-job-ref">
          {row.reference} · {row.kind.toLowerCase()} · {row.queue}
        </Text>
      </div>
    ),
  },
  {
    title: "Status",
    dataIndex: "status",
    width: 132,
    render: (value: JobStatus, row) => (
      <Space size={4} direction="vertical" className="nu-job-status">
        {/* Written out as well as coloured (§64). */}
        <Tag color={toneFor(value)} bordered={false}>
          {value.toLowerCase()}
        </Tag>
        {/* "Failed" and "failed three times" are different problems, and a
            queue showing only the latest status hides the second. */}
        {row.attempt > 1 && (
          <Text type="secondary" className="nu-job-attempt">
            attempt {row.attempt} of {row.max_attempts}
          </Text>
        )}
      </Space>
    ),
  },
  {
    title: "Progress",
    dataIndex: "progress",
    width: 196,
    render: (_value: number, row) => (
      <div className="nu-job-progress">
        <Progress
          percent={row.progress}
          size="small"
          showInfo={false}
          // Deliberately not `status="active"` for a running job: AntD's
          // active bar animates *forever*, so the page never goes idle —
          // which costs a laptop battery on a screen somebody leaves open,
          // and made every wait-for-animations assertion here time out. The
          // shimmer carried nothing anyway: this bar is `aria-hidden`
          // decoration, and "running" is already said by the status tag and
          // by the units beside it.
          status={
            row.status === "FAILED"
              ? "exception"
              : row.status === "SUCCEEDED"
                ? "success"
                : "normal"
          }
          // The bar is decoration over a number that is already readable:
          // a percentage nobody can read out is not progress (§64).
          aria-hidden="true"
        />
        <Text type="secondary" className="nu-job-units">
          {progressLabel(row)}
        </Text>
      </div>
    ),
  },
  {
    title: "When",
    dataIndex: "created_at",
    width: 150,
    render: (value: string | null, row) => (
      <Tooltip title={value ? absoluteTime(value) : undefined}>
        <Text type="secondary" className="nu-job-when">
          {value ? relativeTime(value) : "—"}
          {row.duration_ms !== null && (
            <>
              <br />
              took {formatDuration(row.duration_ms)}
            </>
          )}
        </Text>
      </Tooltip>
    ),
  },
];

/** The queue's columns; the controls only for a reader with `jobs.manage`. */
export function jobColumns(canManage: boolean, act: Act, busy: boolean): ColumnsType<Job> {
  if (!canManage) return BASE_COLUMNS;
  return [
    ...BASE_COLUMNS,
    {
      title: "",
      key: "act",
      width: 96,
      align: "right" as const,
      render: (_value: unknown, row: Job) => <RowActions row={row} act={act} busy={busy} />,
    },
  ];
}

function RowActions({ row, act, busy }: { row: Job; act: Act; busy: boolean }) {
  return (
    <Space size={2}>
      <JobAction
        job={row}
        action="retry"
        icon={<RedoOutlined />}
        busy={busy}
        onConfirm={() => act({ id: row.id, action: "retry" })}
      />
      <JobAction
        job={row}
        action="cancel"
        icon={<StopOutlined />}
        busy={busy}
        onConfirm={() => act({ id: row.id, action: "cancel" })}
      />
      {/* Only where the server says it would change something —
          which is exactly where the retry refusal points at it. */}
      {row.can_allow_attempts && (
        <Tooltip title={`Allow ${row.max_attempts + 1} attempts, so it can run again`}>
          <Button
            type="text"
            icon={<PlusOutlined />}
            disabled={busy}
            aria-label={`Grant ${row.reference} another attempt`}
            data-testid={`grant-${row.reference}`}
            onClick={(event) => {
              event.stopPropagation();
              act({ id: row.id, action: "grant", job: row });
            }}
          />
        </Tooltip>
      )}
    </Space>
  );
}

/** The same row as a card on a phone. */
export function jobCard(row: Job): RowCard {
  return {
    title: row.name,
    meta: `${row.reference} · ${row.queue}`,
    pill: <StatusTag status={row.status} />,
    // Units done, not the percentage: "100 of 1" read as a hundred things done of one.
    right: row.total_units ? progressLabel(row) : undefined,
  };
}
