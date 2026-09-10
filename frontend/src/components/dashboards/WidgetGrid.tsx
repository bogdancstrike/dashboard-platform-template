/**
 * The grid a dashboard is laid out on (§45).
 *
 * `react-grid-layout` rather than a hand-rolled CSS grid, for the three things
 * a layout editor has to do and CSS cannot: drag a card to a place, drag its
 * corner to a size, and close the gap the move left behind. The third is the
 * one that matters most — a grid that lets a reader leave a hole is a grid that
 * fills up with holes.
 *
 * Four decisions worth stating.
 *
 * **The pointer is not the only way.** `react-grid-layout` is pointer-only by
 * construction, so every gesture is also a keystroke and a menu item on the
 * card itself (see `WidgetCard`). All of them write the same layout through
 * the same endpoint, so none is a second implementation of "where is this
 * widget".
 *
 * **The whole heading is the handle.** It used to be a six-pixel grip icon,
 * which is a target somebody misses and then wonders why the card will not
 * move. The header bar is the handle now — the size of a title — and the
 * controls inside it opt out through `nu-widget-nodrag`.
 *
 * **A gesture says what it is about to do.** While a card is being dragged or
 * resized it carries its size in columns and rows, the grid dims everything
 * else, and the placeholder is drawn as a target rather than a faint tint. The
 * question a person is actually asking mid-drag is "will it fit", and a grid
 * that answers it only after the drop makes them undo.
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
  ANALYTICS: { w: 3, h: 1 },
  CHART: { w: 3, h: 2 },
  LINE_CHART: { w: 3, h: 2 },
  AREA_CHART: { w: 3, h: 2 },
  BAR_CHART: { w: 3, h: 2 },
  PIE_CHART: { w: 3, h: 2 },
  HEATMAP: { w: 4, h: 2 },
  MAP: { w: 4, h: 3 },
  TABLE: { w: 4, h: 2 },
  REPORT: { w: 3, h: 2 },
  SEARCH: { w: 4, h: 2 },
  // The modules are rows of text. Narrower than this and every line ellipses
  // to three words, which is a card that costs space and answers nothing.
  TASKS: { w: 3, h: 2 },
  PROJECTS: { w: 3, h: 2 },
  MAIL: { w: 3, h: 2 },
  FILES: { w: 3, h: 2 },
  NOTIFICATIONS: { w: 3, h: 2 },
  ANNOUNCEMENTS: { w: 3, h: 2 },
  EXPLORER: { w: 3, h: 2 },
  RELATIONSHIPS: { w: 3, h: 2 },
  FAVORITES: { w: 2, h: 2 },
  CALENDAR: { w: 3, h: 2 },
};

const MINIMUM = { w: 2, h: 1 };

/** The tallest a widget may be. Matches `MAX_HEIGHT` on the server. */
export const MAX_ROWS = 8;

/** What the grid reports while a gesture is in flight, for the size chip. */
interface Gesture {
  id: string;
  w: number;
  h: number;
  /** Resizing rather than moving — the chip reads differently for each. */
  resizing: boolean;
}

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
          maxH: MAX_ROWS,
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

  /** The card under the pointer right now, and how big it currently is. */
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const commit = (next: Layout[]) => {
    setGesture(null);
    if (!editable) return;
    onCommit(
      next.map((item) => ({ id: item.i, x: item.x, y: item.y, width: item.w, height: item.h })),
    );
  };

  const track = (resizing: boolean) => (_all: Layout[], _old: Layout, item: Layout) =>
    setGesture({ id: item.i, w: item.w, h: item.h, resizing });

  return (
    <GridLayout
      className={`nu-rgl${gesture ? " is-gesturing" : ""}`}
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
      // A card cannot be dragged off the left or right of the grid. Without it
      // the drop is silently clamped, and a card that lands somewhere other
      // than where it was released reads as a bug in the drag.
      isBounded
      useCSSTransforms
      // Four handles rather than one. A corner is a precise target and the
      // edges are forgiving ones — widening a card is the commonest resize
      // there is, and asking for the south-east corner to do it makes people
      // aim at eight pixels.
      resizeHandles={["se", "sw", "e", "s"]}
      // The whole heading, not a grip glyph: a handle the size of a title is a
      // handle nobody misses. Controls inside it opt out by class.
      draggableHandle=".ant-card-head"
      draggableCancel=".nu-widget-nodrag"
      onLayoutChange={setLayout}
      onDrag={track(false)}
      onResize={track(true)}
      onDragStop={commit}
      onResizeStop={commit}
    >
      {layout.map((item) => {
        const widget = widgets.find((candidate) => candidate.id === item.i);
        if (!widget) return <div key={item.i} />;
        const active = gesture?.id === widget.id ? gesture : null;
        return (
          <div key={widget.id} className={active ? "is-active" : undefined}>
            {children(widget)}
            {active && (
              // What the card will be if the gesture ends here. The question
              // somebody is asking mid-drag is "will it fit next to that one",
              // and columns × rows is the vocabulary the rest of the editor
              // uses — the menu says "Wider", the server says "12 columns".
              <span className="nu-widget-size" aria-hidden>
                {active.w} × {active.h}
              </span>
            )}
          </div>
        );
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

/**
 * The sizes a widget can be set to in one press.
 *
 * Dragging a corner is how somebody arrives at *a* size; these are how they
 * arrive at the size they meant. "Half width" beside another half-width card
 * is the commonest layout on any dashboard, and reaching it by dragging until
 * the number reads six is worse than pressing "Half".
 *
 * Widths are fractions of the grid so they stay right whatever the column
 * count is, and each is clamped to the kind's own minimum by the caller.
 */
export const SIZE_PRESETS: { key: string; label: string; fraction: number; rows: number }[] = [
  { key: "quarter", label: "Quarter width", fraction: 1 / 4, rows: 2 },
  { key: "third", label: "A third", fraction: 1 / 3, rows: 2 },
  { key: "half", label: "Half width", fraction: 1 / 2, rows: 2 },
  { key: "full", label: "Full width", fraction: 1, rows: 3 },
];

/** The smallest this kind may be drawn, for a caller clamping a preset. */
export function minimumFor(kind: DashboardWidget["kind"]): { w: number; h: number } {
  return MINIMUMS[kind] ?? MINIMUM;
}
