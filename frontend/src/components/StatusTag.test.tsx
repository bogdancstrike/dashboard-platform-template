import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusTag } from "@/components/StatusTag";
import { SRC, shippedFiles } from "@/test/sources";

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
    const offenders: string[] = [];
    for (const path of shippedFiles()) {
      if (path.endsWith("StatusTag.tsx")) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/color=\{([^}]*)\}/g)) {
        const expression = match[1] ?? "";
        if (/knownStatusColor|categoryColor|SEMANTIC\.|STATUS_COLORS/.test(expression)) {
          offenders.push(`${relative(SRC, path)}: color={${expression.trim()}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
