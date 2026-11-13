import { useQuery } from "@tanstack/react-query";
import { List, Space, Tag, Typography } from "antd";
import { StarFilled } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { explorerApi } from "@/api/explorer";
import { queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/**
 * The questions this reader saved, ready to be asked again.
 *
 * Deliberately *not* the answers. A `SEARCH` widget runs one saved search and
 * shows its rows; this one is the shelf they sit on — the dozen questions
 * somebody built, so opening the one that matters today is a press rather than
 * a trip through the explorer's drawer.
 *
 * Running all of them to put a count beside each would be a dozen queries per
 * dashboard load, and a dashboard that costs twelve queries to render is one
 * people stop leaving open.
 */
export function ExplorerBody({ widget, resources, fallback }: ModuleBodyProps) {
  const entity = widget.config.entity || undefined;
  const saved = useQuery({
    queryKey: queryKeys.savedSearches(entity ?? "all"),
    queryFn: ({ signal }) => explorerApi.saved(entity, signal),
    staleTime: 120_000,
  });

  if (saved.isLoading) return <Loading />;
  if (saved.isError) return fallback(saved.error, entity ?? "saved searches");

  const items = (saved.data?.items ?? []).slice(0, ROWS);
  if (items.length === 0) {
    return <Nothing what="No saved searches yet — build one in the explorer" />;
  }

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => {
          const resource = resources.find((entry) => entry.key === item.resource_type);
          return (
            <List.Item>
              <Link
                to={`/explore?resource=${item.resource_type}&search=${item.id}`}
                className="nu-widget-row"
              >
                <Space size={6}>
                  {item.is_favorite && <StarFilled className="nu-widget-star" aria-hidden />}
                  <Text ellipsis>{item.name}</Text>
                </Space>
                <Space size={4}>
                  <Text type="secondary" className="nu-widget-dim">
                    {resource?.label ?? item.resource_type}
                  </Text>
                  {item.rule_count > 0 && (
                    <Tag bordered={false}>{item.rule_count} rules</Tag>
                  )}
                </Space>
              </Link>
            </List.Item>
          );
        }}
      />
      <MoreLink to={`/explore${entity ? `?resource=${entity}` : ""}`}>Open the explorer</MoreLink>
    </>
  );
}
