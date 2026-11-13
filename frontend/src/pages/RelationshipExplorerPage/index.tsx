/**
 * Relationship explorer (§44, §50) — follow a record to the ones around it.
 *
 * The exploration is the point, so the *trail* is first-class: every hop is
 * pushed into the URL, the breadcrumb walks back to any earlier record, and
 * the whole path can be pasted to somebody else. Without it, following four
 * links to an interesting order leaves no way back to the customer it started
 * from except the browser's history, which is not a trail anybody can read.
 *
 * Two views over one answer: a grouped list, which is the accessible and
 * complete one, and a graph, which is the one that shows shape. The list is the
 * default because "which of these are mine?" is answered by reading, not by
 * looking at a picture.
 *
 * With no record chosen it is an *analysis* page rather than an empty search
 * box. Two analyses, because they answer different questions:
 *
 * * **Communities** — how the actual records cluster, detected on the server
 *   and drawn with D3. This is the default: "what does this data look like?"
 *   is the question people arrive with, and it cannot be answered one record
 *   at a time.
 * * **Connection map** — how the entity *types* link, weighted by real row
 *   counts, with per-relation coverage and the hub records.
 *
 * An explorer whose landing state asks the reader to already know what they
 * are looking for is an explorer that only helps people who did not need it.
 */

import { Alert, Breadcrumb, Button, Card, Segmented, Skeleton, Space, Tag, Typography } from "antd";
import { ArrowLeftOutlined, ExportOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";
import { EgoGraph } from "@/components/graph/EgoGraph";
import { EmptyState } from "@/components/EmptyState";

import { StartHere } from "./StartHere";

const { Text } = Typography;

import { RelationList } from "./RelationList";
import { useRelationshipExplorer } from "./useRelationshipExplorer";

export default function RelationshipExplorerPage() {
  const m = useRelationshipExplorer();
  const { setParams, navigate, view, setView, resource, id, trail, graph, open, goBack } = m;

  if (!resource || !id) {
    return <StartHere onStart={(node, entity) => setParams({ resource: entity, id: node.id })} />;
  }

  const root = graph.data?.root;

  return (
    <>
      <PageHeader
        title={root?.label ?? "Relationships"}
        subtitle={
          root?.summary ||
          "Everything this record points at, and everything pointing at it."
        }
        tag={graph.data && <Tag color="blue">{graph.data.total} connections</Tag>}
        actions={
          <Space>
            <Segmented
              data-testid="relationship-view"
              value={view}
              onChange={(next) => setView(next as "list" | "graph")}
              options={[
                { label: "List", value: "list" },
                { label: "Graph", value: "graph" },
              ]}
            />
            {root && (
              <Button
                icon={<ExportOutlined />}
                onClick={() => navigate(`/explore?resource=${root.resource_type}&f.id=${root.id}`)}
              >
                Open in Data Explorer
              </Button>
            )}
          </Space>
        }
      />

      {trail.length > 0 && (
        <Breadcrumb
          className="nu-trail"
          items={[
            ...trail.map((step, index) => ({
              title: (
                <button type="button" className="nu-link-button" onClick={() => goBack(index)}>
                  {step.label}
                </button>
              ),
              key: `${step.resource}:${step.id}:${index}`,
            })),
            { title: <Text strong>{root?.label ?? "…"}</Text>, key: "current" },
          ]}
        />
      )}

      {graph.isError && (
        <Alert
          type="error"
          showIcon
          message="Those connections could not be loaded"
          description={graph.error instanceof Error ? graph.error.message : "Unknown error"}
          action={
            trail.length > 0 && (
              <Button icon={<ArrowLeftOutlined />} onClick={() => goBack(trail.length - 1)}>
                Back
              </Button>
            )
          }
        />
      )}

      {graph.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}

      {graph.data && graph.data.total === 0 && (
        <EmptyState title="Nothing links to this record, and it links to nothing." />
      )}

      {graph.data && graph.data.total > 0 && view === "graph" && (
        <Card size="small">
          <EgoGraph root={graph.data.root} groups={graph.data.groups} onOpen={open} />
        </Card>
      )}

      {graph.data && graph.data.total > 0 && view === "list" && (
        <RelationList m={m} />
      )}
    </>
  );
}
