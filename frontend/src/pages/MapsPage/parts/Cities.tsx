import { Card, Table, Typography } from "antd";

import type { MapPoint } from "@/api/maps";
import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

/**
 * The cities, as rows.
 *
 * The map merges markers that would overlap (§50), which is right for the
 * picture and would be wrong as the only answer: at a wide zoom thirteen of
 * these are inside three bubbles, and a reader who wants Munich rather than
 * "central Europe" needs somewhere to read it. This is also the keyboard and
 * screen-reader path to the same numbers, which a canvas cannot be (§55).
 */
export function Cities({
  rows,
  loading,
  reads,
  measure,
  onOpen,
  hint,
}: {
  rows: MapPoint[];
  loading: boolean;
  reads: (value: number) => string;
  measure: string;
  onOpen?: (city: string) => void;
  hint?: string;
}) {
  return (
    <Card
      size="small"
      title="By city"
      data-testid="map-cities"
      extra={hint ? <Text type="secondary">{hint}</Text> : undefined}
    >
      <Table<MapPoint>
        size="small"
        rowKey="city"
        loading={loading}
        pagination={rows.length > 12 ? { pageSize: 12, size: "small" } : false}
        dataSource={rows}
        locale={{ emptyText: "Nothing placed yet" }}
        onRow={(row) =>
          onOpen ? { onClick: () => onOpen(row.city), style: { cursor: "pointer" } } : {}
        }
        columns={[
          { title: "City", dataIndex: "city" },
          { title: "Country", dataIndex: "country" },
          { title: "Region", dataIndex: "region_name", responsive: ["lg"] },
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
