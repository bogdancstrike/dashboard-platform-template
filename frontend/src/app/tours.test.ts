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
      // `path="reports/builder"` in the router, `/reports/builder` here —
      // except the five entity routes, which the router generates from an
      // array of `{ path: "projects", … }` rather than writing five times.
      // Both forms count: the claim is that the route exists, not how it was
      // spelled.
      const path = route.replace(/^\//, "");
      const declared =
        ROUTER.includes(`path="${path}"`) || ROUTER.includes(`path: "${path}"`);
      expect(declared, `${route} is not a route the router serves`).toBe(true);
    }
  });

  it("covers every page the router serves (§77)", () => {
    /**
     * The Help button was written for eleven pages, which meant it was
     * *disabled* on the other thirty-nine — and a control that works on some
     * pages and is greyed on most teaches somebody it is unreliable faster
     * than one that is missing entirely. A page added without a tour fails
     * here rather than shipping with the button greyed out.
     *
     * Not every route is a page: the error screens *are* the explanation,
     * three routes are redirects to a page that has its own tour, and `*` and
     * `:id` are patterns rather than destinations.
     */
    const EXEMPT = [
      /^\*$/,
      /:/, // `:id`, `profile/:userId` — the parent route carries the tour
      /^errors\//,
      /^search/, // redirects into `/explore`
      /^system$/, // redirects into `/admin/health`
    ];

    const declared = new Set<string>();
    for (const match of ROUTER.matchAll(/path=?:? ?"([^"]+)"/g)) declared.add(match[1]!);

    const missing = [...declared]
      .filter((path) => !EXEMPT.some((pattern) => pattern.test(path)))
      .map((path) => `/${path}`)
      .filter((route) => !(route in TOURS))
      .sort();

    expect(missing, "these routes have no tour").toEqual([]);
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
