import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_FORMATS,
  applyFormats,
  currentFormats,
  formatDate,
  formatDateTime,
  formatNumber,
  formatSample,
  formatTime,
} from "@/lib/formats";
import { asText } from "@/lib/text";

/**
 * The reader's own date, time and number formats (§40).
 *
 * Every rendered value goes through these — a table cell, a chart axis, an
 * audit row, a CSV heading — and they were the one part of §40 with no test.
 * The module keeps deliberate shared mutable state with two rules, and both
 * are asserted here: one writer, and a working default before that writer has
 * run, so a value rendered during the first paint is correct rather than
 * blank.
 *
 * The patterns are checked against a *fixed* instant rather than "now",
 * because a formatter test that builds its expectation the same way the
 * formatter does asserts nothing at all.
 */

// A Wednesday afternoon: two-digit day and month, and an hour that tells 24h
// from 12h at a glance.
const MOMENT = new Date(2026, 8, 6, 15, 42, 8);

afterEach(() => {
  // The state is module-level, so a test that changed it owes the next one a
  // reset — which is the cost of the choice the module documents.
  applyFormats(DEFAULT_FORMATS);
});

describe("the defaults", () => {
  it("are ISO and 24-hour, before any profile has answered", () => {
    // Unambiguous and sortable, and correct for a first paint that happens
    // before `/api/me` returns.
    expect(currentFormats()).toEqual({
      date: "YYYY-MM-DD",
      time: "24h",
      number: "1,234.56",
    });
    expect(formatDate(MOMENT)).toBe("2026-09-06");
    expect(formatTime(MOMENT)).toBe("15:42");
  });
});

describe("a chosen date pattern", () => {
  it.each([
    ["YYYY-MM-DD", "2026-09-06"],
    ["DD/MM/YYYY", "06/09/2026"],
    ["MM/DD/YYYY", "09/06/2026"],
  ] as const)("renders %s as %s", (pattern, expected) => {
    applyFormats({ date: pattern });
    expect(formatDate(MOMENT)).toBe(expected);
  });

  it("is the same pattern in a timestamp", () => {
    applyFormats({ date: "DD/MM/YYYY" });
    // The date half of a timestamp cannot disagree with the date column beside
    // it — which is the reason both read the same setting rather than each
    // formatting for itself.
    expect(formatDateTime(MOMENT)).toBe("06/09/2026 15:42:08");
  });
});

describe("a chosen clock", () => {
  it("does not change shape when the date pattern changes", () => {
    // Two independent choices: the clock used to borrow the date pattern's
    // locale, so `YYYY-MM-DD` gave "03:42 p.m." and `MM/DD/YYYY` gave
    // "03:42 PM" for the same 12-hour setting.
    applyFormats({ time: "12h", date: "YYYY-MM-DD" });
    const iso = formatTime(MOMENT);
    applyFormats({ date: "MM/DD/YYYY" });
    expect(formatTime(MOMENT)).toBe(iso);
  });

  it("renders 24-hour or 12-hour", () => {
    applyFormats({ time: "24h" });
    expect(formatTime(MOMENT)).toBe("15:42");

    applyFormats({ time: "12h" });
    // The exact space before the meridiem is `Intl`'s business and varies by
    // engine, so the assertion is on what a reader would check.
    // The clock's own locale, so this reads the same whichever date pattern
    // is set — which it did not before.
    expect(formatTime(MOMENT)).toMatch(/^03:42\s?PM$/);
  });

  it("reaches the seconds a timestamp carries", () => {
    applyFormats({ time: "12h" });
    expect(formatDateTime(MOMENT)).toMatch(/03:42:08\s?PM$/);
  });
});

describe("a chosen number pattern", () => {
  it("groups and separates the way the reader asked", () => {
    applyFormats({ number: "1,234.56" });
    expect(formatNumber(1234.56, { minimumFractionDigits: 2 })).toBe("1,234.56");

    applyFormats({ number: "1 234,56" });
    // A comma decimal and a space group — the convention half of Europe uses,
    // and the one that makes "1,234" mean 1.234 to the reader.
    expect(formatNumber(1234.56, { minimumFractionDigits: 2 })).toMatch(/^1\s234,56$/);
  });

  it("passes the caller's options through, so a currency is still a currency", () => {
    applyFormats({ number: "1,234.56" });
    expect(formatNumber(1234.5, { style: "currency", currency: "EUR" })).toBe("€1,234.50");
  });

  it("does not lose a large number to its own grouping", () => {
    applyFormats({ number: "1,234.56" });
    expect(formatNumber(38137905.7, { maximumFractionDigits: 0 })).toBe("38,137,906");
  });
});

describe("the worked example the preferences page shows", () => {
  it("renders the settings it is given rather than the active ones", () => {
    // The page previews a choice *before* it is saved, so the sample must not
    // read the module's state — a preview of what is already applied tells
    // somebody nothing about the option they are hovering.
    const sample = formatSample({ date: "MM/DD/YYYY", time: "12h", number: "1 234,56" });

    expect(sample.date).toBe("09/06/2026");
    expect(sample.time).toMatch(/^03:42\s?PM$/);
    expect(sample.number).toMatch(/^1\s234,56$/);
    // And the active settings are untouched by having previewed one.
    expect(currentFormats()).toEqual(DEFAULT_FORMATS);
  });

  it("falls back to the active settings when given none", () => {
    applyFormats({ date: "DD/MM/YYYY" });
    expect(formatSample().date).toBe("06/09/2026");
  });
});

describe("applyFormats", () => {
  it("merges rather than replaces, so one setting can change alone", () => {
    applyFormats({ time: "12h" });
    applyFormats({ number: "1 234,56" });

    expect(currentFormats()).toEqual({
      date: "YYYY-MM-DD",
      time: "12h",
      number: "1 234,56",
    });
  });
});

describe("asText", () => {
  it("renders every value a cell can hold, and never the word undefined", () => {
    // This is what a table cell, a CSV column and an export heading all call:
    // "undefined" printed into a spreadsheet is a value somebody then filters
    // by.
    expect(asText(null)).toBe("");
    expect(asText(undefined)).toBe("");
    expect(asText("already text")).toBe("already text");
    expect(asText(0)).toBe("0");
    expect(asText(false)).toBe("false");
    expect(asText(new Date(Date.UTC(2026, 8, 6)))).toBe("2026-09-06T00:00:00.000Z");
    expect(asText({ a: 1 })).toBe('{"a":1}');
    expect(asText(["x", "y"])).toBe('["x","y"]');
  });

  it("survives a structure JSON cannot render", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    // Not reachable from an API response, and reachable from a caller — and a
    // formatter that throws takes the whole table with it.
    expect(asText(circular)).toBe("");
  });
});
