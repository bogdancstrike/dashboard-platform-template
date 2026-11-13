/**
 * `/analytics` — one question asked of any dataset (§2, §44, §53, §71).
 *
 * The dashboard answers a fixed set of questions well. This answers the ones
 * nobody anticipated: pick the dataset, the period and the way to cut it, and
 * every panel on the page moves together.
 *
 * Three decisions are what make it an analysis workspace rather than a second
 * dashboard:
 *
 * * **One context, in the URL.** Dataset, period, grouping, granularity and
 *   filters are query parameters, so a finding can be pasted to somebody else
 *   and arrives as the same finding (§69, §72). Every panel reads that one
 *   context — a page where the tiles and the chart can disagree about the
 *   period is a page whose numbers nobody trusts.
 * * **Every number is computed in PostgreSQL** over the whole selection, not
 *   over a page of rows. The headline, the trend and the breakdown are three
 *   calls to one endpoint, and their totals reconcile because they are the
 *   same query with different `GROUP BY`s (§71).
 * * **Every chart is a way into the records.** Clicking a bar leaves for the
 *   entity list with that value filtered, which is what makes an analysis
 *   actionable rather than decorative (§44).
 */

import { Skeleton } from "antd";

import { FailureAlert } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";

import { AnalysisCharts } from "./parts/AnalysisCharts";
import { AnalyticsHeader } from "./parts/AnalyticsHeader";
import { HeadlineStrip } from "./parts/HeadlineStrip";
import { QueryBar } from "./parts/QueryBar";
import { useAnalyticsPage } from "./useAnalyticsPage";

export default function AnalyticsPage() {
  const page = useAnalyticsPage();
  const { catalogue, headline } = page;
  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="Analytics" />
        <FailureAlert
          error={catalogue.error}
          titles={{
            forbidden: "Your role does not include analytics",
            failed: "Analytics is unavailable",
          }}
          onRetry={() => void catalogue.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <AnalyticsHeader page={page} />

      <QueryBar page={page} />

      <HeadlineStrip page={page} />

      <AnalysisCharts page={page} />

      {headline.isError && (
        <FailureAlert
          className="nu-block"
          error={headline.error}
          titles={{
            forbidden: "Your role does not include this dataset",
            failed: "That analysis could not be run",
          }}
          onRetry={() => void headline.refetch()}
        />
      )}
    </>
  );
}
