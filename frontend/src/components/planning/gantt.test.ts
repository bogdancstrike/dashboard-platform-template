import { describe, expect, it } from "vitest";

import { bar } from "@/test/handlers/planning";

import {
  anchors,
  arrowPath,
  brokenBy,
  daysFor,
  dragged,
  fromDay,
  geometry,
  layout,
  shortDate,
  ticks,
  toDay,
  violates,
  visibleLinks,
  windowFor,
  ZOOMS,
} from "./gantt";

describe("the timeline's arithmetic", () => {
  it("counts whole days, both ways", () => {
    expect(fromDay(toDay("2026-09-03"))).toBe("2026-09-03");
    expect(toDay("2026-09-04") - toDay("2026-09-03")).toBe(1);
    expect(toDay("2026-09-03T23:59:00Z")).toBe(toDay("2026-09-03"));
    expect(shortDate("2026-09-03")).toBe("3 Sep");
  });

  it("opens each zoom around today", () => {
    expect(windowFor("day", "2026-09-03")).toEqual({ from: "2026-08-24", to: "2026-10-08" });
    expect(windowFor("quarter", "2026-09-03").from).toBe("2026-06-05");
  });

  it("draws a header for every zoom", () => {
    const day = ticks("2026-08-30", "2026-09-06", "day");
    expect(day.minor).toHaveLength(8);
    expect(day.minor.filter((tick) => tick.weekend)).toHaveLength(3);
    expect(day.major.map((tick) => tick.label)).toEqual(["Aug 2026", "Sep 2026"]);
    expect(ticks("2026-09-01", "2026-09-30", "week").minor.map((tick) => tick.label)).toEqual([
      "7 Sep", "14 Sep", "21 Sep", "28 Sep",
    ]);
    const month = ticks("2026-11-15", "2027-02-10", "month");
    expect(month.minor.map((tick) => tick.label)).toEqual(["Dec", "Jan", "Feb"]);
    expect(month.major.map((tick) => tick.label)).toEqual(["2026", "2027"]);
    expect(ticks("2026-01-01", "2026-12-31", "quarter").minor.map((tick) => tick.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  it("places a bar a whole number of days in, at least a day wide", () => {
    const px = ZOOMS.week.px;
    expect(geometry("2026-09-03", "2026-09-05", "2026-09-01", "week")).toEqual({ x: 2 * px, width: 3 * px });
    expect(geometry("2026-09-03", "2026-09-02", "2026-09-01", "week").width).toBe(px);
  });

  it("moves keep the length; resizes keep the other end and never go below a day", () => {
    expect(dragged("2026-09-01", "2026-09-03", "move", 2)).toEqual({ start: "2026-09-03", end: "2026-09-05" });
    expect(dragged("2026-09-01", "2026-09-03", "start", 5)).toEqual({ start: "2026-09-03", end: "2026-09-03" });
    expect(dragged("2026-09-01", "2026-09-03", "end", -5)).toEqual({ start: "2026-09-01", end: "2026-09-01" });
    expect(daysFor(ZOOMS.day.px * 2.6, "day")).toBe(3);
  });

  it("knows finish-to-start", () => {
    expect(violates("2026-09-03", "2026-09-04")).toBe(false);
    expect(violates("2026-09-03", "2026-09-03")).toBe(true);
    expect(violates("2026-09-03", "2026-09-05", 2)).toBe(true);
  });

  it("lays rows out, folding a group's bars away", () => {
    const groups = [
      { key: "g1", label: "One", code: null, color: null, start: "2026-09-01", end: "2026-09-09", progress: null, count: 2, items: [bar({ id: "a", reference: "A" }), bar({ id: "b", reference: "B" })] },
      { key: "g2", label: "Two", code: null, color: null, start: "2026-09-01", end: "2026-09-09", progress: null, count: 1, items: [bar({ id: "c", reference: "C" })] },
    ];
    expect(layout(groups, new Set(), 40).map((row) => row.y)).toEqual([0, 40, 80, 120, 160]);
    const folded = layout(groups, new Set(["g1"]), 40);
    expect(folded.map((row) => row.key)).toEqual(["g:g1", "g:g2", "c"]);
    const placed = anchors(folded, "2026-09-01", "day", 40);
    expect(placed.get("c")).toEqual({ x1: 0, x2: 4 * ZOOMS.day.px, y: 100 });
    expect(visibleLinks([{ id: "l", predecessor_id: "a", successor_id: "c", kind: "FS", lag_days: 0, violated: false }], placed)).toEqual([]);
  });

  it("draws arrows forward, and doubles back when the successor starts first", () => {
    expect(arrowPath({ x: 10, y: 20 }, { x: 100, y: 60 }, 40)).toBe("M10,20 H20 V60 H100");
    expect(arrowPath({ x: 100, y: 20 }, { x: 50, y: 60 }, 40)).toBe("M100,20 H110 V40 H40 V60 H50");
    expect(arrowPath({ x: 100, y: 60 }, { x: 50, y: 20 }, 40)).toContain("V40");
  });

  it("says which links a proposed move breaks, either side", () => {
    const bars = new Map([
      ["a", bar({ id: "a", reference: "A", start: "2026-09-01", end: "2026-09-03" })],
      ["b", bar({ id: "b", reference: "B", start: "2026-09-04", end: "2026-09-06" })],
    ]);
    const links = [{ id: "l", predecessor_id: "a", successor_id: "b", kind: "FS", lag_days: 0, violated: false }];
    expect(brokenBy("a", "2026-09-02", "2026-09-04", links, bars)).toHaveLength(1);
    expect(brokenBy("b", "2026-09-03", "2026-09-05", links, bars)).toHaveLength(1);
    expect(brokenBy("b", "2026-09-05", "2026-09-07", links, bars)).toHaveLength(0);
    expect(brokenBy("x", "2026-09-05", "2026-09-07", links, bars)).toHaveLength(0);
    expect(brokenBy("a", "2026-09-01", "2026-09-02", [{ ...links[0]!, successor_id: "gone" }], bars)).toHaveLength(0);
    expect(brokenBy("b", "2026-09-01", "2026-09-02", [{ ...links[0]!, predecessor_id: "gone" }], bars)).toHaveLength(0);
  });
});
