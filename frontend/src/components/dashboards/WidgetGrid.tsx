/**
 * The grid a dashboard is laid out on (§45).
 *
 * `react-grid-layout` rather than a hand-rolled CSS grid, for the three things
 * a layout editor has to do and CSS cannot: drag a card to a place, drag its
 * corner to a size, and close the gap the move left behind. The third is the
 * one that matters most — a grid that lets a reader leave a hole is a grid that
 * fills up with holes.
 *
 * Two decisions worth stating.
 *
 * **The pointer is not the only way.** `react-grid-layout` is pointer-only by
 * construction, so every gesture is also a menu item on the card itself (see
 * `WidgetCard`). Both paths write the same layout through the same endpoint, so
 * neither is a second implementation of "where is this widget".
 *
 * **The layout is committed when the gesture ends, not while it is happening.**
 * A drag fires a layout change on every frame; saving those would be forty
 * writes and a server deciding what a half-finished drag means. `onDragStop`
 * and `onResizeStop` are the two moments a reader has actually chosen
 * something.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import RGL, { WidthProvider, type Layout } from "react-grid-layout";

import type { DashboardWidget } from "@/api/dashboards";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const GridLayout = WidthProvider(RGL);

/** One grid row, in pixels. Small enough that a KPI tile is one row. */
const ROW_HEIGHT = 96;
const GUTTER: [number, number] = [12, 12];

/** The smallest a widget may be, per kind — a chart in one column is a line. */
const MINIMUMS: Partial<Record<DashboardWidget["kind"], { w: number; h: number }>> = {
  KPI: { w: 2, h: 1 },
  GAUGE: { w: 2, h: 2 },
  LINE_CHART: { w: 3, h: 2 },
  AREA_CHART: { w: 3, h: 2 },
  BAR_CHART: { w: 3, h: 2 },
  PIE_CHART: { w: 3, h: 2 },
  HEATMAP: { w: 4, h: 2 },
  TABLE: { w: 4, h: 2 },
  REPORT: { w: 3, h: 2 },
  SEARCH: { w: 4, h: 2 },
};

const MINIMUM = { w: 2, h: 1 };

export function WidgetGrid({
  widgets,
  columns,
  editable,
  onCommit,
  children,
}: {
  widgets: DashboardWidget[];
  columns: number;
  editable: boolean;
  /** The whole layout, once a drag or a resize has finished. */
  onCommit: (placements: { id: string; x: number; y: number; width: number; height: number }[]) => void;
  children: (widget: DashboardWidget) => ReactNode;
}) {
  const stored = useMemo<Layout[]>(
    () =>
      widgets.map((widget) => {
        const minimum = MINIMUMS[widget.kind] ?? MINIMUM;
        return {
          i: widget.id,
          x: widget.x,
          y: widget.y,
          w: widget.width,
          h: widget.height,
          minW: minimum.w,
          minH: minimum.h,
          // In reading mode nothing moves, which is also what stops a stray
          // click on a chart from nudging the card under it.
          static: !editable,
        };
      }),
    [widgets, editable],
  );

  // Local while a gesture is in flight, so the card follows the pointer; reset
  // from the server's answer whenever that arrives, which is what makes a
  // refused move snap back rather than stick (§73).
  const [layout, setLayout] = useState<Layout[]>(stored);
  useEffect(() => setLayout(stored), [stored]);

  const commit = (next: Layout[]) => {
    if (!editable) return;
    onCommit(
      next.map((item) => ({ id: item.i, x: item.x, y: item.y, width: item.w, height: item.h })),
    );
  };

  return (
    <GridLayout
      className="nu-rgl"
      layout={layout}
      cols={columns}
      rowHeight={ROW_HEIGHT}
      margin={GUTTER}
      width={1200}
      isDraggable={editable}
      isResizable={editable}
      // Vertical compaction is the auto-arrange: a widget dragged out of a row
      // does not leave a hole behind it, and one dropped into a full row pushes
      // the rest down rather than landing on top of them.
      compactType="vertical"
      preventCollision={false}
      useCSSTransforms
      resizeHandles={["se"]}
      // Dragged by its heading, so the controls inside a widget — a chart's
      // tooltip, a list's links — still work.
      draggableHandle=".nu-widget-grip"
      draggableCancel=".nu-widget-nodrag"
      onLayoutChange={setLayout}
      onDragStop={commit}
      onResizeStop={commit}
    >
      {layout.map((item) => {
        const widget = widgets.find((candidate) => candidate.id === item.i);
        if (!widget) return <div key={item.i} />;
        return <div key={widget.id}>{children(widget)}</div>;
      })}
    </GridLayout>
  );
}

/**
 * The layout with every gap closed, top to bottom.
 *
 * The same rule `compactType="vertical"` applies during a drag, applied on
 * demand — because a dashboard that has been edited for a while accumulates
 * holes, and "tidy up" is a thing a person wants to press rather than a thing
 * they want to achieve by dragging every card.
 */
export function compacted(
  widgets: DashboardWidget[],
  columns: number,
): { id: string; x: number; y: number; width: number; height: number }[] {
  // The bottom of each column so far. A widget drops to the lowest row where
  // every column it spans is free, which is exactly what vertical compaction
  // means and is stable for a given reading order.
  const floor = new Array<number>(columns).fill(0);
  const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);

  const placed = ordered.map((widget) => {
    const width = Math.min(widget.width, columns);
    const x = Math.min(widget.x, columns - width);
    const y = Math.max(...floor.slice(x, x + width), 0);
    for (let column = x; column < x + width; column += 1) floor[column] = y + widget.height;
    return { id: widget.id, x, y, width, height: widget.height };
  });

  // Returned in reading order, because the server stores the array index as
  // each widget's `position` — and that is the order the one-column phone
  // layout falls back to. Sorting the *result* is also what makes tidying
  // idempotent: the geometry settles on the first pass, and without this the
  // array order kept shuffling underneath it.
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}
