import { describe, expect, it } from "vitest";

import { jsxElements, shippedSources } from "@/test/sources";

/**
 * Accessibility rules that hold across every page, asserted from the source.
 *
 * axe catches these in a browser, and the browser is where they matter — but
 * axe only ever runs over the pages a spec remembered to audit. Six entity
 * lists shipped without one, and the audit that was finally run over them
 * found eight unnamed progress bars on the task board alone. A rule that has
 * to be remembered per page is a rule that covers the pages somebody thought
 * of.
 *
 * **Every progress bar is named, or hidden.** `role="progressbar"` takes its
 * name from `aria-label` and never from its contents, so a bar with a visible
 * percentage inside it is still announced as a number with no subject. Two
 * answers are correct and this asserts that one of them was chosen: an
 * `aria-label` when the bar is the only carrier of the fact, or
 * `aria-hidden="true"` when the number is already readable beside it — which
 * is the honest answer for the decoration over a figure in a table cell.
 */

describe("progress bars", () => {
  it("finds the application's own files at all", () => {
    // Without this the assertion below could pass by looking at nothing.
    const sources = shippedSources();
    expect(sources.length).toBeGreaterThan(60);
    expect(sources.some((file) => file.name.endsWith("App.tsx"))).toBe(true);
  });

  it("are each either named or hidden", () => {
    const offenders: string[] = [];
    for (const file of shippedSources()) {
      for (const element of jsxElements(file.source, "Progress")) {
        if (/aria-label|aria-labelledby|aria-hidden/.test(element)) continue;
        offenders.push(`${file.name}: ${element.replace(/\s+/g, " ").slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
