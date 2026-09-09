import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Motion is functional and fast, and the reader can switch it off (§55, §59).
 *
 * Two of the platform's look-and-feel rules were prose only: "120–180ms
 * ease-out for state changes, none at all for anything that happens on every
 * keystroke", and "no decorative animation". Prose is what a stylesheet drifts
 * from — one `transition: all 400ms` and a table that used to feel instant
 * feels sticky, and nothing fails.
 *
 * So the rules are read out of `index.css`:
 *
 * * **Every transition is short.** A state change nobody waits for is one
 *   under about a fifth of a second; the one at 200ms is the mobile sider,
 *   which is a layer arriving from the edge rather than a state changing under
 *   the reader's cursor.
 * * **Nothing loops for ever.** An animation with `infinite` in a stylesheet
 *   is decoration — a spinner is AntD's, and it stops when the request does.
 *   It is also what makes every accessibility sweep in this suite hang: they
 *   wait for the page's animations to settle before auditing it.
 * * **`prefers-reduced-motion` cancels both** animations and transitions, for
 *   everything, rather than for the handful of selectors somebody remembered.
 */

const STYLESHEET = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

/** Every duration in a `transition` shorthand, in milliseconds. */
function durations(): { declaration: string; ms: number }[] {
  const found: { declaration: string; ms: number }[] = [];
  for (const match of STYLESHEET.matchAll(/transition:\s*([^;]+);/g)) {
    const declaration = match[1]!.trim();
    if (declaration === "none") continue;
    for (const time of declaration.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
      const value = Number(time[1]);
      found.push({ declaration, ms: time[2] === "s" ? value * 1000 : value });
    }
  }
  return found;
}

describe("motion in the stylesheet", () => {
  it("reads the stylesheet it is checking", () => {
    // Without this the assertions below could pass by looking at nothing.
    expect(STYLESHEET.length).toBeGreaterThan(10_000);
    expect(durations().length).toBeGreaterThan(10);
  });

  it("is short enough that nobody waits for it", () => {
    const slow = durations().filter((entry) => entry.ms > 200);
    expect(slow).toEqual([]);
  });

  it("is never instant-but-declared, which is a transition that does nothing", () => {
    const pointless = durations().filter((entry) => entry.ms === 0);
    expect(pointless).toEqual([]);
  });

  it("loops nothing for ever", () => {
    // A stylesheet animation that never ends is decoration, and it also makes
    // every `document.getAnimations()` wait in the browser suite hang.
    expect(STYLESHEET).not.toMatch(/animation[^;]*infinite/);
  });

  it("lets the operating system turn it off, for everything", () => {
    const block = STYLESHEET.slice(STYLESHEET.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation-duration");
    expect(block).toContain("transition-duration");
    // The universal selector, not a list somebody has to remember to extend.
    expect(block.slice(0, 200)).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });
});
