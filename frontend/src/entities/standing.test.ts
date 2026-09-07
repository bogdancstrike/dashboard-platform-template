/**
 * The two questions the project and ticket pages exist to answer (§8, §48).
 *
 * Both are pure arithmetic over a record and a clock, which is exactly the
 * level that can catch them: the cases that matter are boundaries — a project
 * with no budget, one already closed, a ticket resolved after its deadline,
 * one nobody has answered — and each is one assertion rather than a rendered
 * page somebody has to read.
 */

import { describe, expect, it } from "vitest";

import { behindOn, projectStanding } from "@/entities/delivery";
import { duration, slaStanding } from "@/entities/sla";

const NOW = new Date("2026-09-07T12:00:00Z");

describe("where a project stands", () => {
  const halfway = {
    startDate: "2026-08-08T12:00:00Z",
    dueDate: "2026-10-07T12:00:00Z",
    completedAt: null,
    budget: 100_000,
    spent: 50_000,
    progress: 50,
  };

  it("reads the gaps between the numbers, not the numbers", () => {
    const standing = projectStanding(halfway, NOW);

    expect(standing.elapsed).toBe(50);
    expect(standing.burn).toBe(50);
    expect(standing.scheduleGap).toBe(0);
    expect(standing.budgetGap).toBe(0);
    expect(standing.standing).toBe("even");
  });

  it("calls a project behind when the money is ahead of the work", () => {
    // The finding this page exists for: "on track" at 85% of the budget.
    const standing = projectStanding({ ...halfway, spent: 85_000 }, NOW);

    expect(standing.budgetGap).toBe(35);
    expect(standing.standing).toBe("behind");
    expect(standing.summary).toContain("85% of the budget spent");
    expect(standing.summary).toContain("running behind");
  });

  it("does not cry wolf over a couple of points", () => {
    expect(projectStanding({ ...halfway, progress: 45 }, NOW).standing).toBe("even");
  });

  it("says how many days are left, and how many are past", () => {
    expect(projectStanding(halfway, NOW).daysLeft).toBe(30);
    expect(
      projectStanding({ ...halfway, dueDate: "2026-09-01T12:00:00Z" }, NOW).daysLeft,
    ).toBe(-6);
  });

  it("computes what it can when a project has no budget or no dates", () => {
    const noBudget = projectStanding({ ...halfway, budget: 0, spent: 0 }, NOW);
    expect(noBudget.burn).toBeNull();
    expect(noBudget.budgetGap).toBeNull();
    // A missing half must not drag the verdict: the schedule still decides.
    expect(noBudget.standing).toBe("even");

    const noDates = projectStanding(
      { ...halfway, startDate: null, dueDate: null }, NOW,
    );
    expect(noDates.elapsed).toBeNull();
    expect(noDates.daysLeft).toBeNull();
  });

  it("says which of the two gaps put a project behind", () => {
    // A portfolio in which every row says "Behind" has a column that carries
    // no information. Which gap it is decides who the conversation is with.
    const money = projectStanding({ ...halfway, spent: 85_000 }, NOW);
    expect(behindOn(money)).toBe("money");

    const time = projectStanding({ ...halfway, progress: 20 }, NOW);
    expect(behindOn(time)).toBe("both");

    const scheduleOnly = projectStanding(
      { ...halfway, budget: null, spent: null, progress: 20 },
      NOW,
    );
    expect(behindOn(scheduleOnly)).toBe("schedule");

    // And nothing at all when it is not behind: the qualifier is not a label
    // for every state, it is the reason for one of them.
    expect(behindOn(projectStanding(halfway, NOW))).toBeNull();
  });

  it("stops judging a project that is finished", () => {
    const closed = projectStanding(
      { ...halfway, completedAt: "2026-09-01T00:00:00Z", spent: 200_000 }, NOW,
    );
    expect(closed.standing).toBe("done");
    expect(closed.summary).toBe("Delivered and closed.");
  });
});

describe("where a ticket stands against its clock", () => {
  const open = {
    createdAt: "2026-09-07T09:00:00Z",
    dueAt: "2026-09-09T09:00:00Z",
    firstResponseAt: "2026-09-07T09:30:00Z",
    resolvedAt: null,
    resolutionMinutes: null,
    breached: false,
  };

  it("counts down to the deadline and says who answered when", () => {
    const standing = slaStanding(open, NOW);

    expect(standing.headline).toBe("Due in 1d 21h");
    expect(standing.responseMinutes).toBe(30);
    expect(standing.tone).toBe("info");
    expect(standing.detail).toBe("First answered after 30m.");
  });

  it("turns urgent inside a day rather than at the deadline", () => {
    const standing = slaStanding({ ...open, dueAt: "2026-09-07T17:00:00Z" }, NOW);
    expect(standing.tone).toBe("warning");
    expect(standing.headline).toBe("Due in 5h");
  });

  it("says a breach is a breach and how long ago it was due", () => {
    const standing = slaStanding(
      { ...open, dueAt: "2026-09-06T12:00:00Z", breached: true }, NOW,
    );
    expect(standing.tone).toBe("danger");
    expect(standing.headline).toBe("SLA breached");
    expect(standing.detail).toContain("Due 1d ago");
  });

  it("does not congratulate a ticket that was resolved late", () => {
    const standing = slaStanding(
      { ...open, resolvedAt: "2026-09-07T11:00:00Z", breached: true }, NOW,
    );
    expect(standing.headline).toBe("Resolved late");
    expect(standing.tone).toBe("warning");
    expect(standing.resolutionMinutes).toBe(120);
  });

  it("prefers the resolution the server recorded over its own subtraction", () => {
    // The server's figure is what every report already counted; recomputing it
    // here would give the page a second, quieter answer.
    const standing = slaStanding(
      { ...open, resolvedAt: "2026-09-07T11:00:00Z", resolutionMinutes: 95 }, NOW,
    );
    expect(standing.resolutionMinutes).toBe(95);
  });

  it("says plainly when nobody has answered, and when there is no promise", () => {
    expect(slaStanding({ ...open, firstResponseAt: null }, NOW).detail).toBe(
      "Nobody has answered it yet.",
    );
    expect(slaStanding({ ...open, dueAt: null }, NOW).headline).toBe("No deadline");
  });
});

describe("durations read the way people say them", () => {
  it.each([
    [45, "45m"],
    [60, "1h"],
    [95, "1h 35m"],
    [1440, "1d"],
    [2700, "1d 21h"],
  ])("%i minutes is %s", (minutes, expected) => {
    expect(duration(minutes)).toBe(expected);
  });
});
