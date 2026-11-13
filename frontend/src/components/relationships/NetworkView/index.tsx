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
import { Button, Card, Col, Row, Segmented, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { ApartmentOutlined, ClusterOutlined, NodeIndexOutlined, ShareAltOutlined } from "@ant-design/icons";

import { relationshipsApi } from "@/api/relationships";
import { ForceGraph, type GraphLink, type GraphNode } from "@/components/graph/ForceGraph";
import { StatCard } from "@/components/StatCard";
import { NEUTRAL, SERIES } from "@/theme/tokens";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

import { NetworkError } from "./NetworkError";
import { describe } from "./describe";

import { Clusters } from "./Clusters";

const { Text } = Typography;

/** Above this a label on the canvas is noise; hover and the panel carry it. */
const LABELLED_DEGREE = 5;

const MUTED = NEUTRAL[400];

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
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const network = useQuery({
    queryKey: queryKeys.relationships("network", focus),
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
                <Button size="small" type="text" onClick={() => setHighlighted(null)}>
                  Show every cluster
                </Button>
              )
            }
          >
            {data.nodes.length === 0 ? (
              <EmptyState title="There is nothing linked to cluster yet." />
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
          <Clusters
            communities={data.communities}
            chosen={chosen}
            colors={colors}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            onExplore={onExplore}
          />
        </Col>
      </Row>
    </Space>
  );
}
