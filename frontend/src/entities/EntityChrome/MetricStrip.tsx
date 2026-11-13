import { StatCard } from "@/components/StatCard";
import type { EntityView } from "@/entities/useEntityView";

import { formatMetric } from "./formatMetric";

/**
 * The dataset's declared headline numbers, over the rows currently in view.
 *
 * A tile with a `filter` is a control: clicking it narrows the list to the
 * rows it counted (§44). One without is a total, and totals are not filters.
 */
export function MetricStrip({
  view,
  accents = [],
}: {
  view: EntityView;
  /** Per-tile accent, in declaration order. */
  accents?: string[];
}) {
  const metrics = view.insights.data?.metrics ?? [];
  if (metrics.length === 0) return null;

  return (
    <div className="nu-metric-strip" data-testid="entity-metrics">
      {metrics.map((metric, index) => {
        const shown = formatMetric(metric);
        const field = Object.keys(metric.filter)[0];
        const values = field ? metric.filter[field] : undefined;
        const applies = Boolean(field && values && values.length === 1);
        return (
          <StatCard
            key={metric.key}
            label={metric.label}
            value={0}
            displayValue={shown.value}
            unit={shown.unit}
            accent={accents[index] ?? "accent"}
            hint={metric.hint}
            onClick={
              applies
                ? () => view.setFilter(field!, values![0] ?? null)
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
