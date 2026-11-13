import type { QualityOverview } from "@/api/quality";
import { StatCard } from "@/components/StatCard";
import { formatNumber } from "@/lib/formats";

import { summarise } from "./qualityRank";

/** The four headline numbers over every dataset. */
export function QualityTotals({ overview }: { overview: QualityOverview }) {
  return (
    <div className="nu-quality-totals" data-testid="quality-totals">
      <StatCard
        label="Checks run"
        value={overview.totals.checks}
        hint="Every dataset, every rule"
        accent="neutral"
      />
      <StatCard
        label="With something in them"
        value={overview.totals.failing}
        hint={summarise(overview)}
        accent={overview.totals.failing > 0 ? "warning" : "success"}
      />
      <StatCard
        label="Contradictions"
        value={overview.totals.by_severity.CRITICAL}
        hint="A state that cannot be true"
        accent={overview.totals.by_severity.CRITICAL > 0 ? "danger" : "success"}
      />
      <StatCard
        label="Records involved"
        value={overview.totals.records}
        displayValue={formatNumber(overview.totals.records)}
        accent="accent"
      />
    </div>
  );
}
