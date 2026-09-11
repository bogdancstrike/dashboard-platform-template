import { describe, expect, it } from "vitest";

import {
  DENSE_BY_CONSTRUCTION,
  EMPTY_STATE,
  FORBIDDEN_BUTTON_TYPES,
} from "@/theme/conventions";
import { shippedSources } from "@/test/sources";

/**
 * The design conventions, asserted against the source (§60).
 *
 * A style guide nothing checks is a document, and a document is what the drift
 * happened underneath. These are the rules from `conventions.ts`, each one
 * failing here the moment a page stops following it.
 *
 * The messages name the file *and* the fix, because a test that says "a page
 * sets a size" sends somebody hunting; one that says which page and what to
 * write instead is a test that gets obeyed rather than deleted.
 */

/**
 * Every `<Button …>` opening tag in the shipped source, with its file.
 *
 * Scanned with brace and quote awareness rather than matched with a regex.
 * `[^>]*?/?>` looks right and is not: it stops at the first `>` it meets,
 * which in `<Button icon={<DeleteOutlined />} …>` is the *icon's*. The first
 * version of this file reported a hundred and sixty-six unlabelled icon-only
 * buttons that were nothing of the kind — every one of them had a word in it —
 * and would have gone on missing the real ones for the same reason.
 */
function buttons(): { file: string; tag: string }[] {
  const found: { file: string; tag: string }[] = [];
  for (const file of shippedSources(/\.tsx$/)) {
    const source = file.source;
    let index = source.indexOf("<Button");
    while (index >= 0) {
      let cursor = index + "<Button".length;
      let depth = 0;
      let quote = "";
      while (cursor < source.length) {
        const character = source[cursor]!;
        if (quote) {
          if (character === quote) quote = "";
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === "{") {
          depth += 1;
        } else if (character === "}") {
          depth -= 1;
        } else if (character === ">" && depth === 0) {
          break;
        }
        cursor += 1;
      }
      found.push({ file: file.name, tag: source.slice(index, cursor + 1) });
      index = source.indexOf("<Button", cursor + 1);
    }
  }
  return found;
}

describe("the button vocabulary", () => {
  it("reads enough of the product to be worth asserting", () => {
    // Guard against the regex quietly matching nothing and every rule below
    // passing on an empty set.
    expect(buttons().length).toBeGreaterThan(150);
  });

  it("uses none of the types this product has decided against", () => {
    const offenders = buttons()
      .filter(({ tag }) =>
        Object.keys(FORBIDDEN_BUTTON_TYPES).some((type) => tag.includes(`type="${type}"`)),
      )
      .map(({ file, tag }) => {
        const type = Object.keys(FORBIDDEN_BUTTON_TYPES).find((key) =>
          tag.includes(`type="${key}"`),
        )!;
        return `${file}: type="${type}" — ${FORBIDDEN_BUTTON_TYPES[type]}`;
      });

    // `type="link"` looks like a link and is not one: no new tab, no
    // middle-click, and a screen reader announces a button. Having both it and
    // `type="text"` is how one page ends up with two greys.
    expect(offenders).toEqual([]);
  });

  it("leaves the size to the reader's density setting", () => {
    // `AppearanceProvider` maps density onto AntD's `componentSize`, so every
    // control already answers to the three densities a reader may choose. A
    // page that writes `size="small"` overrides that choice — and somebody who
    // asked for *comfortable* because they cannot see the compact one gets a
    // page that ignores them.
    const offenders = buttons()
      .filter(({ tag }) => /\bsize="/.test(tag))
      .filter(({ file }) => !(file in DENSE_BY_CONSTRUCTION))
      .map(({ file }) => file);

    expect([...new Set(offenders)]).toEqual([]);
  });

  it("only exempts shared components, and only with a reason", () => {
    for (const [file, reason] of Object.entries(DENSE_BY_CONSTRUCTION)) {
      // A *page* on this list has opted its readers out of their own density
      // setting; judgement belongs in the component that owns the constraint.
      expect(file.startsWith("components/"), file).toBe(true);
      // "Because it is small" is not a reason. The sentence has to name the
      // constraint that makes the size structural rather than preferred.
      expect(reason.length, file).toBeGreaterThan(24);
    }
  });

  it("keeps the exemption list honest", () => {
    const shipped = new Set(shippedSources(/\.tsx$/).map((file) => file.name));
    for (const file of Object.keys(DENSE_BY_CONSTRUCTION)) {
      // An exemption left behind after a file was deleted or cleaned up is an
      // exemption that will silently readmit the drift it was granted for.
      expect(shipped.has(file), `${file} is exempted and no longer exists`).toBe(true);
    }
  });
});

describe("a control that shows only an icon", () => {
  /**
   * An icon-only button announces itself as "button" and nothing else.
   *
   * Self-closing (`<Button … />`) with an `icon` and no children is the shape
   * that has no text, so it is the shape that must carry a name. A button with
   * a word in it is already named by the word.
   */
  it("says its name", () => {
    const offenders = buttons()
      // Self-closing means no children, which means no text to be named by.
      .filter(({ tag }) => tag.trimEnd().endsWith("/>"))
      .filter(({ tag }) => /\bicon=/.test(tag))
      .filter(({ tag }) => !/aria-label=|aria-labelledby=/.test(tag))
      .map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);

    expect(offenders).toEqual([]);
  });
});

describe("one empty state", () => {
  /**
   * Three of them were on screen at once: AntD's default illustration — the
   * grey cartoon box every React admin panel ships with — its
   * `PRESENTED_IMAGE_SIMPLE` outline, and this product's own. A reader meeting
   * all three in one session is not meeting a design.
   */
  it("is this product's, everywhere but the file that owns it", () => {
    const offenders = shippedSources(/\.tsx$/)
      .filter((file) => file.name !== EMPTY_STATE.owner.replace(/^.*?src\//, ""))
      .filter((file) => /<Empty(?![A-Za-z0-9_])/.test(file.source))
      .map((file) => `${file.name} — use ${EMPTY_STATE.use}`);

    expect(offenders).toEqual([]);
  });

  it("is reached for often enough to be the product's answer", () => {
    const using = shippedSources(/\.tsx$/).filter((file) =>
      /<EmptyState\b|<NoResults\b/.test(file.source),
    );
    // Guard against the rule above passing because nothing draws an empty at
    // all — which is the other way a product loses its empty states.
    expect(using.length).toBeGreaterThan(30);
  });
});
