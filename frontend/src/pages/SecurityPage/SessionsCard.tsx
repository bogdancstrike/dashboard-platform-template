import { Alert, Card, Skeleton, Table } from "antd";

import type { SignInSession } from "@/api/security";
import { EmptyState } from "@/components/EmptyState";

import { sessionColumns } from "./sessionColumns";
import type { useSecurityPage } from "./useSecurityPage";

/** Every session on the account, this one marked. */
export function SessionsCard({ page }: { page: ReturnType<typeof useSecurityPage> }) {
  const { sessions, trusted, revoked } = page;
  return (
    <Card
      size="small"
      title="Where you are signed in"
      className="nu-sec-card"
      data-testid="sessions-card"
      id="sessions-card"
    >
      {sessions.isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <>
          {sessions.data && !sessions.data.current_known ? (
            <Alert
              type="info"
              showIcon
              className="nu-sec-note"
              data-testid="no-current"
              message="This request carried no session, so none of these is marked as the one you are using."
              description="That happens with a machine credential rather than a browser sign-in."
            />
          ) : null}
          <Table<SignInSession>
            data-testid="sessions-table"
            rowKey="id"
            size="small"
            dataSource={sessions.data?.items ?? []}
            columns={sessionColumns(trusted, revoked)}
            pagination={false}
            rowClassName={(row) => (row.current ? "nu-sec-row is-current" : "")}
            locale={{
              emptyText: (
                <EmptyState title="No sign-ins recorded on this account yet." />
              ),
            }}
          />
        </>
      )}
    </Card>
  );
}
