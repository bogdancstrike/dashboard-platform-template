import type { HealthIncident, HealthPoint } from "@/api/meta";
import { LatencyChart } from "@/components/health/LatencyChart";

const START = Date.now() - 24 * 3_600_000;
const POINTS: HealthPoint[] = Array.from({ length: 24 }, (_, hour) => ({
  at: new Date(START + hour * 3_600_000).toISOString(),
  status: hour >= 9 && hour <= 11 ? "DEGRADED" : "HEALTHY",
  latency_ms: hour >= 9 && hour <= 11 ? 620 + hour * 20 : 40 + ((hour * 37) % 30),
}));
const INCIDENTS: HealthIncident[] = [
  { status: "DEGRADED", started_at: POINTS[9]!.at, ended_at: POINTS[11]!.at, points: 3 },
];

export default function ChartLatency() {
  return (
    <div className="nx-doc-grid">
      <LatencyChart points={POINTS} height={96} label="Sparkline: two ticks, no axis labels" />
      <LatencyChart points={POINTS} incidents={INCIDENTS} height={220} detailed label="Detailed: time axis and shaded trouble" />
    </div>
  );
}
