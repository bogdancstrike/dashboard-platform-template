import type { LogLevel } from "@/api/logs";

interface LevelStripProps {
  total: number;
  levels: Array<{ key: LogLevel; count: number }>;
  minLevel: LogLevel | "";
  onChoose: (level: LogLevel | null) => void;
}

/** A severity floor, not a set of toggles: each chip is "this level and worse". */
export function LevelStrip({ total, levels, minLevel, onChoose }: LevelStripProps) {
  return (
    <div className="nu-kindstrip nu-kindstrip--fill" data-testid="log-levels">
      <button
        type="button"
        className={`nu-kindchip${minLevel === "" ? " is-active" : ""}`}
        aria-pressed={minLevel === ""}
        onClick={() => onChoose(null)}
      >
        <span className="nu-kindchip-count">
          {total.toLocaleString()}
        </span>
        <span className="nu-kindchip-label">Everything</span>
      </button>
      {levels.map((entry) => (
        <button
          key={entry.key}
          type="button"
          className={`nu-kindchip${minLevel === entry.key ? " is-active" : ""}`}
          aria-pressed={minLevel === entry.key}
          onClick={() => onChoose(entry.key)}
          data-testid={`log-level-${entry.key}`}
        >
          <span className="nu-kindchip-count">{entry.count.toLocaleString()}</span>
          <span className="nu-kindchip-label">
            {entry.key.toLowerCase()}
            {/* Said on the chip, because "and worse" is the whole
                behaviour and a filter that quietly did more than its
                label would be a filter nobody trusts. */}
            {entry.key !== "CRITICAL" && <span className="nu-kindchip-more"> and worse</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
