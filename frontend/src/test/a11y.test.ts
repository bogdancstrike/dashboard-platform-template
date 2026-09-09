import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC, jsxElements, shippedSources } from "@/test/sources";

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
 *
 * **Every accent-tinted surface re-points the quiet ink.** A tint is a third
 * ground: `--nu-text-tertiary` clears 4.5:1 on the page and on a card and
 * scores 3.92:1 on the accent-soft tint over that card, and a tinted row is
 * exactly where a "3 minutes ago" sits. The tint classes set the variable to
 * the secondary ink for everything inside them, which is one declaration
 * rather than a colour chosen in seventeen places — and this is what fails
 * when the eighteenth tinted surface forgets.
 *
 * **Nothing writes the accent *fill* on the accent tint.** `--nu-accent` is
 * 4.2:1 over `--nu-accent-soft` in dark, and `--nu-accent-ink` exists for
 * exactly this ground. The rule above reads the stylesheet, so it could not
 * see the one place that broke it: an inline `style` on the account card's
 * avatar, in JSX, which axe found in the dark appearance and only on the page
 * that happens to draw cards with initials in them.
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

describe("an accent-tinted surface", () => {
  const stylesheet = readFileSync(join(SRC, "index.css"), "utf8");

  /** Each rule in the stylesheet, as `selector { declarations }`. */
  function blocks(): Array<{ selector: string; body: string }> {
    return stylesheet
      .split("}")
      .map((chunk) => {
        const brace = chunk.indexOf("{");
        return brace === -1
          ? null
          : {
              selector: chunk.slice(0, brace).replace(/\/\*[\s\S]*?\*\//g, "").trim(),
              body: chunk.slice(brace + 1),
            };
      })
      .filter((block): block is { selector: string; body: string } => block !== null);
  }

  it("reads the stylesheet it is checking", () => {
    expect(blocks().length).toBeGreaterThan(300);
    expect(stylesheet).toContain("--nu-accent-soft");
  });

  it("re-points the quiet ink wherever it paints the tint", () => {
    // The selectors that paint it, and the one rule that lifts the ramp for
    // all of them. A surface in the first set and not the second is a surface
    // whose tertiary text measures 3.92:1 in the dark appearance.
    const painted = new Set<string>();
    const lifted = new Set<string>();
    for (const block of blocks()) {
      const selectors = block.selector.split(",").map((one) => one.trim()).filter(Boolean);
      if (/background:[^;]*--nu-accent-soft/.test(block.body)) {
        selectors.forEach((one) => painted.add(one));
      }
      if (/--nu-text-tertiary:\s*var\(--nu-text-secondary\)/.test(block.body)) {
        selectors.forEach((one) => lifted.add(one));
      }
    }
    expect(painted.size).toBeGreaterThan(10);
    expect([...painted].filter((selector) => !lifted.has(selector))).toEqual([]);
  });

  it("never writes the accent fill on the accent tint", () => {
    // Both grounds: the stylesheet's own blocks, and the inline styles that a
    // rule reading only CSS cannot see.
    const offenders: string[] = [];
    for (const block of blocks()) {
      if (
        /background:[^;]*--nu-accent-soft/.test(block.body) &&
        /(?:^|[^-])color:\s*var\(--nu-accent\)/.test(block.body)
      ) {
        offenders.push(`index.css ${block.selector}`);
      }
    }
    for (const file of shippedSources()) {
      const text = readFileSync(file.path, "utf8");
      for (const style of text.match(/style=\{\{[^}]*\}\}/g) ?? []) {
        if (
          style.includes("--nu-accent-soft") &&
          /color:\s*"var\(--nu-accent\)"/.test(style)
        ) {
          offenders.push(`${file.name} ${style}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});