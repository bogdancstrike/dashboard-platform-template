import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
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
});
