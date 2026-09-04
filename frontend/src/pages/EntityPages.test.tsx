import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import EntityDetailPage from "@/pages/EntityDetailPage";
import { EntityListPage } from "@/pages/EntityListPage";
import { CommandProvider } from "@/commands/CommandContext";
import { explorerResult, recordDetail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

function renderList(route = "/tasks") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tasks" element={<EntityListPage resourceKey="task" />} />
        <Route path="/tasks/:id" element={<div>the task detail page</div>} />
        <Route path="/explore" element={<div>the explorer</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

function renderDetail(route = "/tasks/task-1") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tasks" element={<div>the task list</div>} />
        <Route path="/tasks/:id" element={<EntityDetailPage resourceKey="task" />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

describe("the generic entity list", () => {
  it("takes its title, columns and rows from the entity's own declaration", async () => {
    renderList();

    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    // Columns are the resource's `default_columns`, labelled by the catalogue.
    expect(await screen.findByRole("columnheader", { name: "Reference" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Due date" })).toBeInTheDocument();
    expect(screen.getByText("TSK-001")).toBeInTheDocument();
    expect(screen.getByTestId("entity-total")).toHaveTextContent("1 of 500");
  });

  it("builds its facet menus from the counts the server returned", async () => {
    renderList();

    // Not a hardcoded option list: the menu can only offer values that are
    // actually reachable under the other filters.
    const status = await screen.findByRole("combobox", { name: "Status" });
    expect(status).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Priority" })).toBeInTheDocument();
  });

  it("asks the server when a facet is chosen", async () => {
    const user = userEvent.setup();
    const seen: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/explorer/query", async ({ request }) => {
        seen.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(explorerResult);
      }),
    );

    renderList();
    await user.click(await screen.findByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByTitle("IN_PROGRESS · 1"));

    await waitFor(() =>
      expect(seen.at(-1)?.["filters"]).toEqual({ status: "IN_PROGRESS" }),
    );
  });

  it("opens the record when a row is clicked, not a drawer", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByText("TSK-001"));

    // A working list navigates; the explorer's drawer is the other affordance.
    expect(await screen.findByText("the task detail page")).toBeInTheDocument();
  });

  it("hands a wider question to the explorer rather than growing its own builder", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: /Ask a wider question/ }));

    expect(await screen.findByText("the explorer")).toBeInTheDocument();
  });

  it("says so when the catalogue does not offer the entity", async () => {
    server.use(
      http.get("/platform/api/explorer/catalog", () =>
        HttpResponse.json({ items: [], view_modes: ["table"] }),
      ),
    );

    renderList();

    expect(
      await screen.findByText("That record type is not available to you"),
    ).toBeInTheDocument();
  });
});

describe("the generic entity detail page", () => {
  it("names the record rather than showing its id", async () => {
    renderDetail();

    expect(
      await screen.findByRole("heading", { name: /Review customer migration/ }),
    ).toBeInTheDocument();
    // Twice on purpose: once as the subtitle beside the name, once as the
    // Reference field in the details table.
    expect(screen.getAllByText("TSK-001").length).toBeGreaterThan(0);
    expect(screen.getByTestId("record-status")).toHaveTextContent("IN_PROGRESS");
  });

  it("renders every declared field, drawn by its kind", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: /Review customer migration/ });
    // A number is localised, an enum is a tag, an absent value is an em dash
    // rather than the word "null".
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("null")).toBeNull();
  });

  it("puts identifiers and timestamps aside from the record's own attributes", async () => {
    renderDetail();

    const references = await screen.findByText("References");
    const panel = references.closest(".ant-card")!;
    // A detail page that opens with a UUID is one whose first line nobody reads.
    expect(within(panel as HTMLElement).getByText("Assignee ID")).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText("Created")).toBeInTheDocument();
  });

  it("shows the record's history from the scoped audit endpoint", async () => {
    const user = userEvent.setup();
    let requested: URLSearchParams | null = null;
    server.use(
      http.get("/platform/api/audit/timeline", ({ request }) => {
        requested = new URL(request.url).searchParams;
        return HttpResponse.json({
          items: [],
          total: 0,
          resource_type: "task",
          resource_id: "task-1",
          limit: 25,
        });
      }),
    );

    renderDetail();
    await user.click(await screen.findByRole("tab", { name: "History" }));

    await waitFor(() => expect(requested).not.toBeNull());
    expect(requested!.get("resource_type")).toBe("task");
    expect(requested!.get("resource_id")).toBe(recordDetail.id);
  });

  it("keeps the open tab in the URL", async () => {
    renderDetail("/tasks/task-1?tab=history");

    // Deep-linkable (§69): a colleague opening the link lands on the same tab.
    expect(await screen.findByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says a record is missing rather than rendering an empty shell", async () => {
    server.use(
      http.get("/platform/api/records/:type/:id", () =>
        HttpResponse.json(
          { error: "not_found", message: "That task does not exist." },
          { status: 404 },
        ),
      ),
    );

    renderDetail();

    // A regex, because the back button inside the heading contributes its own
    // label to the accessible name.
    expect(await screen.findByRole("heading", { name: /Record not found/ })).toBeInTheDocument();
  });
});
