import { BarPanel, StatePanel, TriageTile } from "@/components/records/BreakdownPanels";
import type { EntityView } from "@/entities/useEntityView";

/**
 * The fleet before any unit: what is down, what is about to be, what is out on
 * purpose — then the fleet by state, kind and site. Every count is a filter.
 */
export function FleetSummary({ view }: { view: EntityView }) {
  const breakdown = (field: string) =>
    view.insights.data?.breakdowns.find((item) => item.field === field);
  const stateCount = (status: string) =>
    breakdown("status")?.series.find((item) => item.name === status)?.value ?? 0;

  return (
    <>
    <section className="nx-rec-triage-row" aria-label="Fleet summary">
      <TriageTile
        count={stateCount("OFFLINE")}
        title="Down"
        detail="Offline right now"
        tone="bad"
        onShow={() => view.setFilter("status", "OFFLINE")}
      />
      <TriageTile
        count={stateCount("DEGRADED")}
        title="About to be"
        detail="Degraded — still talking, not well"
        tone="warn"
        onShow={() => view.setFilter("status", "DEGRADED")}
      />
      <TriageTile
        count={stateCount("MAINTENANCE")}
        title="In maintenance"
        detail="Taken out of service on purpose"
        tone="acc"
        onShow={() => view.setFilter("status", "MAINTENANCE")}
      />
    </section>

    <div className="nx-rec-panels">
      <StatePanel
        title="Fleet by state"
        testId="devices-status"
        series={breakdown("status")?.series ?? []}
        active={view.filters["status"]}
        onSelect={(name) => view.setFilter("status", name)}
      />
      <BarPanel
        title="By kind"
        testId="devices-kind"
        series={breakdown("kind")?.series ?? []}
        active={view.filters["kind"]}
        onSelect={(name) => view.setFilter("kind", name)}
      />
      <BarPanel
        title="By site"
        testId="devices-location"
        series={breakdown("location")?.series ?? []}
        active={view.filters["location"]}
        onSelect={(name) => view.setFilter("location", name)}
      />
    </div>
    </>
  );
}
