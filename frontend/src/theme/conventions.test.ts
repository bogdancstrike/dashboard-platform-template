import { describe, expect, it } from "vitest";

import {
  DENSE_BY_CONSTRUCTION,
  EMPTY_STATE,
  FORBIDDEN_BUTTON_TYPES,
  IN_PROSE_NAVIGATION,
  ONE_OF_N,
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

describe("choosing one of a few", () => {
  it("is a Segmented, never a strip of radio buttons", () => {
    /**
     * The two look nothing alike, and `/settings/preferences` had both: the
     * date format as a row of bordered buttons directly above three
     * `Segmented` controls asking exactly the same kind of question. That is
     * what "the platform should feel uniform" is about — not a colour, a
     * component chosen twice for one job.
     *
     * `Radio.Group` on its own is untouched: a vertical list where each option
     * carries its own description is what radios are for.
     */
    const offenders: string[] = [];
    for (const file of shippedSources(/\.tsx$/)) {
      if (!file.source.includes('optionType="button"')) continue;
      offenders.push(`${file.name}: ${ONE_OF_N.not}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("navigation inside a sentence", () => {
  it("is a Link, not a button that calls navigate", () => {
    /**
     * A `<button>` that navigates cannot be middle-clicked, opened in a new
     * tab or copied, and a screen reader announces it as a button. The
     * `nu-link-button` class itself is fine — it is how a record's name in a
     * list becomes reachable by keyboard — so this catches the misuse: the
     * class *and* a `navigate()` in the same element.
     */
    const offenders: string[] = [];
    for (const file of shippedSources(/\.tsx$/)) {
      if (file.name === IN_PROSE_NAVIGATION.exception.split(" — ")[0]) continue;
      for (const element of file.source.split("<button").slice(1)) {
        const tag = element.slice(0, element.indexOf(">") + 1);
        const body = element.slice(0, element.indexOf("</button>"));
        if (!tag.includes("nu-link-button")) continue;
        if (!/\bnavigate\(/.test(body)) continue;
        offenders.push(`${file.name}: ${IN_PROSE_NAVIGATION.not}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still allows the class for a name that is its own control", () => {
    // The guard on the guard: the rule above must not have been satisfied by
    // deleting the pattern it polices. `nu-link-button` is load-bearing —
    // a row that responds only to a click is a control no keyboard can reach.
    const uses = shippedSources(/\.tsx$/).filter((file) =>
      file.source.includes("nu-link-button"),
    );
    expect(uses.length).toBeGreaterThan(5);
  });
});

describe("an empty state's action", () => {
  it("is an AntD Button, never a bare one", () => {
    /**
     * An empty state is what somebody meets on their *first* visit to a
     * feature, so its action is the page's primary verb at the moment it
     * matters most. Eight of the nine were a `<Button>`; the ninth offered a
     * text link, on the kanban gallery — the first thing a new reader of that
     * feature ever sees.
     */
    const offenders: string[] = [];
    for (const file of shippedSources(/\.tsx$/)) {
      for (const element of file.source.split("<EmptyState").slice(1)) {
        // The prop's value, up to the close of the element it sits in.
        const at = element.indexOf("action=");
        if (at === -1) continue;
        const value = element.slice(at, element.indexOf("/>", at));
        if (!/<button\b/.test(value)) continue;
        offenders.push(`${file.name}: an EmptyState action must be ${EMPTY_STATE.action}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
