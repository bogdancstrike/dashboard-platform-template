import { describe, expect, it } from "vitest";

import { absoluteTime, groupByDay, parseInstant, relativeTime } from "@/lib/time";

const NOW = new Date("2026-09-03T12:00:00Z");

describe("relativeTime", () => {
  it("reads as freshness inside the last minute", () => {
    expect(relativeTime("2026-09-03T11:59:31Z", NOW)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeTime("2026-09-03T11:48:00Z", NOW)).toBe("12m ago");
    expect(relativeTime("2026-09-03T09:00:00Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-09-01T12:00:00Z", NOW)).toBe("2d ago");
  });

  it("falls back to a date once a week has passed", () => {
    // "34d ago" is not a timescale anybody reasons in; a date is.
    expect(relativeTime("2026-07-31T12:00:00Z", NOW)).toMatch(/2026/);
  });

  it("does not invent a future", () => {
    // Clock skew between a server and a browser is normal, and "in -3 minutes"
    // is the kind of thing that makes a reader distrust the whole feed.
    expect(relativeTime("2026-09-03T12:05:00Z", NOW)).not.toMatch(/ago/);
  });

  it("says nothing rather than NaN when there is no timestamp", () => {
    expect(relativeTime(null, NOW)).toBe("—");
    expect(relativeTime("not a date", NOW)).toBe("—");
    expect(absoluteTime(undefined)).toBe("—");
    expect(parseInstant("")).toBeNull();
  });
});

/** groupByDay's own clock, so its cases read as calendar dates. */
const THAT_MONDAY = new Date("2026-09-07T12:00:00Z");

describe("groupByDay", () => {
  const at = (iso: string) => ({ when: iso as string | null });

  it("puts a heading in wherever the day changes, and nowhere else", () => {
    const grouped = groupByDay(
      [
        // Mid-morning throughout, so the buckets do not depend on which
        // side of midnight the runner's timezone puts them.
        at("2026-09-07T11:00:00Z"),
        at("2026-09-07T09:00:00Z"),
        at("2026-09-06T09:00:00Z"),
        at("2026-09-04T09:00:00Z"),
      ],
      (item) => item.when,
      THAT_MONDAY,
    );

    expect(grouped.map((bucket) => bucket.label)).toEqual(["Today", "Yesterday", "Friday"]);
    expect(grouped.map((bucket) => bucket.items.length)).toEqual([2, 1, 1]);
  });

  it("keeps the order the server chose rather than sorting again", () => {
    // A client that re-sorted would disagree with the pagination that
    // produced the page — the second row here is *older* than the third, and
    // that is the server's business.
    const grouped = groupByDay(
      [at("2026-09-07T09:00:00Z"), at("2026-09-07T11:00:00Z")],
      (item) => item.when,
      THAT_MONDAY,
    );

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.items.map((item) => item.when)).toEqual([
      "2026-09-07T09:00:00Z",
      "2026-09-07T11:00:00Z",
    ]);
  });

  it("gives a row with no timestamp a bucket rather than dropping it", () => {
    const grouped = groupByDay([at("2026-09-07T09:00:00Z"), { when: null }], (i) => i.when, THAT_MONDAY);
    expect(grouped.map((bucket) => bucket.label)).toEqual(["Today", "Undated"]);
  });

  it("is empty for an empty list, not one empty bucket", () => {
    expect(groupByDay([], () => null, THAT_MONDAY)).toEqual([]);
  });
});
