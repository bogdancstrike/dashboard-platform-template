import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import { windowProblem } from "@/components/announcements/AnnouncementEditor";

/**
 * A notice's window, checked while somebody is still typing (§17).
 *
 * Asserted as a function rather than by driving a range picker: the picker's
 * keyboard handling is AntD's business, and the test that drove it took nine
 * seconds to assert one comparison. The server checks the same rule and its
 * answer is the one that counts — this one exists to catch the mistake before
 * the form is sent, which is where it costs the least.
 */
describe("an announcement's window", () => {
  const from = dayjs("2026-09-10T09:00:00Z");

  it("accepts an end after the start", () => {
    expect(windowProblem(from, from.add(1, "day"))).toBeNull();
  });

  it("refuses an end before the start", () => {
    expect(windowProblem(from, from.subtract(1, "day"))).toMatch(/cannot expire before/);
  });

  it("refuses an end equal to the start, which is a notice nobody ever sees", () => {
    expect(windowProblem(from, from)).toMatch(/cannot expire before/);
  });

  it("accepts no end at all — a policy is not a window", () => {
    expect(windowProblem(from, null)).toBeNull();
    expect(windowProblem(from, undefined)).toBeNull();
  });

  it("accepts no start either: an unscheduled draft is a legitimate state", () => {
    expect(windowProblem(null, from)).toBeNull();
    expect(windowProblem(null, null)).toBeNull();
  });
});
