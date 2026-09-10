import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LAYOUTS, classified, layoutOf } from "@/pages/showcase/templates";

/**
 * The page gallery is only worth having if it is complete (§61).
 *
 * The question somebody asks it is "what shapes does this template give me",
 * and a gallery missing two shapes answers that wrongly. A hand-kept list is
 * wrong by the third new page and then quietly misleads everybody who reads
 * it — so this test reads `App.tsx` itself and requires every concrete route
 * to be classified as exactly one layout.
 *
 * Reading the source rather than importing the router is deliberate: the route
 * table is JSX, and rendering it to enumerate paths would need every lazy page
 * to load.
 *
 * **It reads two syntaxes, and the first version read one.** Most routes are
 * `<Route path="…">`, but the six entity pages are declared in a data array as
 * `{ path: "tickets", … }` — so the first version of this test passed while
 * being blind to `/projects`, `/tickets`, `/customers`, `/orders` and
 * `/devices`. A completeness test that reads one syntax is a completeness test
 * that passes by not looking, which is worse than no test: it certifies the
 * hole. The count assertion below is the guard against the *next* syntax.
 */

/** Every concrete route in the router — no wildcards, no parameters. */
function routerRoutes(): string[] {
  const source = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
  const found = [
    // `<Route path="…">`
    ...[...source.matchAll(/path="([^"]+)"/g)].map((match) => match[1]!),
    // `{ path: "tickets", … }` — the entity pages, declared as data.
    ...[...source.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]!),
  ];
  return [
    ...new Set(
      found.filter(
        (route) =>
          route !== "*" &&
          // Parameterised and index routes are *within* a layout rather than
          // layouts of their own: `/tickets/:id` is the detail half of the
          // list its parent declares.
          !route.includes(":") &&
          route !== "",
      ),
    ),
  ].sort();
}

describe("the page gallery accounts for every page", () => {
  it("finds the routes in the router at all", () => {
    // If the route table is ever written differently, this is the assertion
    // that says so rather than the gallery silently going quiet.
    const routes = routerRoutes();
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain("tasks");
    expect(routes).toContain("admin/health");
    // The entity pages, which the first version of this test could not see —
    // they are declared as data rather than as JSX attributes.
    expect(routes).toContain("tickets");
    expect(routes).toContain("devices");
  });

  it("classifies every route as exactly one layout", () => {
    const routes = routerRoutes();
    const unclassified = routes.filter((route) => !layoutOf(route));
    // A page added to the router and not classified here fails this. That is
    // the whole mechanism keeping the gallery true.
    expect(unclassified).toEqual([]);
  });

  it("classifies nothing twice", () => {
    const all = LAYOUTS.flatMap((layout) => layout.routes);
    const duplicated = all.filter((route, index) => all.indexOf(route) !== index);
    // A route in two layouts would make the counts on the page wrong and the
    // question "what shape is this page" unanswerable.
    expect(duplicated).toEqual([]);
  });

  it("classifies nothing the router does not serve", () => {
    const routes = new Set(routerRoutes());
    const phantom = classified().filter((route) => !routes.has(route));
    // The other direction, and the one that rots quietly: a page removed from
    // the router leaves a gallery link that 404s.
    expect(phantom).toEqual([]);
  });
});

describe("each layout says enough to choose by", () => {
  it("says what it is, when to use it, and when not to", () => {
    for (const layout of LAYOUTS) {
      expect(layout.name, layout.key).toBeTruthy();
      expect(layout.shape.length, `${layout.key} shape`).toBeGreaterThan(20);
      expect(layout.when.length, `${layout.key} when`).toBeGreaterThan(20);
      // The half a gallery usually omits, and the half that stops somebody
      // reaching for a split view over a table.
      expect(layout.unless.length, `${layout.key} unless`).toBeGreaterThan(20);
    }
  });

  it("gives every layout at least one real page to open", () => {
    // A layout with no example is a claim rather than a demonstration.
    for (const layout of LAYOUTS) {
      expect(layout.routes.length, layout.key).toBeGreaterThan(0);
    }
  });

  it("has a stable key per layout", () => {
    const keys = LAYOUTS.map((layout) => layout.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});


describe("every layout is drawn, not only named", () => {
  /**
   * A gallery of *names* asks the reader to imagine each shape, which is the
   * one thing a layout gallery exists to save them doing. The wireframe is a
   * declaration rather than a picture so it cannot drift from the page it
   * describes — and these assert it is a *shape* rather than a decoration.
   */
  it("gives every layout a wireframe on the product's own grid", () => {
    for (const layout of LAYOUTS) {
      expect(layout.wireframe.length, layout.key).toBeGreaterThan(0);
      // Columns still occupied by a region that spans down from above. A row
      // under a two-row side panel legitimately declares only the width that
      // is left, which is what a CSS grid does and what a naive sum misses.
      let carried = 0;
      for (const row of layout.wireframe) {
        expect(row.length, layout.key).toBeGreaterThan(0);
        const width = row.reduce((sum, region) => sum + region.span, 0) + carried;
        // Twelve, because that is the grid the product is built on: a row that
        // added up to nine would draw a shape no page could have.
        expect(width, `${layout.key}: ${row.map((r) => r.label).join(" + ")}`).toBe(12);
        carried = row
          .filter((region) => (region.rows ?? 1) > 1)
          .reduce((sum, region) => sum + region.span, 0);
        for (const region of row) {
          expect(region.label.length, layout.key).toBeGreaterThan(0);
        }
      }
    }
  });

  it("says what each layout is built from, and what it keeps in the address", () => {
    for (const layout of LAYOUTS) {
      // The question after "which shape" is always "what do I need".
      expect(layout.pieces.length, layout.key).toBeGreaterThan(0);
      // And §69: every layout here is linkable, and *which* state is in the
      // URL is the decision somebody copying it has to make.
      expect(layout.url.length, layout.key).toBeGreaterThan(20);
    }
  });
});
