import { describe, expect, it } from "vitest";

import {
  applyEdits,
  clamp,
  coerceCell,
  counts,
  displayCell,
  emptyHistory,
  humanChoice,
  inRange,
  parseClipboard,
  parseDate,
  parseNumber,
  rangeOf,
  record,
  redo,
  savable,
  toTSV,
  undo,
  type CellEdit,
  type GridColumn,
} from "./gridSheet";

const col = (partial: Partial<GridColumn>): GridColumn => ({ name: "f", label: "Field", kind: "text", editable: true, ...partial });

describe("parseClipboard", () => {
  it("reads an Excel block (TSV) with a trailing newline", () => {
    expect(parseClipboard("a\tb\tc\r\n1\t2\t3\r\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("reads CSV when there are no tabs, with quoted separators, quotes and line breaks", () => {
    expect(parseClipboard('name,notes\n"Acme, Inc","said ""hi""\nthen left"')).toEqual([
      ["name", "notes"],
      ["Acme, Inc", 'said "hi"\nthen left'],
    ]);
  });
  it("treats a single cell and an empty clipboard sensibly", () => {
    expect(parseClipboard("solo")).toEqual([["solo"]]);
    expect(parseClipboard("")).toEqual([]);
    expect(parseClipboard("\n\n")).toEqual([]);
  });
  it("keeps empty cells", () => {
    expect(parseClipboard("a\t\tc")).toEqual([["a", "", "c"]]);
  });
});

describe("toTSV", () => {
  it("round-trips cells that need quoting", () => {
    const block = [["plain", "tab\there"], ['quote "x"', "line\nbreak"]];
    expect(parseClipboard(toTSV(block))).toEqual(block);
  });
});

describe("parseNumber", () => {
  it.each([
    ["1,234.50", 1234.5], ["1.234,50", 1234.5], ["€ 1 234", 1234], ["12,5", 12.5], ["1,234", 1234],
    ["$99", 99], ["(42)", -42], ["-7", -7], ["45%", 45], [".5", 0.5],
  ])("%s → %s", (raw, value) => expect(parseNumber(raw)).toBe(value));
  it.each(["", "abc", "1.2.3x", "--1"])("refuses %j", (raw) => expect(parseNumber(raw)).toBeNull());
});

describe("parseDate", () => {
  it.each([
    ["2026-12-31", "2026-12-31"], ["2026/1/5", "2026-01-05"], ["31/12/2026", "2026-12-31"], ["5.1.2026", "2026-01-05"],
    ["2026-09-03T10:00:00Z", "2026-09-03"],
  ])("%s → %s", (raw, value) => expect(parseDate(raw)).toBe(value));
  it.each(["2026-02-30", "32/01/2026", "tomorrow", "2026-13-01"])("refuses %j", (raw) => expect(parseDate(raw)).toBeNull());
});

describe("coerceCell", () => {
  it("refuses a read-only column", () => {
    expect(coerceCell("x", col({ editable: false })).error).toMatch(/cannot be edited/);
  });
  it("empties optional cells and refuses empty required ones", () => {
    expect(coerceCell("  ", col({}))).toEqual({ value: null });
    expect(coerceCell("", col({ kind: "bool" }))).toEqual({ value: false });
    expect(coerceCell("", col({ required: true })).error).toMatch(/cannot be empty/);
  });
  it("coerces numbers within bounds", () => {
    const number = col({ kind: "number", minimum: 0, maximum: 100 });
    expect(coerceCell("€40", number)).toEqual({ value: 40 });
    expect(coerceCell("140", number).error).toMatch(/at most 100/);
    expect(coerceCell("-1", number).error).toMatch(/at least 0/);
    expect(coerceCell("lots", number).error).toMatch(/not a number/);
  });
  it("matches statuses by value or by label, case-insensitively", () => {
    const status = col({ kind: "enum", choices: ["IN_PROGRESS", "DONE"] });
    expect(coerceCell("in progress", status)).toEqual({ value: "IN_PROGRESS" });
    expect(coerceCell("done", status)).toEqual({ value: "DONE" });
    expect(coerceCell("In-Progress", status)).toEqual({ value: "IN_PROGRESS" });
    expect(coerceCell("maybe", status).error).toMatch(/not one of In progress, Done/);
    expect(coerceCell("free form", col({ kind: "enum" }))).toEqual({ value: "FREE_FORM" });
  });
  it("reads yes and no in their usual spellings", () => {
    const flag = col({ kind: "bool" });
    for (const yes of ["yes", "TRUE", "1", "x", "y"]) expect(coerceCell(yes, flag)).toEqual({ value: true });
    for (const no of ["no", "false", "0", "-", "N"]) expect(coerceCell(no, flag)).toEqual({ value: false });
    expect(coerceCell("perhaps", flag).error).toMatch(/yes or no/);
  });
  it("reads dates and refuses nonsense", () => {
    expect(coerceCell("03/09/2026", col({ kind: "datetime" }))).toEqual({ value: "2026-09-03" });
    expect(coerceCell("soon", col({ kind: "datetime" })).error).toMatch(/not a date/);
  });
  it("keeps text as typed, trimmed", () => {
    expect(coerceCell("  Acme  ", col({}))).toEqual({ value: "Acme" });
  });
});

describe("displayCell", () => {
  it("draws each kind for a cell and for the clipboard", () => {
    expect(displayCell(null, col({}))).toBe("");
    expect(displayCell(true, col({ kind: "bool" }))).toBe("Yes");
    expect(displayCell(false, col({ kind: "bool" }))).toBe("No");
    expect(displayCell("IN_PROGRESS", col({ kind: "enum" }))).toBe("In progress");
    expect(displayCell("2026-09-03T10:00:00Z", col({ kind: "datetime" }))).toBe("2026-09-03");
    expect(displayCell(12.345, col({ kind: "number" }))).toBe("12.35");
    expect(displayCell("n/a", col({ kind: "number" }))).toBe("n/a");
    expect(displayCell("Acme", col({}))).toBe("Acme");
    expect(humanChoice("MID_MARKET")).toBe("Mid market");
  });
});

describe("selection", () => {
  it("normalises a range whichever way it was dragged", () => {
    const range = rangeOf({ row: 4, col: 3 }, { row: 1, col: 0 });
    expect(range).toEqual({ top: 1, bottom: 4, left: 0, right: 3 });
    expect(inRange(range, 2, 2)).toBe(true);
    expect(inRange(range, 5, 2)).toBe(false);
    expect(clamp({ row: -2, col: 9 }, 5, 3)).toEqual({ row: 0, col: 2 });
  });
});

describe("edits and history", () => {
  const first: CellEdit[] = [
    { rowId: "r1", field: "name", before: undefined, after: { value: "A" } },
    { rowId: "r2", field: "name", before: undefined, after: { value: "x", error: "bad" } },
  ];

  it("applies forward and back, removing emptied rows", () => {
    const forward = applyEdits({}, first, "forward");
    expect(forward).toEqual({ r1: { name: { value: "A" } }, r2: { name: { value: "x", error: "bad" } } });
    expect(applyEdits(forward, first, "back")).toEqual({});
  });

  it("undoes and redoes whole steps, and a new step clears the redo stack", () => {
    let history = record(emptyHistory, first);
    expect(record(history, [])).toBe(history);
    const undone = undo(history);
    expect(undone.edits).toBe(first);
    history = undone.history;
    expect(history.past).toHaveLength(0);
    expect(history.future).toHaveLength(1);
    const redone = redo(history);
    expect(redone.edits).toBe(first);
    expect(record(undone.history, first).future).toEqual([]);
    expect(undo(emptyHistory).edits).toBeNull();
    expect(redo(emptyHistory).edits).toBeNull();
  });

  it("caps the history", () => {
    let history = emptyHistory;
    for (let i = 0; i < 5; i += 1) history = record(history, first, 3);
    expect(history.past).toHaveLength(3);
  });

  it("sends only valid changes and counts the rest", () => {
    const pending = applyEdits({}, first, "forward");
    expect(savable(pending)).toEqual([{ id: "r1", changes: { name: "A" } }]);
    expect(counts(pending)).toEqual({ cells: 2, invalid: 1, rows: 2 });
  });
});
