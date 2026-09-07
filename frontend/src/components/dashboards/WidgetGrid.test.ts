/**
 * Closing the gaps in a dashboard layout (§45).
 *
 * Pure arithmetic over a set of placements, which is exactly the level that
 * can catch it: the cases that matter are a hole above a widget, two widgets
 * competing for one row, and one wider than the grid — and each is one
 * assertion rather than a dragged card somebody has to watch.
 */

import { describe, expect, it } from "vitest";

import { compacted } from "@/components/dashboards/WidgetGrid";
import type { DashboardWidget } from "@/api/dashboards";

function widget(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): DashboardWidget {
  return {
    id,
    kind: "KPI",
    title: id,
    subtitle: null,
    x,
    y,
    width,
    height,
    position: 0,
    config: {},
  };
}

describe("tidying a layout", () => {
  it("lifts a widget into the gap above it", () => {
    // A hole is what a reader leaves behind when they drag a card away, and a
    // dashboard edited for a while is mostly holes.
    const tidy = compacted([widget("a", 0, 0, 3, 1), widget("b", 0, 4, 3, 1)], 12);
    expect(tidy).toEqual([
      { id: "a", x: 0, y: 0, width: 3, height: 1 },
      { id: "b", x: 0, y: 1, width: 3, height: 1 },
    ]);
  });

  it("keeps widgets side by side when they do not overlap", () => {
    const tidy = compacted([widget("a", 0, 2, 6, 2), widget("b", 6, 2, 6, 2)], 12);
    expect(tidy.map((item) => [item.x, item.y])).toEqual([
      [0, 0],
      [6, 0],
    ]);
  });

  it("drops a widget below the tallest column it spans", () => {
    // Spanning two columns of different depths, it clears both — landing on
    // top of one of them is what "no collisions" has to mean.
    const tidy = compacted(
      [widget("tall", 0, 0, 3, 3), widget("short", 3, 0, 3, 1), widget("wide", 0, 5, 6, 1)],
      12,
    );
    expect(tidy.find((item) => item.id === "wide")).toEqual({
      id: "wide",
      x: 0,
      y: 3,
      width: 6,
      height: 1,
    });
  });

  it("pulls a widget that hangs off the right back inside the grid", () => {
    const tidy = compacted([widget("a", 10, 0, 6, 1)], 12);
    expect(tidy[0]).toEqual({ id: "a", x: 6, y: 0, width: 6, height: 1 });
  });

  it("narrows a widget wider than the grid rather than losing it", () => {
    const tidy = compacted([widget("a", 0, 0, 20, 1)], 12);
    expect(tidy[0]).toEqual({ id: "a", x: 0, y: 0, width: 12, height: 1 });
  });

  it("settles, and returns the layout in reading order", () => {
    // Tidying twice gives the same answer, which is what makes it a button
    // rather than a surprise — and the order it comes back in is the order it
    // reads, because the server stores the index as each widget's position.
    const rows = [widget("c", 6, 3, 6, 1), widget("a", 0, 0, 6, 1), widget("b", 0, 3, 6, 1)];
    const once = compacted(rows, 12);
    const twice = compacted(
      once.map((item) => widget(item.id, item.x, item.y, item.width, item.height)),
      12,
    );

    expect(twice).toEqual(once);
    // `a` fills the left of row 0, so `c` rises to sit beside it and `b`
    // takes the row beneath — top to bottom, then left to right.
    expect(once.map((item) => [item.id, item.x, item.y])).toEqual([
      ["a", 0, 0],
      ["c", 6, 0],
      ["b", 0, 1],
    ]);
  });
});
