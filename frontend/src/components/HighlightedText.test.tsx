import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HighlightedText, split } from "./HighlightedText";

describe("splitting a value around a search term", () => {
  it("leaves text alone when there is no term", () => {
    expect(split("Audit the backup", "")).toEqual([{ text: "Audit the backup", match: false }]);
  });

  it("marks every occurrence, ignoring case", () => {
    expect(split("Audit the audit trail", "audit")).toEqual([
      { text: "Audit", match: true },
      { text: " the ", match: false },
      { text: "audit", match: true },
      { text: " trail", match: false },
    ]);
  });

  it("marks a match at the very start and end", () => {
    expect(split("abc", "abc")).toEqual([{ text: "abc", match: true }]);
  });

  it("treats a term with regex syntax as literal text", () => {
    // A term arrives from a text box. Built into a pattern, `(a` throws and
    // `.*` matches everything — neither is what the reader typed.
    expect(split("total (a) cost", "(a)")).toEqual([
      { text: "total ", match: false },
      { text: "(a)", match: true },
      { text: " cost", match: false },
    ]);
    expect(split("anything", ".*")).toEqual([{ text: "anything", match: false }]);
  });

  it("does not loop forever on an empty match", () => {
    expect(split("abc", "   ")).toEqual([{ text: "abc", match: false }]);
  });
});

describe("the rendered highlight", () => {
  it("wraps matches in <mark>, so find-in-page and readers agree", () => {
    render(<HighlightedText text="Audit the alerting rules" term="alert" />);

    const marks = screen.getAllByText("alert");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.tagName).toBe("MARK");
  });

  it("marks a value that is entirely the term", () => {
    // A reference searched for in full comes back as one part, and that part
    // is the match — returning early on "one part" left it unmarked.
    const { container } = render(<HighlightedText text="TSK-00042" term="TSK-00042" />);

    expect(container.querySelector("mark")?.textContent).toBe("TSK-00042");
  });

  it("renders untouched text when nothing matches", () => {
    const { container } = render(<HighlightedText text="Audit the rules" term="zzz" />);

    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Audit the rules");
  });
});
