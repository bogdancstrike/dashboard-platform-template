import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import DataExplorerPage from "@/pages/DataExplorerPage";
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
      });
    }));
    const user = userEvent.setup();
    renderWithProviders(<DataExplorerPage />, { route: "/explore?resource=task" });

    const search = await screen.findByPlaceholderText("Search tasks…");
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
});
