import { ApiError } from "@/api/client";
import type { ChartPanel } from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";

const PANEL: ChartPanel = {
  kind: "bar",
  title: "Tickets by severity",
  series: [
    { name: "Critical", value: 4 },
    { name: "High", value: 11 },
    { name: "Normal", value: 26 },
    { name: "Low", value: 7 },
  ],
};

export default function ChartCardStates() {
  return (
    <div className="nx-doc-grid">
      <ChartCard id="docs-loading" height={160} panel={undefined} loading />
      <ChartCard
        id="docs-empty"
        height={160}
        panel={{ ...PANEL, series: [] }}
        empty={{ title: "Nothing in this period", hint: "The question was fine." }}
      />
      <ChartCard
        id="docs-error"
        height={160}
        panel={undefined}
        error={new ApiError(500, { error: "demo", message: "The aggregate timed out." }, "c0ffee-demo")}
        onRetry={() => undefined}
      />
    </div>
  );
}
