import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import ComponentsPage, { coverage, inventory } from "@/pages/showcase/ComponentsPage";
import { renderWithProviders } from "@/test/render";

/**
 * The component showcase (§60).
 *
 * The one property that matters is honesty about coverage. A hand-written
 * gallery drifts from the components it documents and is then worse than no
 * gallery, because somebody trusts it — so the inventory is read from the
 * directory and the page publishes what it is *not* showing.
 *
 * So `coverage` is asserted directly: every component in the inventory is
 * either demonstrated or listed as missing, with nothing falling between. And
 * through the page: that the gap is rendered rather than swallowed, and that
 * each demonstration shows the states that are actually decisions.
 */
function render() {
  return renderWithProviders(
    <Routes>
      <Route path="/showcase/components" element={<ComponentsPage />} />
    </Routes>,
    { route: "/showcase/components" },
  );
}

describe("the inventory", () => {
  it("comes from the directory rather than a list typed here", () => {
    const names = inventory();
    // A component added to `src/components` appears the same day; one deleted
    // stops being documented. Neither is true of a hand-kept list.
    expect(names).toContain("StatCard");
    expect(names).toContain("PageHeader");
    expect(names.length).toBeGreaterThan(5);
  });

  it("leaves the tests out, by pattern rather than an ignore list", () => {
    expect(inventory()).not.toContain("ExportButton.test");
    expect(inventory().some((name) => name.includes(".test"))).toBe(false);
  });

  it("is sorted, so the page order is not the filesystem's", () => {
    const names = inventory();
    expect(names).toEqual([...names].sort());
  });

  it("reads a name out of a path", () => {
    expect(
      inventory([
        "../../components/Zebra.tsx",
        "../../components/Alpha.tsx",
        "../../components/Alpha.test.tsx",
      ]),
    ).toEqual(["Alpha", "Zebra"]);
  });
});

describe("what the page admits to", () => {
  it("splits the inventory into shown and missing, with nothing between", () => {
    const found = coverage();
    // The property a drifting gallery loses: every component is accounted
    // for, one way or the other.
    expect(found.shown.length + found.missing.length).toBe(found.total);
    expect(found.total).toBe(inventory().length);
  });

  it("counts a component with no demonstration as missing", () => {
    const found = coverage(["Alpha", "Beta"], ["Alpha"]);
    expect(found.shown).toEqual(["Alpha"]);
    expect(found.missing).toEqual(["Beta"]);
  });

  it("does not count a demonstration of something that no longer exists", () => {
    // A demonstration left behind after the component was deleted would
    // otherwise inflate the coverage — the direction that rots quietly.
    const found = coverage(["Alpha"], ["Alpha", "Removed"]);
    expect(found.total).toBe(1);
    expect(found.shown).toEqual(["Alpha"]);
  });
});

describe("the page", () => {
  it("publishes the gap rather than swallowing it", () => {
    render();
    const gap = screen.getByTestId("coverage-gap");
    const found = coverage();
    if (found.missing.length) {
      // Named, with their files, so the omission is actionable rather than
      // merely admitted.
      expect(gap).toHaveTextContent("no demonstration");
      const table = screen.getByTestId("missing-table");
      for (const name of found.missing) {
        expect(within(table).getByText(name)).toBeInTheDocument();
      }
    } else {
      expect(gap).toHaveTextContent("Every shared component is demonstrated");
    }
  });

  it("shows the number, so coverage is a fact and not an impression", () => {
    render();
    const found = coverage();
    expect(
      screen.getByText(`${found.shown.length} of ${found.total} demonstrated`),
    ).toBeInTheDocument();
  });

  it("demonstrates each component it claims to", () => {
    render();
    for (const name of coverage().shown) {
      expect(screen.getByTestId(`demo-${name}`), name).toBeInTheDocument();
    }
  });

  it("shows the states that are decisions, not one happy path", () => {
    render();
    const stat = screen.getByTestId("demo-StatCard");
    // The whole point of `polarity`: the same arrow is good news for revenue
    // and bad news for open tickets.
    expect(within(stat).getByText(/a rise reads as bad news/)).toBeInTheDocument();
    expect(within(stat).getByText(/the same arrow reads as good/)).toBeInTheDocument();

    const empty = screen.getByTestId("demo-EmptyState");
    expect(within(empty).getByText("No tickets yet")).toBeInTheDocument();
    expect(within(empty).getByText("Nothing matches")).toBeInTheDocument();
  });

  it("says why the feature components are absent", () => {
    render();
    // Otherwise their absence reads as an omission rather than a decision.
    expect(screen.getByTestId("feature-note")).toHaveTextContent(
      /components\/mail, components\/kanban/,
    );
  });
});
