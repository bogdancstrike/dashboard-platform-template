/** Fetch related records on demand using the schema-derived relationship API. */
import { useQuery } from "@tanstack/react-query";
import { Empty, List, Skeleton, Typography } from "antd";
import { Link } from "react-router-dom";
import { relationshipsApi } from "@/api/relationships";
import { RecordReadError } from "./RecordReadError";

export function RecordRelations({ resourceType, recordId }: { resourceType: string; recordId: string }) {
  const relations = useQuery({
    queryKey: ["relationships", resourceType, recordId],
    queryFn: ({ signal }) => relationshipsApi.of(resourceType, recordId, signal),
  });
  if (relations.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (relations.isError) return <RecordReadError error={relations.error} onRetry={() => void relations.refetch()} />;
  const groups = relations.data?.groups.filter((group) => group.total > 0) ?? [];
  if (groups.length === 0) return <Empty description="No related records" />;

  return <div className="nu-record-content">{groups.map((group) => (
    <section key={`${group.direction}:${group.relation}`}>
      <Typography.Title level={5}>{group.label} · {group.total}</Typography.Title>
      <List size="small" dataSource={group.items} renderItem={(item) => (
        <List.Item key={`${item.entity}:${item.id}`}>
          <List.Item.Meta title={item.explorable
            ? <Link to={`/explore?resource=${encodeURIComponent(item.entity)}&record=${encodeURIComponent(item.id)}`}>{item.label}</Link>
            : item.label} description={item.summary} />
        </List.Item>
      )} />
      {group.has_more && <Link to={`/find/relationships?resource=${resourceType}&id=${recordId}`}>
        Explore all {group.total} connections
      </Link>}
    </section>
  ))}</div>;
}
