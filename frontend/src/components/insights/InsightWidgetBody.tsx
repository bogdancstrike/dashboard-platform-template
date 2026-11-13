import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { Link } from "react-router-dom";

import { insightsApi } from "@/api/insights";
import { EmptyState } from "@/components/EmptyState";
import { InsightView } from "./InsightView";
import "@/styles/insights.css";
import { FEATURES, withFeature } from "@/settings/features";

/**
 * A saved insight on a dashboard (§43): the page as composed, with its numbers
 * re-read for this viewer each time the dashboard is drawn — never the
 * owner's stored copy, which may hold rows this viewer may not see.
 */
function InsightWidgetBodyInner({ id }: { id: string }) {
  const insight = useQuery({
    queryKey: ["insight-widget", id],
    queryFn: ({ signal }) => insightsApi.get(id, true, signal),
    staleTime: 60_000,
    retry: false,
  });
  if (insight.isLoading) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (insight.isError || !insight.data) {
    return <EmptyState compact title="That insight is not available to you" hint="It was removed, or it is no longer shared with you." />;
  }
  return (
    <div className="nx-in-widget" data-testid="insight-widget">
      <InsightView blocks={insight.data.rendered?.blocks ?? []} compact />
      <Link className="nx-in-widget-open" to={`/ai/insights?insight=${id}`}>
        Open the insight
      </Link>
    </div>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const InsightWidgetBody = withFeature(FEATURES.aiInsights, InsightWidgetBodyInner);
