/**
 * Community analysis over the record graph (§50).
 *
 * The connection map answers *how do the entity types connect?* This answers
 * the question after it — *how do the actual records cluster, and what holds
 * the clusters together?* — which is not visible one record at a time and is
 * the reason this page exists at all.
 *
 * The clustering is Louvain, run on the server, so every viewer sees one
 * partition and the browser only draws it. Three things are shown together
 * because each is useless without the others:
 *
 * * **the graph**, coloured by community, sized by connections;
 * * **the clusters as a list**, which is the accessible equivalent and the
 *   thing a reader can actually act on — a blob has no name;
 * * **modularity**, so the page says how much of the structure is real. A
 *   partition without a score invites the reader to believe the picture.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ApartmentOutlined,
  ClusterOutlined,
  ExportOutlined,
  NodeIndexOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";

import { ApiError } from "@/api/client";
import {
  relationshipsApi,
  type Community,
  type NetworkNode,
  type RecordNetwork,
} from "@/api/relationships";
import { ForceGraph, type GraphLink, type GraphNode } from "@/components/graph/ForceGraph";
import { StatCard } from "@/components/StatCard";
import { SERIES } from "@/theme/tokens";

const { Text } = Typography;

/** Above this a label on the canvas is noise; hover and the panel carry it. */
const LABELLED_DEGREE = 5;
const MUTED = "#94a3b8";

