import type { Timeline } from "@/api/planning";

/** A group row's label: fold it, its colour, its name and how many bars it holds. */
export function GroupLabel({
  group,
  folded,
  onToggle,
}: {
  group: Timeline["groups"][number];
  folded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="nx-pl-label">
      <button
        type="button"
        className="nx-pl-fold"
        aria-expanded={!folded}
        aria-label={`${folded ? "Expand" : "Collapse"} ${group.label}`}
        onClick={onToggle}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <i className="nx-pl-dot" style={{ background: group.color ?? "var(--nu-accent)" }} />
      <span className="nx-pl-group-name" title={group.label}>
        {group.label}
      </span>
      <span className="nx-pl-count">{group.count}</span>
    </div>
  );
}
