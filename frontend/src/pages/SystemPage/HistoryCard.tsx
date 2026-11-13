import { Card, Typography } from "antd";

import { EmptyState } from "@/components/EmptyState";
import { ServiceHistoryCard } from "@/components/health/ServiceHistoryCard";
import { shortRange } from "@/components/health/when";

import { ErrorPanel } from "./healthParts";
import type { useSystemPage } from "./useSystemPage";

const { Text } = Typography;

type Page = ReturnType<typeof useSystemPage>;

/** What each dependency has been doing over the window. */
export function HistoryCard({ page }: { page: Page }) {
  const { history } = page;
  return (
    <Card
      size="small"
      title="What each of them has been doing"
      data-testid="health-history"
      loading={history.isLoading}
      extra={
        history.data ? (
          <Text type="secondary">
            {shortRange(history.data.from, history.data.to)} ·{" "}
            {history.data.counts.incidents === 0
              ? "nothing went wrong"
              : `${history.data.counts.incidents} ${
                  history.data.counts.incidents === 1 ? "period" : "periods"
                } of trouble`}
          </Text>
        ) : undefined
      }
    >
      {history.isError ? (
        <ErrorPanel error={history.error} />
      ) : (history.data?.services.length ?? 0) === 0 ? (
        <EmptyState compact title="No service has recorded anything in this window" />
      ) : (
        <div className="nu-health-grid">
          {(history.data?.services ?? []).map((service) => (
            <ServiceHistoryCard key={service.key} service={service} />
          ))}
        </div>
      )}
    </Card>
  );
}
