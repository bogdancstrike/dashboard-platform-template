/**
 * What is attached to one record — as a picture, and as a list (§50, §64).
 *
 * The tab was a list of groups, which answers "what is attached" and not "how
 * is this record connected". Those are different questions and the second is
 * usually the one somebody opens this tab for: an order with two tickets and
 * a customer is a different shape from an order with fourteen tickets, and no
 * arrangement of headings makes that visible.
 *
 * So the graph leads and the list stays. Three decisions worth stating.
 *
 * **The same `EgoGraph` `/find/relationships` draws.** Not a smaller second
 * implementation: the picture in the drawer and the picture on the page are
 * the same component over the same endpoint, so they cannot disagree about
 * what is connected to what. It is the *whole* purpose of that page rendered
 * at drawer size, which is exactly what somebody wants before deciding to open
 * the page.
 *
 * **The list is not a fallback, it is the other answer.** A graph is unreadable
 * as a way of finding *one particular* related record; a list is unreadable as
 * a way of seeing shape. Both, switched, and the choice sticks (§72) because
 * which one a person wants is a fact about them rather than about the record.
 *
 * **A record with nothing attached says so once.** Not an empty canvas, which
 * is indistinguishable from a graph that failed to draw.
 */

import { useQuery } from "@tanstack/react-query";
import { List, Segmented, Skeleton, Space, Typography } from "antd";
import { ApartmentOutlined, BarsOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";

import { relationshipsApi } from "@/api/relationships";
import { EgoGraph } from "@/components/graph/EgoGraph";
import { useSticky } from "@/hooks/useSticky";
import { EmptyState } from "@/components/EmptyState";

import { RecordReadError } from "./RecordReadError";

const { Text, Title } = Typography;

export function RecordRelations({
  resourceType,
  recordId,
}: {
  resourceType: string;
  recordId: string;
}) {
  const navigate = useNavigate();
  /** Picture or list. A fact about the reader, so it sticks (§72). */
  const [view, setView] = useSticky<string>("explore.relations.view", "graph");

  const relations = useQuery({
    queryKey: ["relationships", resourceType, recordId],
    queryFn: ({ signal }) => relationshipsApi.of(resourceType, recordId, signal),
  });

  if (relations.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (relations.isError) {
    return <RecordReadError error={relations.error} onRetry={() => void relations.refetch()} />;
  }

  const groups = relations.data?.groups.filter((group) => group.total > 0) ?? [];
  const root = relations.data?.root;
  if (groups.length === 0 || !root) return <EmptyState title="No related records" />;

  return (
    <div className="nu-record-content">
      <div className="nu-relations-bar">
        <Segmented
          size="small"
          aria-label="How to read the connections"
          value={view}
          onChange={(next) => setView(String(next))}
          options={[
            { value: "graph", label: "Shape", icon: <ApartmentOutlined /> },
            { value: "list", label: "List", icon: <BarsOutlined /> },
          ]}
        />
        <Link to={`/find/relationships?resource=${resourceType}&id=${recordId}`}>
          {relations.data?.total ?? 0} connections in full
        </Link>
      </div>

      {view === "graph" ? (
        <>
          <EgoGraph
            root={root}
            groups={groups}
            // Double-clicking a node moves the *drawer* to that record rather
            // than opening a second one: the address owns which record is
            // being previewed, so following a connection is a navigation and
            // not a new panel (§69).
            onOpen={(node, entity) =>
              navigate(
                `/explore?resource=${encodeURIComponent(entity)}&record=${encodeURIComponent(node.id)}`,
              )
            }
          />
          <Text type="secondary" className="nu-relations-note">
            Colour is the relation, not the kind of record — two tickets reaching this by
            different foreign keys are two different answers. Drag to rearrange, scroll to zoom,
            double-click a node to follow it.
          </Text>
        </>
      ) : (
        groups.map((group) => (
          <section key={`${group.direction}:${group.relation}`}>
            <Title level={3}>
              {group.label} · {group.total}
            </Title>
            <List
              size="small"
              dataSource={group.items}
              renderItem={(item) => (
                <List.Item key={`${item.entity}:${item.id}`}>
                  <List.Item.Meta
                    title={
                      item.explorable ? (
                        <Link
                          to={`/explore?resource=${encodeURIComponent(item.entity)}&record=${encodeURIComponent(item.id)}`}
                        >
                          {item.label}
                        </Link>
                      ) : (
                        item.label
                      )
                    }
                    description={item.summary}
                  />
                </List.Item>
              )}
            />
            {group.has_more && (
              <Space>
                <Link to={`/find/relationships?resource=${resourceType}&id=${recordId}`}>
                  Explore all {group.total} connections
                </Link>
              </Space>
            )}
          </section>
        ))
      )}
    </div>
  );
}
