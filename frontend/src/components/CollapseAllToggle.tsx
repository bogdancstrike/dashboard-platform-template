import { Tooltip } from "antd";

import { NxIcon } from "@/components/NxIcon";

/**
 * One small control that folds or unfolds every section of a side menu.
 *
 * Shared so every sidebar in the product — the main navigation, mail folders,
 * a file tree, the component index — offers the same gesture with the same
 * icon in the same corner. It is stateless: the menu owns which sections are
 * open, and passes whether *all* of them are folded.
 */
export function CollapseAllToggle({
  allCollapsed,
  onToggle,
  label = "sections",
  className,
}: {
  /** True when every section is folded; the button then offers to unfold. */
  allCollapsed: boolean;
  onToggle: (collapse: boolean) => void;
  /** What the sections are called, for the accessible name: "groups", "folders"… */
  label?: string;
  className?: string;
}) {
  const action = allCollapsed ? `Expand all ${label}` : `Collapse all ${label}`;
  return (
    <Tooltip title={action}>
      <button
        type="button"
        className={className ? `nx-collapse-all ${className}` : "nx-collapse-all"}
        aria-label={action}
        aria-pressed={allCollapsed}
        onClick={() => onToggle(!allCollapsed)}
      >
        <NxIcon name={allCollapsed ? "expandAll" : "collapseAll"} size={14} stroke={2.2} />
      </button>
    </Tooltip>
  );
}
