import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusTag } from "@/components/StatusTag";
import { jsxElements, shippedFiles, shippedSources } from "@/test/sources";

/**
 * A status is coloured in a way that can be *read* (§55, §59).
 *
 * `StatusTag` exists because `<Tag color={hex}>` fills the tag and puts white
 * text on it, and AntD picks that white without measuring: white on this
 * platform's grey is 2.56:1 and on its cyan 3.68:1, at 10px. The labels worth
 * reading — a breach, a failure — fail worst.
 *
 * It was written, and then **thirteen call sites across nine files kept the
 * broken form**. Its own docstring predicted exactly that: "every page
 * remembering to write the same inline border is how six pages ended up with
 * three different status tags." So the rule is a test now rather than a
 * component nobody was obliged to use — found when axe was first run over the
 * ticket queue, which no spec had done.
 */

describe("the component", () => {
  it("keeps the surface's ink and puts the colour on the leading edge", () => {
    render(<StatusTag status="AT_RISK" />);
    const tag = screen.getByText("AT_RISK");
    // Not a filled tag: the border carries the meaning and the text keeps the
    // contrast the theme already guarantees.
    expect(tag).toHaveClass("nu-status-tag");
    expect(tag.style.borderInlineStartColor).toBeTruthy();
  });

  it("shows the vocabulary verbatim, because that is what a reader quotes", () => {
    render(<StatusTag status="IN_REVIEW" />);
    // A prettified label would be the one place the tag and the filter URL
    // disagreed about what the value is.
    expect(screen.getByText("IN_REVIEW")).toBeInTheDocument();
  });

  it("renders nothing rather than an empty tag when there is no status", () => {
    const { container } = render(<StatusTag status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks an unknown status as unassigned rather than borrowing a colour", () => {
    render(<StatusTag status="SOMETHING_NEW" />);
    expect(screen.getByText("SOMETHING_NEW").style.borderInlineStartColor).toContain("--nu-border-strong");
  });
});

describe("no page writes its own filled status tag", () => {
  it("finds the application's own files at all", () => {
    // Without this the assertion below could pass by looking at nothing.
    expect(shippedFiles().length).toBeGreaterThan(60);
  });

  it("has no shipped module passing a computed colour to a Tag", () => {
    // A *preset* name is fine — `<Tag color="warning">` is a tinted ground
    // whose ink `index.css` already fixes. What this catches is a colour
    // computed from the vocabulary and handed to AntD as a fill, which is the
    // form that puts white on it.
    //
    // Scoped to `<Tag …>` elements rather than to the whole file, because the
    // component that *does* take a data colour — `EdgeTag` — takes it in a
    // prop of the same name.
    const offenders: string[] = [];
    for (const file of shippedSources()) {
      if (file.name.endsWith("EdgeTag.tsx")) continue;
      for (const element of jsxElements(file.source, "Tag")) {
        const match = /color=\{([^}]*)\}/.exec(element);
        const expression = match?.[1] ?? "";
        if (!expression) continue;
        // Three shapes, all of which end as a fill AntD writes white on:
        // a vocabulary helper, a literal hex, and a `color`/`colour` field
        // from the API or a config map. The last two are what the first
        // version of this rule could not see — role colours in the directory
        // and widget-kind colours in the dashboard gallery were 3.29:1 and
        // 3.74:1 for the life of both pages, found by auditing every route.
        if (
          /knownStatusColor|categoryColor|SEMANTIC\.|STATUS_COLORS/.test(expression) ||
          /#[0-9a-fA-F]{3,8}/.test(expression) ||
          /\.colou?r\b|_colou?r\b/.test(expression)
        ) {
          offenders.push(`${file.name}: color={${expression.trim()}} — use EdgeTag`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads the Tag elements it is meant to be checking", () => {
    // Without this the rule above passes by parsing nothing — and the element
    // scan is hand-rolled, so "it found no tags" is a real way for it to be
    // wrong.
    const tags = shippedSources().flatMap((file) => jsxElements(file.source, "Tag"));
    expect(tags.length).toBeGreaterThan(30);
    expect(tags.some((element) => /color="/.test(element))).toBe(true);
  });
});
