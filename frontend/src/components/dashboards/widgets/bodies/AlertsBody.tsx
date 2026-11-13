import { useQuery } from "@tanstack/react-query";
import { List, Skeleton, Tag, Typography } from "antd";
import { Link } from "react-router-dom";

import { dashboardApi } from "@/api/dashboard";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";

const { Text } = Typography;

/** The alert strip the home dashboard already computes. */
export function AlertsBody() {
  const alerts = useQuery({
    queryKey: queryKeys.dashboardAlerts(),
    queryFn: ({ signal }) => dashboardApi.alerts(signal),
    staleTime: STALE.short,
  });

  if (alerts.isLoading) return <Skeleton active title={false} paragraph={{ rows: 3 }} />;
  if (alerts.isError) return <WidgetError error={alerts.error} entity="" />;

  const items = alerts.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState compact title="Nothing needs attention" />;
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(alert) => (
        <List.Item>
          <Link to={alert.link} className="nu-widget-row">
            <Tag
              color={
                alert.severity === "CRITICAL"
                  ? "error"
                  : alert.severity === "WARNING"
                    ? "warning"
                    : "processing"
              }
              bordered={false}
            >
              {alert.count}
            </Tag>
            <Text ellipsis>{alert.message}</Text>
          </Link>
        </List.Item>
      )}
    />
  );
}
