import { Card, Skeleton, Table } from "antd";

import type { SecurityEvent } from "@/api/security";
import { EmptyState } from "@/components/EmptyState";

import { eventColumns } from "./historyColumns";
import type { useSecurityPage } from "./useSecurityPage";

/** What the platform noticed about the account. */
export function EventsCard({ page }: { page: ReturnType<typeof useSecurityPage> }) {
  const { events, resolved } = page;
  return (
    <Card
      size="small"
      title="What the platform noticed"
      className="nu-sec-card"
      data-testid="events-card"
      id="events-card"
    >
      {events.isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <Table<SecurityEvent>
          data-testid="events-table"
          rowKey="id"
          size="small"
          dataSource={events.data?.items ?? []}
          columns={eventColumns(resolved)}
          pagination={false}
          rowClassName={(row) => (row.resolved ? "nu-sec-row is-resolved" : "")}
          locale={{
            emptyText: (
              <EmptyState title="Nothing noticed on this account. New devices, changed passwords and unusual sign-ins would appear here." />
            ),
          }}
        />
      )}
    </Card>
  );
}
