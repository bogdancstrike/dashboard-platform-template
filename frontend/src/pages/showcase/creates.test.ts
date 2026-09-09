import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CREATE_FLOWS,
  CREATE_SHAPES,
  flowsOf,
  type CreateShape,
} from "@/pages/showcase/creates";
import { SRC, shippedSources } from "@/test/sources";

/**
 * Creates open in the shape their decision deserves (§10, §33).
 *
 * The tracker asked for "variety in how create opens — a wizard where the
 * decision has parts, a drawer for one object's fields, a plain modal for one
 * question", and variety is not a thing a screenshot can demonstrate: it is a
 * claim about twenty-odd flows, and the way it goes wrong is that the
 * twenty-first copies whichever one was nearest.
 *
 * So the shapes and the classification are declared (`creates.ts`) and this
 * asserts the declaration against the code:
 *
 * * every shape is **actually used** — a gallery of five shapes where two are
 *   theoretical is a gallery that misleads;
 * * every entry's implementation **contains the component its shape implies**,
 *   so an entry that says "modal" and opens a drawer fails;
 * * every "new something" control in the shipped sources is **classified**,
 *   which is what makes the next create a decision rather than a copy.
 *
 * Two of these found something. The folder and the lane were built with
 * `modal.confirm` and an uncontrolled input — the right shape with three
 * defects each: Enter did nothing, an empty name created nothing and said
 * nothing, and a name of spaces was accepted. They share `NameModal` now.
 */

const source = (path: string) => readFileSync(`${SRC}/${path}`, "utf8");

describe("the shapes a create can open in", () => {
  it("says when each is right and when it is not", () => {
    // `unless` is the half a pattern library usually omits, and the half that
    // stops the most impressive shape becoming the default.
    for (const shape of CREATE_SHAPES) {
      expect(shape.when.length, shape.key).toBeGreaterThan(20);
      expect(shape.unless.length, shape.key).toBeGreaterThan(20);
    }
  });

  it("is used, every one of them", () => {
    for (const shape of CREATE_SHAPES) {
      expect(flowsOf(shape.key).length, shape.key).toBeGreaterThan(0);
    }
  });

  it("classifies every flow under a shape that exists", () => {
    const declared = new Set(CREATE_SHAPES.map((shape) => shape.key));
    for (const flow of CREATE_FLOWS) {
      expect(declared.has(flow.shape), `${flow.what}: ${flow.shape}`).toBe(true);
      // The reason is the point of the entry: "because it is a modal" is not
      // a reason, and 40 characters is about the length of one.
      expect(flow.because.length, flow.what).toBeGreaterThan(40);
    }
  });
});

describe("what each flow actually opens", () => {
  it("opens a module that exists", () => {
    for (const flow of CREATE_FLOWS) {
      expect(() => source(flow.opens), flow.what).not.toThrow();
    }
  });

  /**
   * The component a shape is built on, as the declaration promises.
   *
   * Deliberately the *rendered* element and not the import: a page that
   * imports `Modal` for a delete confirmation and opens its create in a
   * drawer would pass an import check while the document lied.
   */
  const EXPECTED: Record<CreateShape, RegExp> = {
    // Typed where the row will be, and submitted from the keyboard.
    "in place": /onPressEnter/,
    modal: /<Modal|<NameModal/,
    drawer: /<Drawer/,
    wizard: /<Steps/,
    // A page's proof is that the router serves it, which the layout gallery
    // already asserts route by route; here it is that the module is the one
    // the router lazily loads.
    page: /export default function/,
  };

  it("is built on the component its shape implies", () => {
    const router = source("App.tsx");
    for (const flow of CREATE_FLOWS) {
      const text = source(flow.opens);
      expect(EXPECTED[flow.shape].test(text), `${flow.what} (${flow.shape}) in ${flow.opens}`).toBe(
        true,
      );
      if (flow.shape === "page") {
        // The whole point of this shape is that it has an address.
        expect(router, flow.what).toContain(flow.opens.replace(/\.tsx$/, ""));
        expect(router, flow.what).toContain(`path="${flow.where}"`);
      }
    }
  });

  it("names controls that are really there", () => {
    // A renamed button is a stale document, and the document is rendered in
    // the product — so the id is asserted rather than trusted.
    const everything = shippedSources()
      .map((file) => readFileSync(file.path, "utf8"))
      .join("\n");
    for (const flow of CREATE_FLOWS) {
      if (!flow.testId) continue;
      expect(everything, flow.what).toContain(`data-testid="${flow.testId}"`);
    }
  });
});

describe("nothing creates anything unclassified", () => {
  it("accounts for every new-something control in the product", () => {
    // The assertion that keeps the rest true: a page that grows a create
    // button has to decide which shape it is, because this fails otherwise.
    const found = new Set<string>();
    for (const file of shippedSources()) {
      const text = readFileSync(file.path, "utf8");
      for (const match of text.matchAll(/data-testid="([^"]*\bnew[^"]*)"/g)) {
        found.add(match[1]!);
      }
      for (const match of text.matchAll(/data-testid="(new-[^"]*|[^"]*-new)"/g)) {
        found.add(match[1]!);
      }
    }
    // Ids that are not a create control: the drawer a create opens *into*,
    // and the gallery tile that opens the same modal as `new-board`.
    const NOT_A_CONTROL = new Set(["new-export-drawer", "gallery-new"]);
    const classified = new Set(
      CREATE_FLOWS.map((flow) => flow.testId).filter((id): id is string => Boolean(id)),
    );

    const unclassified = [...found].filter(
      (id) => !classified.has(id) && !NOT_A_CONTROL.has(id),
    );
    expect(unclassified).toEqual([]);
    // And it found some, rather than passing by looking at nothing.
    expect(found.size).toBeGreaterThan(8);
  });
});
