import { useQuery } from "@tanstack/react-query";
import { List, Space, Tag, Tooltip, Typography } from "antd";
import { Link } from "react-router-dom";

import { relationshipsApi } from "@/api/relationships";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/**
 * The records everything else hangs off.
 *
 * The overview's hubs, which is the one part of a connection map that reads at
 * card size: a graph drawn 300 pixels wide is decoration, but "this customer
 * is on 48 things" is a fact somebody acts on.
 */
export function RelationshipsBody({ resources, fallback }: ModuleBodyProps) {
  const map = useQuery({
    queryKey: queryKeys.relationshipOverview(),
    queryFn: ({ signal }) => relationshipsApi.overview(signal),
    staleTime: STALE.long,
  });

  if (map.isLoading) return <Loading />;
  if (map.isError) return fallback(map.error, "relationships");

  const hubs = (map.data?.hubs ?? []).slice(0, ROWS);
  if (hubs.length === 0) return <Nothing what="Nothing is connected yet" />;

  return (
    <>
      <List
        size="small"
        dataSource={hubs}
        renderItem={(hub) => {
          const resource = resources.find((entry) => entry.key === hub.resource_type);
          return (
            <List.Item>
              <Link
                to={`/explore?resource=${hub.resource_type}&record=${hub.id}`}
                className="nu-widget-row"
              >
                <Text ellipsis>{hub.label}</Text>
                <Space size={4}>
                  <Text type="secondary" className="nu-widget-dim">
                    {resource?.label ?? hub.resource_type}
                  </Text>
                  <Tooltip title={`Connected through ${hub.via_label}`}>
                    <Tag bordered={false}>{hub.connections}</Tag>
                  </Tooltip>
                </Space>
              </Link>
            </List.Item>
          );
        }}
      />
      <MoreLink to="/find/relationships">
        {(map.data?.totals.links ?? 0).toLocaleString()} links across{" "}
        {map.data?.totals.entities ?? 0} datasets
      </MoreLink>
    </>
  );
}
