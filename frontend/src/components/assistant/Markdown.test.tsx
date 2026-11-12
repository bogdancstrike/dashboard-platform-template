import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

import { inline, Markdown } from "./Markdown";

const TEXT = [
  "# Title",
  "Some **bold** and *em* and _also em_ and `code` and [a record](/tickets/1) and [site](https://example.com) and [bad](javascript:alert(1)).",
  "second line of the same paragraph",
  "",
  "- one",
  "* two",
  "1. first",
  "2) second",
  "",
  "| A | B |",
  "|---|:--:|",
  "| x | [y](/y) |",
  "",
  "```",
  "<script>alert(1)</script>",
  "```",
  "<b>not html</b>",
].join("\n");

describe("Markdown", () => {
  it("renders blocks and inline marks as elements, never as HTML", async () => {
    const onNavigate = vi.fn();
    const { container } = renderWithProviders(<Markdown text={TEXT} onNavigate={onNavigate} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("em")).toHaveLength(2);
    expect(container.querySelector("p code")?.textContent).toBe("code");
    expect(screen.getByRole("link", { name: "a record" })).toHaveAttribute("href", "/tickets/1");
    expect(screen.getByRole("link", { name: "site" })).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelectorAll("table td")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toBe("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "a record" }));
    expect(onNavigate).toHaveBeenCalled();
  });

  it("leaves plain text alone", () => {
    expect(inline("nothing special")).toEqual(["nothing special"]);
  });
});
