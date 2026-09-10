import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TOURS, tourFor } from "@/app/tours";
import { SRC, shippedSources } from "@/test/sources";

/**
 * The per-page tour (§77).
 *
 * Two ways a tour like this rots, and one assertion each.
 *
 * **It points at a page that no longer exists.** Declared routes are checked
 * against the router, the same way the layout gallery's are — a tour for
 * `/reports/builder` after that route was renamed is a Help button that
 * silently stops working on the page it was written for.
 *
 * **It points at a control that no longer exists.** Every target is a
 * `data-testid`, and every one of them must appear somewhere in the shipped
 * source. That is the whole reason targets are test ids rather than classes:
 * removing a control breaks a test rather than the tour, and the two uses keep
 * each other honest.
 */

const ROUTER = readFileSync(join(SRC, "App.tsx"), "utf8");

describe("every tour points somewhere real", () => {
  it("names a route the router serves", () => {
    for (const route of Object.keys(TOURS)) {
      // `path="reports/builder"` in the router, `/reports/builder` here.
      const path = route.replace(/^\//, "");
      expect(ROUTER, route).toContain(`path="${path}"`);
    }
  });

  it("names controls that exist in the source", () => {
    const sources = shippedSources(/\.tsx$/)
      .map((file) => file.source)
      .join("\n");

    for (const [route, stops] of Object.entries(TOURS)) {
      for (const stop of stops) {
        if (!stop.target) continue;
        expect(sources, `${route}: ${stop.target}`).toContain(`data-testid="${stop.target}"`);
      }
    }
  });

  it("gives every tour one untargeted opening stop and no more", () => {
    for (const [route, stops] of Object.entries(TOURS)) {
      const untargeted = stops.filter((stop) => !stop.target);
      // The opener describes the page as a whole; every other stop points at
      // something, or it is prose in a popover floating in the middle of the
      // screen with nothing to do with what is behind it.
      expect(untargeted.length, route).toBe(1);
      expect(stops[0]?.target, route).toBeUndefined();
    }
  });

  it("says why rather than what", () => {
    for (const [route, stops] of Object.entries(TOURS)) {
      for (const stop of stops) {
        // "This is the filter bar" is visible already. A stop is worth a press
        // only if it says something the screen does not.
        expect(stop.description.length, `${route}: ${stop.title}`).toBeGreaterThan(80);
        expect(stop.title.length, `${route}: ${stop.title}`).toBeGreaterThan(4);
      }
    }
  });
});

describe("which tour a path gets", () => {
  it("takes the longest declared route the path starts with", () => {
    // Not a shorter prefix: `/admin/health` must not be caught by `/admin`.
    expect(tourFor("/admin/health")).toBe(TOURS["/admin/health"]);
    expect(tourFor("/tasks/abc-123")).toBe(TOURS["/tasks"]);
  });

  it("answers nothing for a page with no tour, rather than the wrong one", () => {
    expect(tourFor("/nowhere")).toBeUndefined();
    // A prefix that is not a path segment is not a match either.
    expect(tourFor("/tasksomething")).toBeUndefined();
  });
});
