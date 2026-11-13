import type { DashboardPageData } from "../useDashboardPage";

/** The panels with nothing in this period, named in one quiet line. */
export function QuietPanels({ page }: { page: DashboardPageData }) {
  const { isLoading, quiet } = page;
  return (
    <>
      {/* Panels with nothing in this period: one quiet line naming them, not
          a field of tall blank cards. Pick a longer period to bring them back. */}
      {quiet.length > 0 && !isLoading && (
        <section
          className="nx-ov-quiet nx-glass"
          aria-label="Nothing in this period"
          data-testid="dashboard-quiet"
        >
          <span className="nx-fd-eyebrow">Nothing in this period</span>
          {quiet.map(({ key, panel }) => (
            <span key={key} className="nx-fd-pill" data-chart-id={key}>
              {panel.title}
            </span>
          ))}
        </section>
      )}
    </>
  );
}
