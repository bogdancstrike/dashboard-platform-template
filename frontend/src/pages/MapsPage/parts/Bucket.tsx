import { Card, Table, Typography } from "antd";

import type { MapBucket } from "@/api/maps";
import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

/** One level of the same answer, as a table beside the picture. */
export function Bucket({
  title,
  testId,
  rows,
  loading,
  reads,
  measure,
  onOpen,
  hint,
}: {
  title: string;
  testId: string;
  rows: MapBucket[];
  loading: boolean;
  reads: (value: number) => string;
  measure: string;
  onOpen?: (name: string) => void;
  hint?: string;
}) {
  return (
    <Card
      size="small"
      title={title}
      data-testid={testId}
      extra={hint ? <Text type="secondary">{hint}</Text> : undefined}
    >
      {/* Every blob on the map is also a row here. A coloured shape is not a
          finding, and not everybody sees colour (§55). */}
      <Table<MapBucket>
        size="small"
        rowKey="name"
        loading={loading}
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: "Nothing here yet" }}
        onRow={(row) =>
          onOpen ? { onClick: () => onOpen(row.name), style: { cursor: "pointer" } } : {}
        }
        columns={[
          { title: "Place", dataIndex: "name" },
          {
            title: "Cities",
            dataIndex: "cities",
            width: 80,
            align: "right",
            render: (value: number) => formatNumber(value),
          },
          {
            title: "Records",
            dataIndex: "rows",
            width: 100,
            align: "right",
            render: (value: number) => formatNumber(value),
          },
          {
            title: measure,
            dataIndex: "value",
            width: 140,
            align: "right",
            render: (value: number) => reads(value),
          },
        ]}
      />
    </Card>
  );
}
