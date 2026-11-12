import { describe, expect, it } from "vitest";

import { ago, latency, niceCeiling, shortRange, shortWhen } from "./when";

const now = new Date(2026, 10, 12, 19, 30);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

describe("short moments for the health cards", () => {
  it("names the day and keeps the clock", () => {
    expect(shortWhen(at(12, 2, 55), now)).toBe("Today 02:55");
    expect(shortWhen(at(11, 18, 55), now)).toBe("Yesterday 18:55");
  });

  it("writes a range inside one day once, and across midnight in full", () => {
    expect(shortRange(at(12, 2, 55), at(12, 3, 55), now)).toBe("Today 02:55–03:55");
    expect(shortRange(at(11, 23, 10), at(12, 1, 40), now)).toBe("Yesterday 23:10 – Today 01:40");
    expect(shortRange(at(12, 4), at(12, 4), now)).toBe("Today 04:00");
  });

  it("says how long ago, never a bare date", () => {
    expect(ago(new Date(now.valueOf() - 2 * 60_000).toISOString(), now)).toBe("2 min ago");
    expect(ago(at(12, 14), now)).toBe("5 h ago");
    expect(ago(at(9, 12), now)).toBe("3 days ago");
    expect(ago(new Date(2026, 8, 10).toISOString(), now)).toBe("2 months ago");
    expect(ago(null, now)).toBe("—");
  });

  it("keeps latency short and axes round", () => {
    expect(latency(212.4)).toBe("212 ms");
    expect(latency(1430)).toBe("1.4 s");
    expect(niceCeiling(47)).toBe(50);
    expect(niceCeiling(812)).toBe(1000);
    expect(niceCeiling(1430)).toBe(1500);
  });
});
