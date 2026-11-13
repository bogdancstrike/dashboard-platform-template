import type { DashboardWidget, WidgetKind } from "@/api/dashboards";

import { KINDS } from "../../kinds";

/** The modal's heading: the widget being configured, or which step of adding one. */
export function ModalTitle({
  widget,
  kind,
  picking,
}: {
  widget: DashboardWidget | null;
  kind: WidgetKind;
  picking: boolean;
}) {
  if (widget) return <>{`Configure ${widget.title}`}</>;
  return (
    <div className="nx-ov-modal-title">
      <span>
        Add <em>widget</em>
      </span>
      <small>
        {picking
          ? "Step 1 of 2 · what it shows"
          : `Step 2 of 2 · ${KINDS[kind].label.toLowerCase()}, and what it answers`}
      </small>
    </div>
  );
}
