import { PushpinFilled } from "@ant-design/icons";

import type { InsightSummary } from "@/api/insights";
import { relativeTime } from "@/lib/time";

import { SCOPE } from "../model";

export function InsightCard({ item, onOpen }: { item: InsightSummary; onOpen: () => void }) {
  const scope = SCOPE[item.scope];
  return (
    <button
      type="button"
      className="nx-in-card-link nx-glass"
      onClick={onOpen}
      data-testid="insight-card"
    >
      <span className="nx-in-card-top">
        <span className="nx-in-card-kinds" aria-hidden>
          {item.kinds.slice(0, 6).map((kind, index) => (
            <i key={index} className={`nx-in-kind nx-in-kind--${kind}`} />
          ))}
        </span>
        {item.pinned && <PushpinFilled className="nx-in-card-pin" aria-label="Pinned" />}
      </span>
      <span className="nx-in-card-title">{item.title}</span>
      <span className="nx-in-card-question">{item.question}</span>
      <span className="nx-in-card-meta">
        {scope.icon} {scope.label} · {item.owner.name || "—"} ·{" "}
        {relativeTime(item.refreshed_at ?? item.updated_at)}
      </span>
    </button>
  );
}
