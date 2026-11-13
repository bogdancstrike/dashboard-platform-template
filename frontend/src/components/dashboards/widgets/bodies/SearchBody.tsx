import { useQuery } from "@tanstack/react-query";
import { List, Skeleton, Typography } from "antd";
import { Link } from "react-router-dom";

import type { DashboardWidget } from "@/api/dashboards";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { StatusTag } from "@/components/StatusTag";
import { asText } from "@/lib/text";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";

const { Text } = Typography;

/**
 * A saved search, answered here.
 *
 * The stored question, run through the explorer query every list uses — so the
 * widget shows the same rows the explorer would, in the same order, under the
 * same permissions. What it does not do is re-describe the question: a saved
 * search that is edited takes its widgets with it.
 */
export function SearchBody({
  widget,
  resources,
}: {
  widget: DashboardWidget;
  resources: ExplorerResource[];
}) {
  const searchId = widget.config.search_id ?? "";
  const search = useQuery({
    queryKey: queryKeys.savedSearch(searchId),
    queryFn: ({ signal }) => explorerApi.openSaved(searchId, signal),
    enabled: Boolean(searchId),
    staleTime: STALE.minute,
  });

  const stored = search.data;
  const rows = useQuery({
    queryKey: queryKeys.entityRows("saved-search", searchId),
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: stored!.resource_type,
          query_text: stored!.query_text,
          condition_tree: stored!.condition_tree,
          filters: stored!.filters,
          sort: stored!.sort,
          order: stored!.order,
          page_size: 6,
        },
        signal,
      ),
    enabled: Boolean(stored),
    staleTime: STALE.short,
  });

  if (!searchId) {
    return <EmptyState compact title="No search chosen" />;
  }
  if (search.isLoading || rows.isLoading) {
    return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  }
  if (search.isError) return <WidgetError error={search.error} entity="" />;
  if (rows.isError) return <WidgetError error={rows.error} entity={stored?.resource_type ?? ""} />;

  const resource = resources.find((item) => item.key === stored?.resource_type);
  const items = rows.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState compact title="Nothing matches it now" />;
  }

  const title = resource?.title_field ?? "";
  const status = resource?.status_field ?? "";
  const path = resource?.path ?? "";

  return (
    <>
      <Text type="secondary" style={{ display: "block", marginBottom: 4, fontSize: 12 }}>
        {rows.data?.total.toLocaleString()} match {stored?.name}
      </Text>
      <List
        size="small"
        dataSource={items}
        renderItem={(row) => (
          <List.Item>
            <Link to={`${path}/${row.id}`} className="nu-widget-row">
              <Text ellipsis>{asText(row[title]) || asText(row["id"])}</Text>
              {status && row[status] ? <StatusTag status={asText(row[status])} /> : null}
            </Link>
          </List.Item>
        )}
      />
    </>
  );
}