export function NetworkView({
  focus,
  onFocus,
  onExplore,
}: {
  focus: string;
  onFocus: (focus: string) => void;
  /** Follow a record into the one-record view. */
  onExplore: (entity: string, id: string) => void;
}) {
  const navigate = useNavigate();
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const network = useQuery({
    queryKey: ["relationships", "network", focus],
    queryFn: ({ signal }) => relationshipsApi.network(focus, signal),
    staleTime: 120_000,
  });

  const data = network.data;

  /** Community → colour, assigned by size so the biggest is always first. */
  const colors = useMemo(() => {
    const map = new Map<string, string>();
    (data?.communities ?? []).forEach((community, index) => {
      map.set(community.id, SERIES[index % SERIES.length] ?? SERIES[0]);
    });
    return map;
  }, [data]);

  const nodes = useMemo<GraphNode[]>(
    () =>
      (data?.nodes ?? []).map((node) => ({
        key: node.key,
        label: node.label,
        size: 5 + Math.min(node.degree, 24) * 0.9,
        color: colors.get(node.community) ?? MUTED,
        group: node.community,
        ring: node.anchor,
        openable: node.explorable,
        labelled: node.anchor || node.degree >= LABELLED_DEGREE,
        title: [node.label, node.summary, `${node.entity_label} · ${node.degree} links`]
          .filter(Boolean)
          .join(" — "),
      })),
    [data, colors],
  );

  const links = useMemo<GraphLink[]>(
    () =>
      (data?.edges ?? []).map((edge) => ({
        source: edge.source,
        target: edge.target,
        label: edge.label,
        weight: edge.bridge ? 1.4 : 1,
        dashed: edge.bridge,
      })),
    [data],
  );

  const byKey = useMemo(
    () => new Map((data?.nodes ?? []).map((node) => [node.key, node])),
    [data],
  );
  const chosen = selected ? byKey.get(selected) : undefined;

  if (network.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;
  if (network.isError) return <NetworkError error={network.error} onRetry={() => void network.refetch()} />;
  if (!data) return null;

  const structured = data.stats.modularity >= 0.3;

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Card size="small" className="nu-filter-bar">
        <Space wrap size={12} align="center">
          <Text type="secondary">Cluster the records around</Text>
          <Segmented
            data-testid="focus-picker"
            value={focus}
            onChange={(next) => {
              setHighlighted(null);
              setSelected(null);
              onFocus(String(next));
            }}
            options={data.available.map((item) => ({ label: item.label, value: item.key }))}
          />
        </Space>
      </Card>

      <Row gutter={[12, 12]}>
        {[
          {
            key: "communities",
            label: "Communities",
            value: data.stats.communities,
            hint: "clusters the records fall into",
            icon: <ClusterOutlined />,
          },
          {
            key: "nodes",
            label: "Records",
            value: data.stats.nodes,
            hint: "in this slice of the graph",
            icon: <ApartmentOutlined />,
          },
          {
            key: "edges",
            label: "Links",
            value: data.stats.edges,
            hint: "foreign keys with both ends on screen",
            icon: <NodeIndexOutlined />,
          },
          {
            key: "bridges",
            label: "Bridges",
            value: data.stats.bridges,
            hint: "links that cross between clusters",
            icon: <ShareAltOutlined />,
          },
        ].map((tile) => (
          <Col key={tile.key} xs={12} lg={6}>
            <StatCard label={tile.label} value={tile.value} icon={tile.icon} hint={tile.hint} />
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={15}>
          <Card
            size="small"
            data-testid="community-graph"
            title={
              <Space size={8}>
                <span>How the records cluster</span>
                <Tooltip
                  title={
                    // The number is the honesty of the picture: without it a
                    // reader has no way to tell structure from a random cut.
                    "Newman's modularity. Above 0.3 the clustering is real structure; near 0 it is what a random graph would score."
                  }
                >
                  <Tag color={structured ? "green" : "orange"} data-testid="modularity">
                    Q {data.stats.modularity.toFixed(2)}
                  </Tag>
                </Tooltip>
              </Space>
            }
            extra={
              highlighted && (
                <Button size="small" type="link" onClick={() => setHighlighted(null)}>
                  Show every cluster
                </Button>
              )
            }
          >
            {data.nodes.length === 0 ? (
              <Empty description="There is nothing linked to cluster yet." />
            ) : (
              <>
                <ForceGraph
                  nodes={nodes}
                  links={links}
                  highlighted={highlighted}
                  onSelect={setSelected}
                  onOpen={(key) => {
                    const node = byKey.get(key);
                    if (node) onExplore(node.entity, node.id);
                  }}
                  description={describe(data)}
                />
                <div className="nu-force-legend">
                  <Text type="secondary">
                    Drag to rearrange · scroll to zoom · click a record to inspect it · double-click
                    to follow it
                  </Text>
                </div>
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Card
            size="small"
            title="The clusters, named"
            data-testid="community-list"
            className="nu-fill-height"
          >
            {chosen && <ChosenRecord node={chosen} onExplore={onExplore} onOpen={navigate} />}
            <Table<Community>
              size="small"
              rowKey="id"
              dataSource={data.communities}
              pagination={false}
              scroll={{ y: chosen ? 320 : 430 }}
              onRow={(community) => ({
                onClick: () =>
                  setHighlighted((current) => (current === community.id ? null : community.id)),
                style: { cursor: "pointer" },
              })}
              rowClassName={(community) =>
                community.id === highlighted ? "nu-row-selected" : ""
              }
              columns={[
                {
                  title: "Cluster",
                  dataIndex: "label",
                  render: (label: string, community) => (
                    <Space size={8} align="start">
                      <span
                        className="nu-swatch"
                        style={{ background: colors.get(community.id) ?? MUTED }}
                        aria-hidden
                      />
                      <Space direction="vertical" size={0} style={{ lineHeight: 1.3 }}>
                        {/* A button, not a label: the row highlights a cluster
                            on the graph, and a click handler on the row alone
                            is a control no keyboard can reach. It is also what
                            gives this scrolling panel focusable content, which
                            is the other half of the same rule (§55). */}
                        <button
                          type="button"
                          className="nu-row-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setHighlighted((current) =>
                              current === community.id ? null : community.id,
                            );
                          }}
                        >
                          {label}
                        </button>
                        <Text type="secondary">
                          {community.mix
                            .map((part) => `${part.count} ${part.label.toLowerCase()}`)
                            .join(" · ")}
                        </Text>
                      </Space>
                    </Space>
                  ),
                },
                {
                  title: "Size",
                  dataIndex: "size",
                  width: 70,
                  align: "right",
                },
                {
                  title: "Out",
                  dataIndex: "external_links",
                  width: 70,
                  align: "right",
                  render: (value: number) => (
                    <Tooltip title="Links leaving this cluster. Zero means it stands alone.">
                      <Text type={value === 0 ? "secondary" : undefined}>{value}</Text>
                    </Tooltip>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

/** The record the reader clicked, with the two things they can do with it. */
function ChosenRecord({
  node,
  onExplore,
  onOpen,
}: {
  node: NetworkNode;
  onExplore: (entity: string, id: string) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <Card size="small" className="nu-block nu-chosen" data-testid="chosen-record">
      <Space direction="vertical" size={4} style={{ width: "100%" }}>
        <Space size={6} wrap>
          <Tag>{node.entity_label}</Tag>
          {node.status && <Tag>{node.status}</Tag>}
          <Text type="secondary">{node.degree} links</Text>
        </Space>
        <Text strong>{node.label}</Text>
        {node.summary && <Text type="secondary">{node.summary}</Text>}
        <Space size={4}>
          {node.explorable && (
            <Button
              size="small"
              type="link"
              icon={<ApartmentOutlined />}
              onClick={() => onExplore(node.entity, node.id)}
            >
              Follow connections
            </Button>
          )}
          {node.explorable && (
            <Button
              size="small"
              type="link"
              icon={<ExportOutlined />}
              onClick={() => onOpen(`/${node.entity}s/${node.id}`)}
            >
              Open record
            </Button>
          )}
        </Space>
      </Space>
    </Card>
  );
}

function NetworkError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const forbidden = error instanceof ApiError && error.isForbidden;
  return (
    <Alert
      type={forbidden ? "warning" : "error"}
      showIcon
      message={
        forbidden
          ? "You do not have permission to read the record graph"
          : "The record graph could not be loaded"
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
        <Button size="small" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  );
}

/** One sentence describing the whole picture, for a reader who cannot see it. */
function describe(data: RecordNetwork): string {
  const biggest = data.communities[0];
  return [
    `${data.stats.nodes} records in ${data.stats.communities} communities,`,
    `joined by ${data.stats.edges} links, ${data.stats.bridges} of which cross between communities.`,
    biggest ? `The largest is ${biggest.label}, with ${biggest.size} records.` : "",
    `Modularity ${data.stats.modularity.toFixed(2)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
