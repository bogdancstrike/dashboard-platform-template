/** The keyboard and menu moves on a dashboard's widgets, written as whole layouts. */

import { App as AntApp } from "antd";

import { type DashboardWidget, type Placement } from "@/api/dashboards";
import type { WidgetMoves } from "@/components/dashboards/WidgetCard";
import { MAX_ROWS, minimumFor } from "@/components/dashboards/grid/sizes";

export function widgetMoves({
  widgets,
  columns,
  arrange,
  dropWidget,
  modal,
  setWidgetForm,
}: {
  widgets: DashboardWidget[];
  columns: number;
  arrange: { mutate: (placements: Placement[]) => void };
  dropWidget: { mutateAsync: (widgetId: string) => Promise<unknown> };
  modal: ReturnType<typeof AntApp.useApp>["modal"];
  setWidgetForm: (next: DashboardWidget | "new" | null) => void;
}): WidgetMoves {
  /** The layout with one widget changed, sent whole (§73). */
  const rewrite = (changed: DashboardWidget) =>
    arrange.mutate(
      widgets
        .map((widget) => (widget.id === changed.id ? changed : widget))
        .map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    );

  // The keyboard half of the same moves the grid does with a pointer. Both
  // write the whole layout through one endpoint, so neither is a second
  // answer to "where is this widget" (§54).
  return {
    nudge: (widget, dx, dy) =>
      rewrite({
        ...widget,
        x: Math.max(0, Math.min(columns - widget.width, widget.x + dx)),
        y: Math.max(0, widget.y + dy),
      }),
    resize: (widget, dWidth, dHeight) => {
      const floor = minimumFor(widget.kind);
      // Never below what the kind can be drawn at. A three-column chart nudged
      // to one column is a card the server accepts and nobody can read.
      const width = Math.max(floor.w, Math.min(columns, widget.width + dWidth));
      rewrite({
        ...widget,
        width,
        // Kept inside the grid here as well as on the server: a control that
        // produces a refusal every time it is pressed at the right edge is a
        // control nobody presses twice.
        x: Math.min(widget.x, columns - width),
        height: Math.max(floor.h, Math.min(MAX_ROWS, widget.height + dHeight)),
      });
    },
    setSize: (widget, width, height) => {
      const floor = minimumFor(widget.kind);
      const wanted = Math.max(floor.w, Math.min(columns, width));
      rewrite({
        ...widget,
        width: wanted,
        x: Math.min(widget.x, columns - wanted),
        height: Math.max(floor.h, Math.min(MAX_ROWS, height)),
      });
    },
    edit: (widget) => setWidgetForm(widget),
    remove: (widget) => {
      // A block body, not an implicit return: `modal.confirm` hands back a
      // handle, and returning it from a `void` callback is a promise nobody
      // is waiting on.
      modal.confirm({
        title: `Remove ${widget.title}?`,
        content: "It comes off this dashboard. The data behind it is untouched.",
        okText: "Remove",
        okButtonProps: { danger: true },
        onOk: async () => {
          await dropWidget.mutateAsync(widget.id);
        },
      });
    },
  };
}
