import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  agendaHeading,
  fromIsoDay,
  isoDay,
  monthGrid,
  rangeFor,
  shift,
  startOfWeek,
  titleFor,
  weekGrid,
} from "@/lib/calendarGrid";

/**
 * The calendar's date arithmetic (§19).
 *
 * Every one of these is a mistake that is invisible in a screenshot and
 * obvious to whoever misses a meeting because of it: a month grid starting on
 * the wrong weekday, a "next month" that skips February, a week whose Monday
 * is last Monday, a day parsed as UTC and shown a day early.
 */
const MARCH_2026 = new Date(2026, 2, 15); // a Sunday, mid-month

describe("weeks", () => {
  it("starts a week on Monday, whichever day is given", () => {
    // Sunday is the trap: `getDay()` calls it 0, so the naive offset sends it
    // *forward* to the next Monday instead of back six days.
    expect(isoDay(startOfWeek(new Date(2026, 2, 15)))).toBe("2026-03-09");
    expect(isoDay(startOfWeek(new Date(2026, 2, 9)))).toBe("2026-03-09");
    expect(isoDay(startOfWeek(new Date(2026, 2, 14)))).toBe("2026-03-09");
  });

  it("draws seven days, Monday to Sunday", () => {
    const days = weekGrid(MARCH_2026).map(isoDay);
    expect(days).toEqual([
      "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12",
      "2026-03-13", "2026-03-14", "2026-03-15",
    ]);
  });
});

describe("the month grid", () => {
  it("is always six weeks, so the page does not change height", () => {
    for (const month of [0, 1, 4, 7, 11]) {
      expect(monthGrid(new Date(2026, month, 1))).toHaveLength(42);
    }
  });

  it("begins on the Monday on or before the first of the month", () => {
    // 1 March 2026 is a Sunday, so the grid opens on 23 February.
    expect(isoDay(monthGrid(MARCH_2026)[0]!)).toBe("2026-02-23");
    expect(isoDay(monthGrid(MARCH_2026)[41]!)).toBe("2026-04-05");
  });

  it("holds every day of the month it is anchored in", () => {
    const days = new Set(monthGrid(MARCH_2026).map(isoDay));
    for (let day = 1; day <= 31; day += 1) {
      expect(days.has(`2026-03-${String(day).padStart(2, "0")}`)).toBe(true);
    }
  });
});

describe("stepping", () => {
  it("never skips a month, even from the 31st", () => {
    // `setMonth` on 31 January gives 2 or 3 March, which is how a "next
    // month" button loses February entirely.
    const january = new Date(2026, 0, 31);
    expect(isoDay(addMonths(january, 1))).toBe("2026-02-01");
    expect(isoDay(addMonths(january, 2))).toBe("2026-03-01");
  });

  it("steps a month view by a month and a week view by a week", () => {
    expect(isoDay(shift("month", MARCH_2026, 1))).toBe("2026-04-01");
    expect(isoDay(shift("month", MARCH_2026, -1))).toBe("2026-02-01");
    expect(isoDay(shift("week", MARCH_2026, 1))).toBe("2026-03-22");
    expect(isoDay(shift("day", MARCH_2026, -1))).toBe("2026-03-14");
  });

  it("steps an agenda by the span it shows, so nothing is skipped or repeated", () => {
    const next = shift("agenda", MARCH_2026, 1);
    const { to } = rangeFor("agenda", MARCH_2026);
    // The next agenda begins exactly where this one ended.
    expect(isoDay(next)).toBe(isoDay(to));
  });
});

describe("the window asked of the server", () => {
  it("covers the whole month grid, not just the month", () => {
    // Otherwise the leading and trailing days are empty for no reason a
    // reader can see.
    const { from, to } = rangeFor("month", MARCH_2026);
    expect(isoDay(from)).toBe("2026-02-23");
    expect(isoDay(to)).toBe("2026-04-06");
  });

  it("is half-open, so a day belongs to exactly one window", () => {
    const day = rangeFor("day", MARCH_2026);
    expect(isoDay(day.from)).toBe("2026-03-15");
    expect(isoDay(day.to)).toBe("2026-03-16");

    const week = rangeFor("week", MARCH_2026);
    // The week's end is the next week's start — not its last day.
    expect(isoDay(week.to)).toBe(isoDay(startOfWeek(addDays(week.from, 7))));
  });
});

describe("headings", () => {
  it("names the unit the view is showing", () => {
    expect(titleFor("month", MARCH_2026)).toMatch(/2026/);
    expect(titleFor("week", MARCH_2026)).toContain("–");
    expect(titleFor("day", MARCH_2026)).toMatch(/15/);
  });

  it("looks forwards, which is what an agenda does", () => {
    const now = new Date(2026, 2, 15, 11);
    // `lib/time.dayBucket` labels the past — "Yesterday", "Monday" — because a
    // feed looks backwards. An agenda needs "Tomorrow".
    expect(agendaHeading(new Date(2026, 2, 15, 9), now)).toBe("Today");
    expect(agendaHeading(new Date(2026, 2, 16, 9), now)).toBe("Tomorrow");
    expect(agendaHeading(new Date(2026, 2, 20, 9), now)).toMatch(/Friday/);
  });
});

describe("days in the address", () => {
  it("round-trips through the URL", () => {
    expect(isoDay(fromIsoDay("2026-03-10")!)).toBe("2026-03-10");
  });

  it("parses a day as local, not as UTC midnight", () => {
    // `new Date("2026-03-10")` is UTC midnight, which in any negative offset
    // is the 9th — so a calendar anchored from the address would open on the
    // wrong day for a reader in New York.
    const parsed = fromIsoDay("2026-03-10")!;
    expect(parsed.getDate()).toBe(10);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getHours()).toBe(0);
  });

  it("refuses anything that is not a day", () => {
    for (const value of ["", null, undefined, "today", "2026-3-1", "2026-03-10T09:00:00Z"]) {
      expect(fromIsoDay(value)).toBeNull();
    }
  });
});
