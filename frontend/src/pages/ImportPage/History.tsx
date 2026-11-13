import { Button, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { ImportRun } from "@/api/imports";
import { EmptyState } from "@/components/EmptyState";
import { absoluteTime, relativeTime } from "@/lib/time";

import { DiscardRun } from "./DiscardRun";
import { STATUS_LABELS, outcome, tone } from "./importCopy";

const { Text } = Typography;

/** Earlier imports, so a draft can be picked up and a result looked at. */
export function History({
  rows,
  onOpen,
  onDiscard,
}: {
  rows: ImportRun[];
  onOpen: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const columns: ColumnsType<ImportRun> = [
    {
      title: "Reference",
      dataIndex: "reference",
      width: 120,
      render: (value: string, row) => (
        <Button
          type="text"
          className="nu-imp-open"
          data-testid={`imp-${value}`}
          onClick={() => onOpen(row.id)}
        >
          {value}
        </Button>
      ),
    },
    { title: "File", dataIndex: "filename", ellipsis: true },
    { title: "Into", dataIndex: "target_label", width: 130 },
    {
      title: "Where it stands",
      dataIndex: "status",
      width: 300,
      render: (_value, row) => (
        <Space size={6}>
          <Tag color={tone(row)} bordered={false}>
            {STATUS_LABELS[row.status]}
          </Tag>
          <Text type={tone(row) === "error" ? "danger" : "secondary"}>{outcome(row)}</Text>
        </Space>
      ),
    },
    {
      title: "Started",
      dataIndex: "created_at",
      width: 110,
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
    {
      title: "",
      width: 96,
      align: "right",
      render: (_value, row) =>
        row.can_discard ? (
          <DiscardRun run={row} testId={`discard-${row.reference}`} onConfirm={() => onDiscard(row.id)} />
        ) : null,
    },
  ];

  return (
    <Table<ImportRun>
      rowKey="id"
      size="small"
      dataSource={rows}
      columns={columns}
      pagination={false}
      locale={{
        emptyText: (
          <EmptyState title="Nothing imported yet. A drafted import stays here until you finish or discard it." />
        ),
      }}
    />
  );
}
