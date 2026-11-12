import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
function render(query = "") {
  return renderWithProviders(
    <Routes>
      <Route path="/showcase/components" element={<ComponentsPage />} />
    </Routes>,
    { route: `/showcase/components${query ? `?q=${encodeURIComponent(query)}` : ""}` },
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
    render("polarity");
    const stat = screen.getByTestId("demo-StatCard");
    // The whole point of `polarity`: the same arrow is good news for revenue
    // and bad news for response time.
    expect(within(stat).getByText(/a rise reads as bad news/)).toBeInTheDocument();
    expect(within(stat).getByText(/the same arrow reads as good/)).toBeInTheDocument();

  });

  it("shows both empties", () => {
    render("emptystate");
    const empty = screen.getByTestId("demo-EmptyState");
    expect(within(empty).getByText("No tickets yet")).toBeInTheDocument();
    expect(within(empty).getByText("Nothing matches")).toBeInTheDocument();
  });

  it("shows feature components, and says the shelf is a selection", () => {
    render("nucleus patterns");
    expect(screen.getByTestId("feature-shelf")).toBeInTheDocument();
    expect(screen.getByTestId("demo-widget-card")).toBeInTheDocument();
    expect(screen.getByTestId("demo-kanban-card")).toBeInTheDocument();
    expect(screen.getByTestId("demo-audit-diff")).toBeInTheDocument();
    expect(screen.getByTestId("feature-note")).toHaveTextContent(/selection, not an inventory/);
  });

  it("demonstrates the table's states, and tells the two empties apart", async () => {
    const user = userEvent.setup();
    render("six states");

    const stage = await screen.findByTestId("table-stage");
    expect(within(stage).getByText("Printer on fire")).toBeInTheDocument();

    await user.click(screen.getByText("Nothing yet"));
    const nothing = within(screen.getByTestId("table-stage")).getByTestId("empty-state");
    expect(nothing).toHaveTextContent("No tickets yet");
    // No filters are set, so it must not blame one.
    expect(nothing).not.toHaveTextContent(/filter/i);

    await user.click(screen.getByText("Nothing matched"));
    const matched = within(screen.getByTestId("table-stage")).getByTestId("empty-state");
    expect(matched).toHaveTextContent(/match/i);
    expect(within(matched).getByRole("button", { name: /Clear/ })).toBeInTheDocument();

    await user.click(screen.getByText("Refused"));
    const refused = within(screen.getByTestId("table-stage")).getByTestId("failure-alert");
    expect(refused).toHaveAttribute("data-failure", "forbidden");
    // A refusal names the permission and offers no retry.
    expect(refused).toHaveTextContent("records.view");
    expect(within(refused).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("the documentation", () => {
  it("indexes every entry by group, and the search narrows both the index and the sections", async () => {
    const user = userEvent.setup();
    render("foundations");
    const index = screen.getByRole("complementary", { name: "Components" });
    const foundations = within(index).getByRole("button", { name: /Foundations/ });
    expect(foundations).toHaveAttribute("aria-expanded", "true");
    expect(within(index).getByRole("link", { name: "NxIcon" })).toBeInTheDocument();

    // A group folds, and "collapse all" folds every one.
    await user.click(foundations);
    expect(within(index).queryByRole("link", { name: "NxIcon" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search components"));
    await user.click(within(index).getByRole("button", { name: "Collapse all groups" }));
    expect(within(index).queryByRole("link", { name: "PageHeader" })).not.toBeInTheDocument();
    await user.click(within(index).getByRole("button", { name: "Expand all groups" }));
    expect(within(index).getByRole("link", { name: "PageHeader" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search components"), "statustag");
    expect(within(index).getByRole("link", { name: "StatusTag" })).toBeInTheDocument();
    expect(within(index).queryByRole("link", { name: "PageHeader" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("demo-PageHeader")).not.toBeInTheDocument();
    expect(screen.getByTestId("demo-StatusTag")).toBeInTheDocument();
  });

  it("shows each demo's own source as code, with a copy that says it worked", async () => {
    const user = userEvent.setup();
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => { writes.push(text); return Promise.resolve(); } },
    });
    render("all five tones");
    const demo = screen.getByTestId("demo-file-status-tag.tones");
    await user.click(within(demo).getByText("Code"));
    // The code *is* the demo file: it imports the real component.
    expect(demo).toHaveTextContent('import { StatusTag, type StatusTone } from "@/components/StatusTag";');
    await user.click(within(demo).getByRole("button", { name: /Copy/ }));
    expect(writes[0]).toContain("export default function StatusTagTones");
    expect(await within(demo).findByText("Copied")).toBeInTheDocument();
  });

  it("documents the props of the components it covers", () => {
    render("pageheader");
    const header = screen.getByTestId("demo-PageHeader");
    expect(within(header).getByText("API")).toBeInTheDocument();
    expect(within(header).getByText("onBack")).toBeInTheDocument();
  });
});
