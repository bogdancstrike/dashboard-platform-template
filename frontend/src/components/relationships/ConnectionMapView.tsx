import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  List,
  Progress,
  Row,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ApartmentOutlined,
  BranchesOutlined,
  DatabaseOutlined,
  ExportOutlined,
  NodeIndexOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { relationshipsApi, type HubRecord, type MapEdge } from "@/api/relationships";
import { SchemaGraph } from "@/components/SchemaGraph";
import { StatCard } from "@/components/StatCard";

const { Text } = Typography;

/**
 * What the relationship explorer shows before a record has been chosen (§50).
 *
 * The page used to open on a search box, which asks the reader to already know
 * what they are looking for. This answers the question they actually arrive
 * with — *how does any of this connect?* — with three things that are only
 * visible in aggregate and cannot be seen one record at a time:
 *
 * * the **graph** of entities and their links, weighted by real row counts;
 * * **coverage** per relation, because the rows *missing* a link are usually
 *   the finding — "600 tickets, 583 with a customer" locates the other 17;
 * * **hubs**, the records the most rows point at, which is where an
 *   exploration is worth starting.
 *
 * Every number here is measured, not declared. The edges come from the
 * schema's foreign keys and the counts from the rows, so the picture cannot
 * describe a link the database does not have.
 */
export function ConnectionMapView({
  onStart,
}: {
  onStart: (resourceType: string, id: string) => void;
}) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<MapEdge | null>(null);

  const map = useQuery({
    queryKey: ["relationships", "overview"],
    queryFn: ({ signal }) => relationshipsApi.overview(signal),
    staleTime: 120_000,
  });

  if (map.isLoading) {
    return <Skeleton active paragraph={{ rows: 12 }} />;
  }

  if (map.isError) {
    const error = map.error;
    return (
      <Alert
        type={error instanceof ApiError && error.isForbidden ? "warning" : "error"}
        showIcon
        message={
          error instanceof ApiError && error.isForbidden
            ? "You do not have permission to read the connection map"
            : "The connection map could not be loaded"
        }
        description={
          error instanceof ApiError ? (
            <Space direction="vertical" size={4}>
              {error.missingPermissions.length > 0 && (
                <Text type="secondary">Missing: {error.missingPermissions.join(", ")}</Text>
              )}
              <Text code copyable={{ text: error.correlationId }}>
                {error.correlationId}
              </Text>
            </Space>
          ) : undefined
        }
        action={
          <Button size="small" onClick={() => void map.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const data = map.data!;

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        {[
          {
            key: "entities",
            label: "Entities",
            value: data.totals.entities,
            hint: "record types you can read",
            icon: <ApartmentOutlined />,
          },
          {
            key: "records",
            label: "Records",
            value: data.totals.records,
            hint: "rows across all of them",
            icon: <DatabaseOutlined />,
          },
          {
            key: "relations",
            label: "Relations",
            value: data.totals.relations,
            hint: "foreign keys in the schema",
            icon: <BranchesOutlined />,
          },
          {
            key: "links",
            label: "Links",
            value: data.totals.links,
            hint: "rows that actually carry one",
            icon: <NodeIndexOutlined />,
          },
        ].map((tile) => (
          <Col key={tile.key} xs={12} lg={6}>
            <StatCard label={tile.label} value={tile.value} icon={tile.icon} hint={tile.hint} />
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <Card size="small" title="How the platform connects" data-testid="schema-graph">
            <SchemaGraph
              nodes={data.nodes}
              edges={data.edges}
              selected={selected ? `${selected.source}:${selected.relation}` : undefined}
              onSelectEdge={setSelected}
              onSelectNode={(node) =>
                node.explorable && navigate(`/explore?resource=${node.key}`)
              }
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            size="small"
            title="Strongest relations"
            data-testid="relation-strength"
            className="nu-fill-height"
            extra={
              selected && (
                <Button size="small" type="link" onClick={() => setSelected(null)}>
                  Clear
                </Button>
              )
            }
          >
            <Table<MapEdge>
              size="small"
              rowKey={(edge) => `${edge.source}:${edge.relation}`}
              dataSource={data.edges.slice(0, 12)}
              pagination={false}
              scroll={{ y: 470 }}
              onRow={(edge) => ({
                onClick: () => setSelected(edge),
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
                      <Text>
                        {edge.source_label} → {edge.target_label}
                      </Text>
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
        </Col>
      </Row>

      <Card size="small" title="Most connected records" data-testid="hub-records">
        <List
          grid={{ gutter: 12, xs: 1, sm: 2, lg: 3, xxl: 4 }}
          dataSource={data.hubs.slice(0, 12)}
          locale={{ emptyText: "Nothing links to anything yet." }}
          renderItem={(hub: HubRecord) => (
            <List.Item>
              <Card size="small" className="nu-hub" hoverable>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Space size={6} wrap>
                    <Tag color="blue">{hub.connections.toLocaleString()} links</Tag>
                    <Text type="secondary">{hub.via_label}</Text>
                  </Space>
                  <Text strong ellipsis>
                    {hub.label}
                  </Text>
                  {hub.summary && (
                    <Text type="secondary" ellipsis>
                      {hub.summary}
                    </Text>
                  )}
                  <Space size={4}>
                    <Button
                      size="small"
                      type="link"
                      icon={<ApartmentOutlined />}
                      onClick={() => onStart(hub.resource_type, hub.id)}
                    >
                      Explore
                    </Button>
                    {hub.explorable && (
                      <Button
                        size="small"
                        type="link"
                        icon={<ExportOutlined />}
                        onClick={() => navigate(`/${hub.resource_type}s/${hub.id}`)}
                      >
                        Open
                      </Button>
                    )}
                  </Space>
                </Space>
              </Card>
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
}
