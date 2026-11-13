import { StatCard } from "@/components/StatCard";

import { periodLabel, formatMeasure, capitalise } from "../model";
import type { AnalyticsPageData } from "../useAnalyticsPage";

/** The dataset's headline numbers. */
export function HeadlineStrip({ page }: { page: AnalyticsPageData }) {
  const { period, headline, breakdown } = page;
  return (
    <div className="nu-metric-strip" data-testid="analysis-headline">
      {(headline.data?.measures ?? []).map((measure, index) => (
        <StatCard
          key={measure.key}
          label={capitalise(measure.label)}
          value={0}
          displayValue={formatMeasure(headline.data?.totals[measure.key] ?? 0, measure.field)}
          accent={index === 0 ? "accent" : "info"}
          hint={`Over the ${periodLabel(period)}, computed across all ${headline.data?.matched.toLocaleString() ?? ""} rows`}
        />
      ))}
      {headline.data && (
        <StatCard
          label="Values in view"
          value={0}
          displayValue={(breakdown.data?.rows.length ?? 0).toLocaleString()}
          accent="neutral"
          hint={
            breakdown.data?.truncated
              ? "The rest are folded into “Other”, so the parts still add up"
              : "Every value in the selection is drawn"
          }
        />
      )}
    </div>
  );
}
