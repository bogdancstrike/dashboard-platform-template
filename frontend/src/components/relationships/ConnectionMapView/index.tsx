import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Row, Skeleton, Space } from "antd";
import { ApartmentOutlined, BranchesOutlined, DatabaseOutlined, NodeIndexOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { relationshipsApi, type MapEdge } from "@/api/relationships";
import { EntityGraph } from "@/components/graph/EntityGraph";
import { StatCard } from "@/components/StatCard";
import { queryKeys } from "@/lib/queryKeys";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

import { HubRecords } from "./HubRecords";
import { RelationStrength } from "./RelationStrength";

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
    queryKey: queryKeys.relationships("overview"),
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
        description={apiErrorDetails(error)}
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
            <EntityGraph
              nodes={data.nodes}
              edges={data.edges}
              selected={selected}
              onSelectNode={(node) =>
                node.explorable && navigate(`/explore?resource=${node.key}`)
              }
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <RelationStrength edges={data.edges} selected={selected} onSelect={setSelected} />
        </Col>
      </Row>

      <HubRecords hubs={data.hubs} onStart={onStart} />
    </Space>
  );
}
