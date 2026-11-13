import type { Collection } from "@/api/knowledge";
import { relativeTime } from "@/lib/time";

import { SCOPE_LABEL } from "../model";

export function CollectionRow({
  item,
  active,
  onSelect,
}: {
  item: Collection;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`nx-kn-coll${active ? " is-active" : ""}`}
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        data-testid="collection-row"
      >
        <span className="nx-kn-coll-dot" style={{ background: item.color }} />
        <span className="nx-kn-coll-body">
          <span className="nx-kn-coll-name">{item.name}</span>
          <span className="nx-kn-coll-meta">
            {item.counts.documents} doc{item.counts.documents === 1 ? "" : "s"} ·{" "}
            {SCOPE_LABEL[item.scope]}
            {item.last_asked_at ? ` · asked ${relativeTime(item.last_asked_at)}` : ""}
          </span>
        </span>
        {item.counts.pending > 0 && <span className="nx-kn-coll-busy" title="Being read" />}
      </button>
    </li>
  );
}
