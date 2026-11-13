import type { ActivityPageData } from "../useActivityPage";

/** Every kind, its count over the whole match, and the filter. */
export function KindStrip({ view }: { view: ActivityPageData }) {
  const { kind, set, kinds, matched } = view;
  return (
    <>
      {/* The strip: every kind, its count over the whole match, and the
          filter. A chip at zero is still offered — see the module docstring. */}
      <div className="nu-kindstrip nx-ov-kinds" data-testid="activity-kinds">
        <button
          type="button"
          className={`nu-kindchip${kind === "" ? " is-active" : ""}`}
          aria-pressed={kind === ""}
          onClick={() => set({ kind: null })}
        >
          <span className="nu-kindchip-label">Everything</span>
          <span className="nu-kindchip-count">{matched.toLocaleString()}</span>
        </button>
        {kinds.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`nu-kindchip${kind === entry.key ? " is-active" : ""}${
              entry.count === 0 ? " is-empty" : ""
            }`}
            aria-pressed={kind === entry.key}
            // Offered at zero, and refused: the reader learns the kind exists
            // and that nothing of it happened in this period (§76).
            disabled={entry.count === 0}
            onClick={() => set({ kind: entry.key })}
            data-testid={`activity-kind-${entry.key}`}
          >
            <span className="nu-kindchip-label">{entry.label}</span>
            <span className="nu-kindchip-count">{entry.count.toLocaleString()}</span>
          </button>
        ))}
      </div>
    </>
  );
}
