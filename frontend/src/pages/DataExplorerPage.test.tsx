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
});
