import type { ReactNode } from "react";
import { Button, Typography } from "antd";
import { InboxOutlined } from "@ant-design/icons";

/**
 * The state a data view spends more time in than anyone expects (§34).
 *
 * Two of them, really, and the distinction matters: "nothing here yet" wants
 * the action that creates the first record; "nothing matched" wants the
 * filters cleared. A single shrug for both leaves the reader unsure whether
 * they are looking at an empty system or a bad filter.
 */
export function EmptyState({
  title = "Nothing here yet",
  hint,
  icon,
  action,
  compact = false,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`nu-empty${compact ? " nu-empty--compact" : ""}`}>
      <div className="nu-empty-icon">{icon ?? <InboxOutlined />}</div>
      <Typography.Text strong>{title}</Typography.Text>
      {hint && <div className="nu-empty-hint">{hint}</div>}
      {action && <div className="nu-empty-action">{action}</div>}
    </div>
  );
}

/** "Nothing matched" — distinct from "nothing yet", and one click from fixed. */
export function NoResults({ onClear, filterCount }: { onClear?: () => void; filterCount?: number }) {
  return (
    <EmptyState
      title="No records match these filters"
      hint={
        filterCount
          ? `${filterCount} filter${filterCount === 1 ? "" : "s"} are narrowing this list.`
          : "Try widening the search."
      }
      action={onClear ? <Button size="small" onClick={onClear}>Clear filters</Button> : undefined}
    />
  );
}
