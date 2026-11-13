import { useQuery } from "@tanstack/react-query";
import { List, Skeleton, Table, Typography } from "antd";
import { Link } from "react-router-dom";

import type { DashboardWidget } from "@/api/dashboards";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { StatusTag } from "@/components/StatusTag";
import { asText } from "@/lib/text";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";

const { Text } = Typography;

/** The newest few records of a dataset, as a list or as a table. */
export function RowsBody({
  widget,
  resource,
  table,
}: {
  widget: DashboardWidget;
  resource: ExplorerResource | undefined;
  table: boolean;
}) {
  const entity = widget.config.entity ?? "";
  const columns = resource?.default_columns.slice(0, 3) ?? [];
  const request = {
    resource_type: entity,
    filters: widget.config.filters ?? {},
    columns: table ? columns : undefined,
    sort: "updated_at",
    order: "desc" as const,
    page_size: table ? 5 : 6,
  };

  const rows = useQuery({
    queryKey: queryKeys.entityRows(request),
    queryFn: ({ signal }) => explorerApi.query(request, signal),
    enabled: Boolean(entity),
    staleTime: STALE.short,
  });

  if (rows.isLoading) return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  if (rows.isError) return <WidgetError error={rows.error} entity={entity} />;

  const items = rows.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState compact title="Nothing here yet" />;
  }

  const path = resource?.path ?? "";
  const title = resource?.title_field ?? "";
  const status = resource?.status_field ?? "";

  if (table) {
    return (
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={items}
        columns={columns.map((column) => ({
          title: resource?.fields.find((field) => field.name === column)?.label ?? column,
          dataIndex: column,
          ellipsis: true,
          // `asText`, not `String`: a declared JSON or array column is an
          // object, and `String({})` reads as a bug in the field rather than
          // in the rendering of it.
          render: (value: unknown) =>
            column === status ? (
              <StatusTag status={asText(value)} />
            ) : (
              <Text ellipsis>{asText(value) || "—"}</Text>
            ),
        }))}
      />
    );
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(row) => (
        <List.Item>
          <Link to={`${path}/${row.id}`} className="nu-widget-row">
            <Text ellipsis>{asText(row[title]) || asText(row["id"])}</Text>
            {status && row[status] ? (
              <StatusTag status={asText(row[status])} bordered={false} />
            ) : null}
          </Link>
        </List.Item>
      )}
    />
  );
}
