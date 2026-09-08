import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import TemplatesPage, { routeLabel, summary } from "@/pages/showcase/TemplatesPage";
import { LAYOUTS } from "@/pages/showcase/templates";
import { renderWithProviders } from "@/test/render";

/**
 * The page template gallery (§61).
 *
 * `templates.test.ts` guards the thing that matters — that every route is
 * classified, checked against the router itself. This file covers the
 * rendering, and the one claim worth pinning here: **every layout says when it
 * is the wrong answer**. A gallery that only lists what each shape is for
 * invites somebody to reach for the most impressive one, so `unless` is on
 * every card and given the same weight as `when`.
 */
function render() {
  return renderWithProviders(
    <Routes>
      <Route path="/showcase/templates" element={<TemplatesPage />} />
    </Routes>,
    { route: "/showcase/templates" },
  );
}

describe("the summary", () => {
  it("names the completeness, because that is what the page rests on", () => {
    const said = summary();
    expect(said).toContain("page shapes");
    // Not "12 layouts" alone: the useful fact is that nothing is missing.
    expect(said).toContain("Every route in the router is classified");
    expect(said).toContain("a test enforces");
  });

  it("counts shapes without counting the redirects", () => {
    // "Not a layout" is a category on the page and not a shape anybody can
    // choose, so including it in the count would overstate the offer.
    const said = summary([
      { key: "list", name: "List", shape: "x", when: "y", unless: "z", routes: ["a"] },
      { key: "redirect", name: "Not a layout", shape: "x", when: "y", unless: "z", routes: ["b"] },
    ]);
    expect(said).toMatch(/^1 page shapes/);
  });
});

describe("a route reads as its address", () => {
  it("is the thing somebody would type", () => {
    expect(routeLabel("admin/health")).toBe("/admin/health");
    expect(routeLabel("tasks")).toBe("/tasks");
  });
});

describe("the page", () => {
  it("shows every layout the template offers", () => {
    render();
    for (const layout of LAYOUTS) {
      expect(screen.getByTestId(`layout-${layout.key}`), layout.key).toBeInTheDocument();
    }
  });

  it("says when each layout is the wrong answer", () => {
    render();
    for (const layout of LAYOUTS) {
      const card = screen.getByTestId(`layout-${layout.key}`);
      // The half a gallery usually omits, and the half that stops somebody
      // reaching for a split view over a table.
      expect(within(card).getByText("Not when"), layout.key).toBeInTheDocument();
      expect(within(card).getByText(layout.unless), layout.key).toBeInTheDocument();
    }
  });

  it("links to real pages built each way", () => {
    render();
    const split = screen.getByTestId("routes-split");
    // Not mockups: the fastest way to judge a layout is to open one that is
    // already carrying data.
    expect(within(split).getByRole("link", { name: /\/mail/ })).toHaveAttribute(
      "href",
      "/mail",
    );
    expect(within(split).getByRole("link", { name: /\/tickets/ })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });

  it("keeps the redirects out of the shapes and says so", () => {
    render();
    const shapes = screen.getByTestId("layouts");
    const others = screen.getByTestId("non-layouts");
    expect(within(shapes).queryByTestId("layout-redirect")).not.toBeInTheDocument();
    expect(within(others).getByTestId("layout-redirect")).toBeInTheDocument();
    expect(screen.getByText("And what is not a layout")).toBeInTheDocument();
  });

  it("explains the mechanism that keeps it true", () => {
    render();
    // A reader should know *why* to trust the gallery, not merely be asked to.
    expect(screen.getByTestId("completeness")).toHaveTextContent(
      /fails `templates.test.ts`/,
    );
  });
});
