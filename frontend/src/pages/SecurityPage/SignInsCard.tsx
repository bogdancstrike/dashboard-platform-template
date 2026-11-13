import { Card, Segmented, Skeleton, Table, Typography } from "antd";

import type { SignIn } from "@/api/security";
import { EmptyState } from "@/components/EmptyState";
import { formatNumber } from "@/lib/formats";

import { signInColumns } from "./historyColumns";
import type { useSecurityPage } from "./useSecurityPage";

const { Paragraph } = Typography;

/** The account's sign-ins, with a filter for the failures. */
export function SignInsCard({ page }: { page: ReturnType<typeof useSecurityPage> }) {
  const { signIns, signInFilter, setSignInFilter } = page;
  return (
    <Card
      size="small"
      title="Sign-in history"
      className="nu-sec-card"
      data-testid="sign-ins-card"
      id="sign-ins-card"
      extra={
        <Segmented
          size="small"
          value={signInFilter}
          onChange={(value) => setSignInFilter(value as "all" | "FAILURE")}
          options={[
            { label: "Everything", value: "all" },
            // Its own filter, because a failure is what somebody opens this
            // page to look for.
            { label: "Failures only", value: "FAILURE" },
          ]}
        />
      }
    >
      {signIns.isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <>
          <Table<SignIn>
            data-testid="sign-ins-table"
            rowKey="id"
            size="small"
            dataSource={signIns.data?.items ?? []}
            columns={signInColumns}
            pagination={false}
            rowClassName={(row) => (row.result === "SUCCESS" ? "" : "nu-sec-row is-failure")}
            locale={{
              emptyText: (
                <EmptyState title={
                    signInFilter === "FAILURE"
                      ? "No failed sign-ins. That is the answer you want."
                      : "No sign-ins recorded in this window."
                  } />
              ),
            }}
          />
          {signIns.data ? (
            <Paragraph type="secondary" className="nu-sec-window" data-testid="sign-in-window">
              {formatNumber(signIns.data.total)}{" "}
              {signIns.data.total === 1 ? "sign-in" : "sign-ins"} in the last{" "}
              {signIns.data.window_days} days. Nothing here is ever deleted.
            </Paragraph>
          ) : null}
        </>
      )}
    </Card>
  );
}
