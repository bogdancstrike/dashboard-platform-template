import { useLaneSettings, WipBadge } from "@/components/planning/BoardExtras";
import { knownStatusColor } from "@/theme/tokens";

import { laneName } from "./useMoveTask";

/**
 * A lane's heading: its state, and either its count (or WIP badge) or — while
 * a card is over it — what the drop will do.
 */
export function LaneHead({
  status,
  intent,
  count,
  total,
}: {
  status: string;
  /** What a drop here would do, while a card is over the lane. */
  intent: "noop" | "reorder" | "move" | null;
  count: React.ReactNode;
  total: number;
}) {
  const laneSettings = useLaneSettings();
  const settingFor = (key: string) => laneSettings.data?.items.find((item) => item.status === key);
  return (
    <header className="nu-lane-head">
      <span
        className="nu-lane-dot"
        style={{ background: knownStatusColor(status) ?? "var(--nu-border-strong)" }}
        aria-hidden
      />
      <span className="nu-lane-title">{status.replace(/_/g, " ")}</span>
      {/* What the drop will do, in words. A tint is a signal
          somebody has to have learned; "→ in review" is one they
          can read the first time (§34). */}
      {intent ? (
        <span className={`nu-lane-intent${intent === "noop" ? " is-noop" : ""}`}>
          {intent === "noop" ? "back where it was" : intent === "reorder" ? "↕ new place" : `→ ${laneName(status)}`}
        </span>
      ) : (
        <>
          {settingFor(status)?.wip_limit ? (
            <WipBadge count={total} setting={settingFor(status)} />
          ) : (
            <span className="nu-lane-count">{count}</span>
          )}
        </>
      )}
    </header>
  );
}
