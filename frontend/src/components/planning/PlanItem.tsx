import { Tooltip } from "antd";
import type { HTMLAttributes } from "react";

import type { SprintCard } from "@/api/planning";

/** The one-letter badge a backlog row starts with, as Jira draws it. */
export function KindBadge({ kind }: { kind: string }) {
  return (
    <span className={`nx-pl-kind is-${kind}`} aria-label={kind.toLowerCase()} title={kind.charAt(0) + kind.slice(1).toLowerCase()}>
      {kind.charAt(0)}
    </span>
  );
}

/** Points, or a dash for work nobody has sized yet. */
export function Points({ value }: { value: number | null }) {
  return (
    <span className="nx-pl-points" aria-label={value === null ? "not estimated" : `${value} points`}>
      {value === null ? "–" : value}
    </span>
  );
}

/** A row in a backlog or a sprint: kind, reference, title, who, points. */
export function PlanItem({
  item,
  epicName,
  drag,
  onOpen,
}: {
  item: SprintCard;
  epicName?: string;
  drag?: HTMLAttributes<HTMLElement> & { className?: string; "data-drag-id"?: string };
  onOpen: () => void;
}) {
  const { className = "", onKeyDown, ...handlers } = drag ?? {};
  return (
    <article
      {...handlers}
      className={`nx-pl-item ${className}`}
      style={{ ["--nx-pl-tone" as string]: item.cover_color ?? "transparent" }}
      data-testid={`plan-item-${item.reference}`}
      aria-label={`${item.reference} ${item.title}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === "Enter" && event.target === event.currentTarget) onOpen();
      }}
    >
      <KindBadge kind={item.kind} />
      <span className="nx-pl-ref">{item.reference}</span>
      <span className="nx-pl-title">{item.title}</span>
      {item.blocked_reason && (
        <Tooltip title={item.blocked_reason}>
          <span className="nx-pl-flag">Blocked</span>
        </Tooltip>
      )}
      {epicName && <span className="nx-pl-chip is-epic">{epicName}</span>}
      {item.status !== "NEW" && <span className="nx-pl-chip">{item.status.replace(/_/g, " ").toLowerCase()}</span>}
      {item.assignee && (
        <span className="nx-pl-who" title={item.assignee.name}>
          {item.assignee.initials}
        </span>
      )}
      <Points value={item.story_points} />
    </article>
  );
}
