import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ExplorerResult, ExplorerView } from "@/api/explorer";
import { ExplorerResults, type ExplorerResultsProps } from "@/components/explorer/ExplorerResults";
import { renderWithProviders } from "@/test/render";

/**
 * The one result renderer (§5): a table, a list, cards or a compact list,
 * sectioned or flat — with the same values, the same click and the same star.
 */
const RESULT: ExplorerResult = {
  items: [
    { id: "t-1", title: "Fix the login", status: "OPEN", urgent: true, due: "2020-03-04T10:00:00Z", tags: ["auth", "web"], points: 1234.5678, note: null },
    { id: "t-2", title: "Ünïcode ✓ résumé", status: "IN_PROGRESS", urgent: false, due: "not a date", tags: [], points: 3, note: "" },
    { id: "t-3", title: "Blocked by vendor", status: "", urgent: false, due: new Date().toISOString(), tags: ["x"], points: 0, note: "login retry" },
  ],
  total: 40,
  page: 1,
  page_size: 25,
  pages: 2,
  sort: "title",
  order: "asc",
  resource_type: "task",
  columns: ["title", "status", "urgent", "due", "tags", "points", "note"],
  fields: [
    { name: "title", label: "Title", kind: "text", sortable: true },
    { name: "status", label: "Status", kind: "enum", sortable: true },
    { name: "urgent", label: "Urgent", kind: "bool" },
    { name: "due", label: "Due", kind: "datetime", sortable: true },
    { name: "points", label: "Points", kind: "number" },
  ] as ExplorerResult["fields"],
  facets: { status: [{ value: "OPEN", count: 20 }, { value: "IN_PROGRESS", count: 12 }, { value: "BLOCKED", count: 8 }] },
  condition_text: "",
  rule_count: 0,
  query_text: "login",
  searchable: ["title", "note"],
};

function show(view: ExplorerView, props: Partial<ExplorerResultsProps> = {}) {
  const handlers = {
    onPage: vi.fn(),
    onSort: vi.fn(),
    onPreview: vi.fn(),
    onOpen: undefined as ExplorerResultsProps["onOpen"],
  };
  renderWithProviders(<ExplorerResults result={RESULT} view={view} loading={false} {...handlers} {...props} />);
  return handlers;
}

describe("as a table", () => {
  it("draws each kind of value the way the app does everywhere", () => {
    show("table");
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /Title/ })).toBeInTheDocument();
    // An unnamed field gets a title made from its name.
    expect(within(table).getByRole("columnheader", { name: "Tags" })).toBeInTheDocument();
    expect(within(table).getByText("Yes")).toBeInTheDocument();
    expect(within(table).getAllByText("No").length).toBeGreaterThan(0);
    expect(within(table).getByText("auth")).toBeInTheDocument();
    expect(within(table).getByText("1,234.57")).toBeInTheDocument();
    // A date that does not parse is shown as it came, not as "Invalid Date".
    expect(within(table).getByText("not a date")).toBeInTheDocument();
    expect(within(table).queryByText(/Invalid Date/)).not.toBeInTheDocument();
    // Empty values read as a dash.
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("1–25 of 40")).toBeInTheDocument();
  });

  it("previews a row on click, or opens it where the list is a place to work", async () => {
    const user = userEvent.setup();
    const { onPreview } = show("table");
    await user.click(screen.getByText("Blocked by vendor"));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "t-3" }));
  });

  it("opens rather than previews when told to, and the eye still previews", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { onPreview } = show("table", { onOpen });
    await user.click(screen.getByText("Blocked by vendor"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "t-3" }));
    await user.click(screen.getByRole("button", { name: "Preview t-1" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("asks the server for another page and another sort", async () => {
    const user = userEvent.setup();
    const { onPage, onSort } = show("table");
    await user.click(screen.getByTitle("2"));
    expect(onPage).toHaveBeenCalledWith(2, 25);
    await user.click(screen.getByRole("columnheader", { name: /Due/ }));
    expect(onSort).toHaveBeenCalledWith("due", expect.stringMatching(/asc|desc/));
  });

  it("stars rows where the list is a place to work", () => {
    show("table", { starrable: true, path: "/tasks" });
    expect(screen.getAllByRole("button", { name: /favourite|star|bookmark/i }).length).toBeGreaterThan(0);
  });

  it("says so when nothing matches", () => {
    show("table", { result: { ...RESULT, items: [], total: 0 } });
    expect(screen.getByText("No records match this question")).toBeInTheDocument();
  });
});

describe("as a list, cards or compact", () => {
  it.each(["list", "cards", "compact"] as ExplorerView[])("draws %s, opens a row and loads more", async (view) => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const { onPreview } = show(view, { onLoadMore, starrable: true });
    expect(screen.getByText("Blocked by vendor")).toBeInTheDocument();
    // The labels are drawn in the roomy modes only.
    if (view === "compact") expect(screen.queryByText("Status")).not.toBeInTheDocument();
    else expect(screen.getAllByText("Status").length).toBeGreaterThan(0);
    await user.click(screen.getByText("Blocked by vendor"));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "t-3" }));
    expect(screen.getByText("3 of 40")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it("uses the rows loaded so far, and offers no more once it has them all", () => {
    show("list", { rows: RESULT.items, result: { ...RESULT, total: 3 }, onLoadMore: vi.fn() });
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("sections by a field from the server's counts, keeping groups not loaded yet", () => {
    show("list", { groupBy: "status" });
    const sections = document.querySelectorAll(".nu-result-section");
    // OPEN, IN PROGRESS and BLOCKED from the facets, and the empty value.
    expect(sections).toHaveLength(4);
    expect(within(sections[0] as HTMLElement).getByText("OPEN")).toBeInTheDocument();
    expect(within(sections[0] as HTMLElement).getByText("1 of 20")).toBeInTheDocument();
    expect(screen.getByText("IN PROGRESS")).toBeInTheDocument();
    expect(screen.getByText("No value")).toBeInTheDocument();
    expect(screen.getByText("Not loaded yet — continue below to reach these.")).toBeInTheDocument();
  });

  it("sections without counts when the server sent none for that field", () => {
    show("cards", { groupBy: "urgent" });
    expect(document.querySelectorAll(".nu-result-section").length).toBe(2);
  });

  it("says so when nothing matches", () => {
    show("cards", { result: { ...RESULT, items: [], total: 0 } });
    expect(screen.getByText("No records match this question")).toBeInTheDocument();
    expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
  });
});
