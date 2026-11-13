import { Card, Descriptions, List, Skeleton, Space, Typography } from "antd";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { StatusTag } from "@/components/StatusTag";
import { relativeTime } from "@/lib/time";

import type { SiblingTicket, useTicketAccount } from "./useTicketAccount";

const { Text } = Typography;

/**
 * The account's history is a filter, not an embedded list: the newest few of
 * its other tickets, and a link to the rest.
 */
export function AccountCard({
  id,
  customerId,
  account,
  siblings,
}: { id: string; customerId: string } & ReturnType<typeof useTicketAccount>) {
  const others = ((siblings.data?.items ?? []) as SiblingTicket[]).filter(
    (row) => row.id !== id,
  );
  return (
    <Card
      size="small"
      title="Account"
      className="nu-block"
      data-testid="ticket-account"
      extra={
        customerId ? <Link to={`/customers/${customerId}`}>Open</Link> : undefined
      }
    >
      {!customerId ? (
        <EmptyState compact title="This ticket is not filed against a customer" />
      ) : account.isLoading ? (
        <Skeleton active title={false} paragraph={{ rows: 3 }} />
      ) : (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="Customer">
              {account.data?.title ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              {account.data ? <StatusTag status={account.data.status} /> : "—"}
            </Descriptions.Item>
          </Descriptions>

          <div>
            <Text strong className="nu-field-label">
              Their other tickets
            </Text>
            {siblings.isLoading ? (
              <Skeleton active title={false} paragraph={{ rows: 2 }} />
            ) : others.length === 0 ? (
              <Text type="secondary">This is the only one they have raised.</Text>
            ) : (
              <List
                size="small"
                dataSource={others}
                renderItem={(row) => (
                  <List.Item>
                    <Space direction="vertical" size={0} style={{ width: "100%" }}>
                      <Link to={`/tickets/${row.id}`}>{row.subject}</Link>
                      <Space size={6}>
                        <StatusTag status={row.status} />
                        <Text type="secondary">{relativeTime(row.created_at)}</Text>
                      </Space>
                    </Space>
                  </List.Item>
                )}
              />
            )}
            {(siblings.data?.total ?? 0) > others.length + 1 && (
              <Link to={`/tickets?f.customer_id=${customerId}`}>
                All {siblings.data?.total} for this account
              </Link>
            )}
          </div>
        </Space>
      )}
    </Card>
  );
}
