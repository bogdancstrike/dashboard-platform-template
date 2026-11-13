import { describe, expect, it } from "vitest";

import { age } from "@/api/approvals";
import { isVisible } from "@/api/forms";
import { target } from "@/api/sla";
import { clock, decimalHours, hours, isoDay, mondayOf, parseDuration } from "@/api/time";

describe("time arithmetic", () => {
  it("reads minutes the way people say them", () => {
    expect(hours(0)).toBe("0m");
    expect(hours(45)).toBe("45m");
    expect(hours(120)).toBe("2h");
    expect(hours(90)).toBe("1h 30m");
    expect(hours(-90)).toBe("-1h 30m");
    expect(decimalHours(0)).toBe("");
    expect(decimalHours(90)).toBe("1.5");
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(-5)).toBe("0:00:00");
  });

  it.each([
    ["", 0], ["1.5", 90], ["1,5", 90], ["1:30", 90], ["90m", 90], ["2h", 120], ["1h 15m", 75], ["abc", null], ["-1", null],
  ])("parses %s as %s minutes", (raw, minutes) => {
    expect(parseDuration(raw)).toBe(minutes);
  });

  it("finds the Monday of a week", () => {
    expect(mondayOf(new Date(2026, 10, 15))).toBe("2026-11-09");
    expect(mondayOf(new Date(2026, 10, 9))).toBe("2026-11-09");
    expect(isoDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(mondayOf()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("approvals, SLA and forms helpers", () => {
  it("says how long something has waited", () => {
    expect(age(0.2)).toBe("12m");
    expect(age(5)).toBe("5h");
    expect(age(72)).toBe("3d");
  });

  it("reads SLA targets", () => {
    expect(target(undefined)).toBe("—");
    expect(target(30)).toBe("30m");
    expect(target(90)).toBe("1h 30m");
    expect(target(120)).toBe("2h");
    expect(target(2880)).toBe("2d");
  });

  it("mirrors the server's visibility rule", () => {
    const field = { id: "b", type: "text" as const, label: "B", visible_when: { field: "a", equals: "Other" } };
    expect(isVisible({ id: "x", type: "text", label: "X" }, {})).toBe(true);
    expect(isVisible(field, { a: "Other" })).toBe(true);
    expect(isVisible(field, { a: "Billing" })).toBe(false);
    expect(isVisible(field, { a: ["Other", "x"] })).toBe(true);
    expect(isVisible({ ...field, visible_when: { field: "a", equals: "" } }, { a: "anything" })).toBe(true);
    expect(isVisible({ ...field, visible_when: { field: "a", equals: null } }, {})).toBe(false);
  });
});

describe("held record edits", async () => {
  const { heldMessage } = await import("@/components/decisions/held");
  it("says where a held edit went, and nothing otherwise", () => {
    expect(heldMessage({ pending_approval: { reference: "APR-00001", summary: "Big order" } })).toBe(
      "Sent for approval as APR-00001 — Big order. It applies once approved.",
    );
    expect(heldMessage({ pending_approval: { reference: "APR-2" } })).toContain("APR-2.");
    expect(heldMessage({ id: "x" })).toBeNull();
    expect(heldMessage(null)).toBeNull();
  });
});
