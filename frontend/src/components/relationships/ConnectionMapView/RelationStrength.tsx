import { Button, Card, Progress, Space, Table, Tooltip, Typography } from "antd";

import { type MapEdge } from "@/api/relationships";

const { Text } = Typography;

/** The relations that carry the most links, and how many of their rows carry one; a row selects it on the graph. */
export function RelationStrength({
  edges,
  selected,
  onSelect,
}: {
  edges: MapEdge[];
  selected: MapEdge | null;
  onSelect: (edge: MapEdge | null) => void;
}) {
  return (
    <Card
      size="small"
      title="Strongest relations"
      data-testid="relation-strength"
      className="nu-fill-height"
      extra={
        selected && (
          <Button size="small" type="text" onClick={() => onSelect(null)}>
            Clear
          </Button>
        )
      }
    >
      <Table<MapEdge>
        size="small"
        rowKey={(edge) => `${edge.source}:${edge.relation}`}
        dataSource={edges.slice(0, 12)}
        pagination={false}
        scroll={{ y: 470 }}
        onRow={(edge) => ({
          onClick: () => onSelect(edge),
          style: { cursor: "pointer" },
        })}
        rowClassName={(edge) =>
          selected && selected.relation === edge.relation && selected.source === edge.source
            ? "nu-row-selected"
            : ""
        }
        columns={[
          {
            title: "Relation",
            dataIndex: "label",
            render: (_value: string, edge) => (
              <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
                {/* A button, for the reason the cluster list's is one:
                    the row selects this relation and a keyboard could
                    not reach it (§55). */}
                <button
                  type="button"
                  className="nu-row-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(edge);
                  }}
                >
                  {edge.source_label} → {edge.target_label}
                </button>
                <Text type="secondary">as {edge.label.toLowerCase()}</Text>
              </Space>
            ),
          },
          {
            title: "Links",
            dataIndex: "count",
            width: 80,
            align: "right",
            render: (value: number) => <Text>{value.toLocaleString()}</Text>,
          },
          {
            title: "Coverage",
            dataIndex: "coverage",
            width: 120,
            render: (value: number, edge) => (
              // The gap is the finding: the rows without the link are
              // usually the ones somebody wants to see.
              <Tooltip
                title={`${edge.count.toLocaleString()} of ${edge.source_total.toLocaleString()} ${edge.source_label.toLowerCase()} carry this link`}
              >
                <Progress
                  // Named from the row, because `role="progressbar"`
                  // takes no name from its contents: the percentage
                  // drawn inside it is announced as a number with no
                  // subject, and the tooltip is not a name either (§55).
                  aria-label={`${edge.source_label} → ${edge.target_label}: ${value}% carry this link`}
                  percent={value}
                  size="small"
                  status={value < 60 ? "exception" : "normal"}
                  format={(percent) => `${percent ?? 0}%`}
                />
              </Tooltip>
            ),
          },
        ]}
      />
    </Card>
  );
}
