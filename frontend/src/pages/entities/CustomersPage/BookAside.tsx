import { humanStatus } from "@/components/StatusTag";

/**
 * The book of business beside the accounts (§7): how many accounts sit in each
 * segment, and where they are in their lifecycle — each row a filter, so the
 * reader goes from "most of the book is SMB" to those accounts in one press.
 */
export function BookAside({
  segments,
  stages,
  active,
  onSegment,
  onStage,
}: {
  segments: { name: string; value: number }[];
  stages: { name: string; value: number }[];
  active: { segment?: string | null; stage?: string | null };
  onSegment: (name: string | null) => void;
  onStage: (name: string | null) => void;
}) {
  const most = Math.max(1, ...segments.map((item) => item.value));
  const widest = Math.max(1, ...stages.map((item) => item.value));
  return (
    <aside className="nx-rec-book-aside" aria-label="Book of business">
      <section className="nx-rec-panel" data-testid="customers-segment" aria-label="Accounts by segment">
        <h2>Accounts by segment</h2>
        <span className="nx-rec-panel-sub">The number of accounts in each — select one to filter</span>
        <ul className="nx-rec-bars">
          {segments.map((item) => (
            <li key={item.name}>
              <button
                type="button"
                aria-pressed={active.segment === item.name}
                onClick={() => onSegment(active.segment === item.name ? null : item.name)}
              >
                <span className="nx-rec-bars-row">
                  <b>{humanStatus(item.name)}</b>
                  <span>{item.value.toLocaleString()} accts</span>
                </span>
                <span className="nx-rec-bars-track">
                  <i style={{ width: `${(item.value / most) * 100}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section
        className="nx-rec-panel"
        data-testid="customers-lifecycle"
        aria-label="Where accounts are in their lifecycle"
      >
        <h2>Where accounts are in their lifecycle</h2>
        <span className="nx-rec-panel-sub">Select a stage to filter the grid</span>
        <ul className="nx-rec-funnel">
          {stages.map((item) => (
            <li key={item.name}>
              <button
                type="button"
                aria-pressed={active.stage === item.name}
                style={{ width: `${Math.max(46, (item.value / widest) * 100)}%` }}
                onClick={() => onStage(active.stage === item.name ? null : item.name)}
              >
                <span>{humanStatus(item.name)}</span>
                <b>{item.value.toLocaleString()}</b>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
