import { describe, expect, it } from "vitest";

import { slaStanding } from "@/entities/sla";

const NOW = new Date("2026-11-12T12:00:00Z");
const base = {
  createdAt: "2026-11-10T09:00:00Z", dueAt: "2026-11-12T18:00:00Z", firstResponseAt: null,
  resolvedAt: null, resolutionMinutes: null, breached: false,
};

describe("slaStanding with a policy (Time & decisions)", () => {
  it("counts time left in business hours when the policy gives it", () => {
    const standing = slaStanding({ ...base, businessMinutesLeft: 95, policyName: "Strategic accounts" }, NOW);
    expect(standing.minutesLeft).toBe(95);
    expect(standing.headline).toBe("Due in 1h 35m of business hours");
    expect(standing.detail).toContain("Strategic accounts");
  });

  it("says how long ago a breached ticket fell due by the wall clock, not the spent business budget", () => {
    const dueAt = new Date(NOW.valueOf() - 12 * 3_600_000).toISOString();
    const standing = slaStanding({ ...base, dueAt, breached: true, businessMinutesLeft: 0 }, NOW);
    expect(standing.headline).toBe("SLA breached");
    expect(standing.detail).toMatch(/^Due 12h ago\./);
  });

  it("says when the clock is paused", () => {
    const standing = slaStanding({ ...base, paused: true, policyName: "Standard" }, NOW);
    expect(standing.headline).toBe("Clock paused");
    expect(standing.tone).toBe("info");
  });

  it("still reports a breach over a pause", () => {
    expect(slaStanding({ ...base, paused: true, breached: true }, NOW).tone).toBe("danger");
  });

  it("falls back to the wall clock without a policy", () => {
    expect(slaStanding(base, NOW).headline).toBe("Due in 6h");
  });
});
