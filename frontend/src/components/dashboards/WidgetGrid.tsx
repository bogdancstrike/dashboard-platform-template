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
import { Grid } from "antd";
import RGL, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import type { DashboardWidget } from "@/api/dashboards";

import { GUTTER, MAX_ROWS, MINIMUM, MINIMUMS, ROW_HEIGHT } from "./grid/sizes";

const GridLayout = WidthProvider(RGL);

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

  // A phone is one column and no gestures: a twelve-column grid in 360 pixels
  // is twelve slivers, and a drag on a touch screen fights the page scroll.
  // The cards stack in reading order at the height they were saved at.
  const screens = Grid.useBreakpoint();
  const phone = screens.md === false;

  const track = (resizing: boolean) => (_all: Layout[], _old: Layout, item: Layout) =>
    setGesture({ id: item.i, w: item.w, h: item.h, resizing });

  if (phone) {
    const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
    return (
      <div className="nx-ov-stack" data-testid="widget-stack">
        {ordered.map((widget) => (
          <div
            key={widget.id}
            className="nx-ov-stack-item"
            style={{ height: widget.height * ROW_HEIGHT + (widget.height - 1) * GUTTER[1] }}
          >
            {children(widget)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <GridLayout
      className={`nu-rgl nx-ov-rgl${editable ? " is-movable" : ""}${gesture ? " is-gesturing" : ""}`}
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
