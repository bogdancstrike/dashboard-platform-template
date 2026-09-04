import { describe, expect, it } from "vitest";

import { absoluteTime, parseInstant, relativeTime } from "@/lib/time";

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
