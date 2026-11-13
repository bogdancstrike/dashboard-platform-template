import { useQuery } from "@tanstack/react-query";
import { Skeleton, Table, Typography } from "antd";

import type { DocumentBlock } from "@/api/reportDocuments";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { asText } from "@/lib/text";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { PREVIEW_ROWS, Refused, Unfinished } from "./shared";

const { Text } = Typography;

/** Rows of a dataset, through the query every list in the product uses. */
export function TableBlock({
  block,
  resources,
}: {
  block: DocumentBlock;
  resources: ExplorerResource[];
}) {
  const entity = block.entity ?? "";
  const resource = resources.find((item) => item.key === entity);
  const columns = block.columns?.length
    ? block.columns
    : (resource?.default_columns.slice(0, 5) ?? []);

  const request = {
    resource_type: entity,
    filters: block.filters ?? {},
    columns,
    sort: block.sort || "",
    order: block.order ?? "desc",
    page: 1,
    page_size: Math.min(block.limit ?? 20, PREVIEW_ROWS),
  };

  const rows = useQuery({
    queryKey: queryKeys.entityRows(request),
    queryFn: ({ signal }) => explorerApi.query(request, signal),
    enabled: Boolean(entity),
    staleTime: STALE.minute,
  });

  if (!entity) return <Unfinished what="No dataset chosen yet" />;
  if (rows.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (rows.isError) return <Refused error={rows.error} subject={entity} />;

  const items = rows.data?.items ?? [];
  if (items.length === 0) return <Unfinished what="Nothing matched this block" />;
  const fields = rows.data?.fields ?? [];

  return (
    <figure className="nu-doc-figure">
      {block.caption && <figcaption className="nu-doc-caption">{block.caption}</figcaption>}
      <Table
        size="small"
        className="nu-doc-table"
        rowKey="id"
        pagination={false}
        dataSource={items}
        columns={(rows.data?.columns ?? columns).map((column) => ({
          title: fields.find((field) => field.name === column)?.label ?? column,
          dataIndex: column,
          ellipsis: true,
          render: (value: unknown) => asText(value) || "—",
        }))}
      />
      <Text type="secondary" className="nu-doc-note">
        {(block.limit ?? 20).toLocaleString()} rows in the export, of{" "}
        {(rows.data?.total ?? 0).toLocaleString()} matching.
      </Text>
    </figure>
  );
}
