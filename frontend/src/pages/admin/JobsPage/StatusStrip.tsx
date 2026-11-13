interface StatusStripProps {
  total: number;
  statuses: Array<{ key: string; count: number }>;
  status: string;
  onChoose: (status: string | null) => void;
}

/**
 * The whole queue by status. Counts the whole queue, not the page: clicking a
 * status narrows the table and leaves these alone (§71).
 */
export function StatusStrip({ total, statuses, status, onChoose }: StatusStripProps) {
  return (
    <div className="nu-kindstrip nu-kindstrip--fill" data-testid="job-statuses">
      <button
        type="button"
        className={`nu-kindchip${status === "" ? " is-active" : ""}`}
        aria-pressed={status === ""}
        onClick={() => onChoose(null)}
      >
        <span className="nu-kindchip-count">{total.toLocaleString()}</span>
        <span className="nu-kindchip-label">Everything</span>
      </button>
      {statuses.map((entry) => (
        <button
          key={entry.key}
          type="button"
          className={`nu-kindchip${status === entry.key ? " is-active" : ""}${
            entry.count === 0 ? " is-empty" : ""
          }`}
          aria-pressed={status === entry.key}
          // Offered at nought and refused, so the reader learns the status
          // exists and that nothing is in it (§76).
          disabled={entry.count === 0}
          onClick={() => onChoose(entry.key)}
          data-testid={`job-status-${entry.key}`}
        >
          <span className="nu-kindchip-count">{entry.count.toLocaleString()}</span>
          <span className="nu-kindchip-label">{entry.key.toLowerCase()}</span>
        </button>
      ))}
    </div>
  );
}
