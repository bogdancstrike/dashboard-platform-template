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
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Empty,
  List,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  ExportOutlined,
  LoginOutlined,
  LogoutOutlined,
} from "@ant-design/icons";

import { relationshipsApi, type RelatedNode } from "@/api/relationships";
import { searchApi } from "@/api/search";
import { PageHeader } from "@/components/PageHeader";
import { RelationshipGraph } from "@/components/RelationshipGraph";
import { SimpleSearch } from "@/components/explorer/SimpleSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const { Text } = Typography;

/** One step of the exploration: enough to name it and go back to it. */
interface Step {
  resource: string;
  id: string;
  label: string;
}

export default function RelationshipExplorerPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState<"list" | "graph">("list");

  const resource = params.get("resource") ?? "";
  const id = params.get("id") ?? "";
  const trail = useMemo(() => parseTrail(params.get("trail")), [params]);

  const graph = useQuery({
    queryKey: ["relationships", resource, id],
    queryFn: ({ signal }) => relationshipsApi.of(resource, id, signal),
    enabled: Boolean(resource && id),
  });

  /** Follow a connection, remembering where it was followed from. */
  const open = (node: RelatedNode, entity: string) => {
    const root = graph.data?.root;
    const next = root
      ? [...trail, { resource: root.resource_type, id: root.id, label: root.label }]
      : trail;
    setParams({ resource: entity, id: node.id, trail: JSON.stringify(next.slice(-12)) });
  };

  /** Jump back to any earlier step, discarding everything after it. */
  const goBack = (index: number) => {
    const step = trail[index];
    if (!step) return;
    setParams({
      resource: step.resource,
      id: step.id,
      trail: JSON.stringify(trail.slice(0, index)),
    });
  };

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
        <Empty description="Nothing links to this record, and it links to nothing." />
      )}

      {graph.data && graph.data.total > 0 && view === "graph" && (
        <Card size="small">
          <RelationshipGraph root={graph.data.root} groups={graph.data.groups} onOpen={open} />
        </Card>
      )}

      {graph.data && graph.data.total > 0 && view === "list" && (
        <div className="nu-relations">
          {graph.data.groups.map((group) => (
            <Card
              key={`${group.direction}:${group.relation}`}
              size="small"
              className="nu-relation-group"
              title={
                <Space>
                  <Tooltip
                    title={
                      group.direction === "outbound"
                        ? "This record points at it"
                        : "It points at this record"
                    }
                  >
                    {group.direction === "outbound" ? <LogoutOutlined /> : <LoginOutlined />}
                  </Tooltip>
                  <span>{group.label}</span>
                  <Tag>{group.total}</Tag>
                </Space>
              }
              extra={
                group.has_more && (
                  <Button
                    type="link"
                    onClick={() =>
                      navigate(
                        `/explore?resource=${group.target}&f.${relationColumn(group.relation)}=${id}`,
                      )
                    }
                  >
                    See all {group.total}
                  </Button>
                )
              }
            >
              <List
                dataSource={group.items}
                renderItem={(node) => (
                  <List.Item
                    className="nu-relation-item"
                    actions={
                      node.explorable
                        ? [
                            <Button
                              key="open"
                              type="link"
                              icon={<ApartmentOutlined />}
                              onClick={() => open(node, group.target)}
                            >
                              Follow
                            </Button>,
                          ]
                        : []
                    }
                  >
                    <List.Item.Meta
                      title={node.label}
                      description={node.summary || <Text type="secondary">{group.target}</Text>}
                    />
                  </List.Item>
                )}
              />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** The starting point: any record, found the way anything else is found. */
function StartHere({ onStart }: { onStart: (node: RelatedNode, entity: string) => void }) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), 280);
  const results = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: ({ signal }) => searchApi.global(debounced, signal),
    enabled: debounced.length >= 2,
  });

  return (
    <>
      <PageHeader
        title="Relationships"
        subtitle="Start from any record and follow how it connects to the rest of the platform."
      />
      <Card size="small">
        <SimpleSearch dataset="relationships" label="a record to start from" value={term} onChange={setTerm} />
      </Card>

      {results.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}

      {results.data?.groups.map((group) => (
        <Card key={group.resource_type} size="small" title={group.label}>
          <List
            dataSource={group.items}
            renderItem={(hit) => (
              <List.Item
                className="nu-relation-item"
                actions={[
                  <Button
                    key="start"
                    type="link"
                    icon={<ApartmentOutlined />}
                    onClick={() =>
                      onStart(
                        {
                          id: hit.id,
                          label: hit.label,
                          summary: hit.summary,
                          entity: hit.resource_type,
                          explorable: true,
                          updated_at: null,
                        },
                        hit.resource_type,
                      )
                    }
                  >
                    Start here
                  </Button>,
                ]}
              >
                <List.Item.Meta title={hit.label} description={hit.summary} />
              </List.Item>
            )}
          />
        </Card>
      ))}

      {results.data && results.data.total === 0 && debounced.length >= 2 && (
        <Empty description={`Nothing matches “${debounced}”`} />
      )}
    </>
  );
}

/** `tickets.customer_id` → `customer_id`, the column that points back here. */
function relationColumn(relation: string): string {
  return relation.includes(".") ? (relation.split(".")[1] as string) : relation;
}

function parseTrail(raw: string | null): Step[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (step): step is Step =>
            typeof step === "object" && step !== null && "resource" in step && "id" in step,
        )
      : [];
  } catch {
    // A hand-edited or truncated trail is not a reason to fail the page.
    return [];
  }
}
