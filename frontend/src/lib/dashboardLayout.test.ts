import { describe, expect, it } from "vitest";

import { balancedColumns, packSpans } from "./dashboardLayout";

describe("dashboard layout", () => {
  it("chooses a column count that leaves no lone tile", () => {
    expect(balancedColumns(1130, 12, 260, 4)).toBe(4);
    expect(balancedColumns(1600, 12, 260, 6)).toBe(6);
    expect(balancedColumns(800, 12, 260, 4)).toBe(3);
    expect(balancedColumns(350, 12, 160, 4)).toBe(2);
    expect(balancedColumns(1130, 7, 260, 4)).toBe(4);
    expect(balancedColumns(1130, 5, 260, 4)).toBe(3);
    expect(balancedColumns(100, 3, 260)).toBe(1);
  });

  it("widens the last cell of a run so every row is full", () => {
    expect(packSpans([false, false, false], 2)).toEqual([1, 1, 2]);
    expect(packSpans([false, true, false, false], 2)).toEqual([2, 2, 1, 1]);
    expect(packSpans([false, false, false, false], 3)).toEqual([1, 1, 1, 3]);
    expect(packSpans([false, false], 3)).toEqual([1, 2]);
    expect(packSpans([], 2)).toEqual([]);
  });
});
