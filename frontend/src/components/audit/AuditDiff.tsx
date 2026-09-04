import { Table, Tag, Tooltip, Typography } from "antd";

import type { AuditChange, ChangeKind } from "@/api/audit";
import { asText } from "@/lib/text";

const { Text } = Typography;

/**
 * The before → after diff, field by field (§21).
 *
 * The distinction the whole panel exists for is between a field that was
 * **changed**, one that was **added** and one that was **cleared**. Rendering
 * both sides as text loses it: a value set to `""` and a value removed
 * entirely both come out as nothing, and "the assignee was cleared" and "the
 * assignee was never set" are different facts about what somebody did.
 *
 * So absence is drawn as an explicit `∅`, the kind is labelled, and the server
 * decides which is which — the same `core/audit.diff` that produced the row,
 * rather than a second implementation in the browser that will disagree with
 * it eventually.
 */
const KIND_COLOR: Record<ChangeKind, string> = {
  added: "green",
  changed: "blue",
  cleared: "orange",
};

function Value({ value, absent }: { value: unknown; absent: boolean }) {
  if (absent) {
    return (
      <Tooltip title="No value">
        <Text type="secondary" aria-label="no value">
          ∅
        </Text>
      </Tooltip>
    );
  }
  const text = asText(value);
  return <Text className="nu-audit-value">{text === "" ? "—" : text}</Text>;
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function AuditDiff({ changes }: { changes: AuditChange[] }) {
  if (changes.length === 0) {
    return (
      <Text type="secondary">
        No field-level changes were recorded for this action.
      </Text>
    );
  }

  return (
    <Table
      size="small"
      rowKey="field"
      pagination={false}
      dataSource={changes}
      aria-label="Field changes"
      columns={[
        {
          title: "Field",
          dataIndex: "field",
          width: 180,
          render: (value: string) => <Text strong>{value}</Text>,
        },
        {
          title: "Before",
          dataIndex: "from",
          render: (value: unknown, row: AuditChange) => (
            <Value value={value} absent={isAbsent(row.from)} />
          ),
        },
        {
          title: "After",
          dataIndex: "to",
          render: (value: unknown, row: AuditChange) => (
            <Value value={value} absent={isAbsent(row.to)} />
          ),
        },
        {
          title: "",
          dataIndex: "kind",
          width: 100,
          render: (kind: ChangeKind) => <Tag color={KIND_COLOR[kind]}>{kind}</Tag>,
        },
      ]}
    />
  );
}
