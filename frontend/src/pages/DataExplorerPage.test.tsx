import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import DataExplorerPage from "@/pages/DataExplorerPage";
import { savedDashboards, savedViews } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

describe("Data Explorer", () => {
  it("renders its field catalogue and records from backend responses", async () => {
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });

    expect(await screen.findByText("Review customer migration")).toBeInTheDocument();
    expect(screen.getByText("TSK-001")).toBeInTheDocument();
    expect(screen.getAllByText("IN PROGRESS").length).toBeGreaterThan(0);
    expect(screen.getByText("1 match", { exact: false })).toBeInTheDocument();
  });

  it("debounces simple search and sends it to the query endpoint", async () => {
    const requests: Array<Record<string, unknown>> = [];
    server.use(http.post("/platform/api/explorer/query", async ({ request }) => {
      requests.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({
        items: [], total: 0, page: 1, page_size: 25, pages: 1,
        sort: "updated_at", order: "desc", resource_type: "task",
        columns: [], fields: [], facets: {}, condition_text: "", rule_count: 0,
        query_text: "", searchable: [],
      });
    }));
    const user = userEvent.setup();
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });

    const search = await screen.findByPlaceholderText("Search tasks, and everywhere else…");
    await user.type(search, "critical review");

    await waitFor(() => expect(requests.at(-1)?.query_text).toBe("critical review"));
    expect(requests.at(-1)?.resource_type).toBe("task");
  });

  it("opens the saved-search module inside the explorer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });

    await user.click(await screen.findByRole("button", { name: /Saved searches/ }));
    expect(await screen.findByText("No saved searches for this dataset")).toBeInTheDocument();
  });

  it("answers a saved search on a dashboard without re-asking it (§45)", async () => {
    const user = userEvent.setup();
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.get("/platform/api/saved-searches", () =>
        HttpResponse.json({ items: [savedViews[0]], total: 1 }),
      ),
      http.post("/platform/api/dashboards/:id/widgets", async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(savedDashboards[0], { status: 201 });
      }),
    );
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });

    await user.click(await screen.findByRole("button", { name: /Saved searches/ }));
    await user.click(
      await screen.findByRole("button", { name: /Add In progress, mine first to a dashboard/ }),
    );
    await user.click(await screen.findByRole("radio", { name: /Support desk/ }));
    await user.click(screen.getByTestId("add-to-dashboard-confirm"));

    // The search itself, not a copy of its filters: a widget holding the
    // conditions would answer yesterday's question after the search is edited.
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      kind: "SEARCH",
      config: { search_id: savedViews[0]!.id },
    });
  });

  it("ticks rows and acts on them where the question was asked (§43, §75)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });
    // A *row*, not the table: the table renders as soon as the columns are
    // known, and the only checkbox on screen then is the header's.
    await screen.findByText("Review customer migration");

    const table = screen.getByRole("table");
    const boxes = within(table).getAllByRole("checkbox");
    // Every tick box is named. AntD names the header's and leaves the rows
    // unnamed, which a screen reader reads as a column of identical
    // "checkbox"es — and axe reports as a missing label.
    expect(boxes.at(-1)).toHaveAccessibleName(/^Select /);
    await user.click(boxes.at(-1)!);

    // The bar appears only once something is ticked, and says what it covers.
    expect(await screen.findByTestId("bulk-bar")).toBeInTheDocument();
  });

  it("stars a record from the results, into the one favourites store (§38)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });
    await screen.findByRole("table");

    const stars = await screen.findAllByRole("button", { name: /^Star / });
    await user.click(stars[0]!);

    // Unstarring is the same control, which is what tells the reader it took.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Unstar / }).length).toBeGreaterThan(0),
    );
  });

  it("opens the rules drawer from ?mode=advanced and applies the tree (§4)", async () => {
    const user = userEvent.setup();
    const sent: Array<Record<string, unknown>> = [];
    server.use(http.post("/platform/api/explorer/query", async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      sent.push(body);
      return HttpResponse.json({
        items: [], total: 3, page: 1, page_size: 25, pages: 1,
        sort: "updated_at", order: "desc", resource_type: "task",
        columns: [], fields: [], facets: {},
        condition_text: body.condition_tree ? "Status = 'NEW'" : "", rule_count: 0,
        query_text: "", searchable: [],
      });
    }));
    const tree = encodeURIComponent(JSON.stringify({
      id: "r", type: "group", properties: { conjunction: "AND" },
      children1: { a: { id: "a", type: "rule", properties: { field: "status", operator: "select_equals", value: ["NEW"] } } },
    }));
    renderWithProviders(<DataExplorerPage />, { route: `/explore?resource=task&tree=${tree}&mode=advanced` });

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Find")).toBeInTheDocument();
    expect(within(drawer).getByText("Where")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("query-inspector")).toHaveTextContent("Status = 'NEW'"));
    // A second, unfinished filter is muted and skipped, not an error.
    await user.click(within(drawer).getByRole("button", { name: "+ Add filter" }));
    expect(await within(drawer).findByRole("group", { name: /incomplete/ })).toHaveClass("is-incomplete");

    await user.click(screen.getByTestId("run-advanced-search"));
    expect(await screen.findByTestId("condition-chips")).toBeInTheDocument();
    await waitFor(() => expect(sent.at(-1)?.condition_tree).toBeTruthy());
  });

  it("starts with recent searches as chips, and a chip asks a filter", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("nucleus.search.recent.task", JSON.stringify(["migration"]));
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });

    await waitFor(() => expect(screen.getByTestId("rules-dataset")).toHaveTextContent("Tasks"));
    expect(await screen.findByText("Recent searches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove recent search: migration" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /status: new/ }));
    expect(await screen.findByTestId("condition-chips")).toHaveTextContent("Status");
  });

  it("walks back out of drawers one at a time: Saved → Rules → the page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });

    await user.click(await screen.findByTestId("open-rules"));
    expect(await screen.findByRole("button", { name: "Load a saved search" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load a saved search" }));
    // Opened from Rules, the saved list offers the way back to them.
    await user.click(await screen.findByTestId("saved-back"));
    expect(await screen.findByRole("button", { name: "Load a saved search" })).toBeInTheDocument();
    expect(screen.queryByTestId("saved-back")).not.toBeInTheDocument();
  });
});
