/**
 * What each chart kind needs (§28, §44).
 *
 * The value of the declaration is that a builder can refuse a picture *with a
 * reason* instead of drawing an empty one, so what is asserted here is the
 * reason — and that every kind the renderer themes has an entry, which is the
 * invariant that goes stale first.
 */

import { describe, expect, it } from "vitest";

import { CHART_SHAPES, fittingShapes, missingFor, shapeFor } from "@/components/charts/shapes";
import { buildOption } from "@/components/charts/options";
import { buildChartTheme } from "@/theme/echarts";

const draft = { dimensions: 1, measures: 1, overTime: false };

describe("what a chart kind needs", () => {
  it("has an entry for every kind the renderer can draw", () => {
    // The list a builder offers and the list `buildOption` switches on are the
    // same list; a kind in one and not the other is a picture somebody can
    // pick and nobody can paint.
    const theme = buildChartTheme("light", "comfortable");
    for (const shape of CHART_SHAPES) {
      const option = buildOption(
        { kind: shape.kind, title: shape.label, series: [{ name: "A", value: 1 }] },
        theme,
      );
      expect(option, shape.kind).toHaveProperty("series");
    }
  });

  it("names what is missing rather than answering no", () => {
    // "needs a second grouping" is actionable; "unavailable" is not (§76).
    expect(missingFor(shapeFor("heatmap")!, draft)).toBe("needs a second grouping");
    expect(missingFor(shapeFor("scatter")!, draft)).toBe("needs a second measure");
    expect(missingFor(shapeFor("line")!, draft)).toBe("needs a date grouped into a series");
  });

  it("lets a kind through as soon as the question can feed it", () => {
    expect(missingFor(shapeFor("heatmap")!, { ...draft, dimensions: 2 })).toBeNull();
    expect(missingFor(shapeFor("scatter")!, { ...draft, measures: 2 })).toBeNull();
    expect(missingFor(shapeFor("line")!, { ...draft, overTime: true })).toBeNull();
  });

  it("refuses a pie of months, which is a pie of months", () => {
    const overTime = { ...draft, overTime: true };
    expect(missingFor(shapeFor("pie")!, overTime)).toContain("reads a category");
    // A bar chart over time is legitimate — it is a column chart of periods.
    expect(missingFor(shapeFor("bar")!, overTime)).toBeNull();
  });

  it("offers the plain comparisons to the plainest possible question", () => {
    const fitting = fittingShapes(draft).map((shape) => shape.kind);

    expect(fitting).toContain("bar");
    expect(fitting).toContain("pie");
    expect(fitting).toContain("gauge");
    // And nothing that would be drawn empty.
    expect(fitting).not.toContain("heatmap");
    expect(fitting).not.toContain("scatter");
    expect(fitting).not.toContain("stacked-bar");
  });
});
