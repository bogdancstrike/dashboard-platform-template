import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import EntityDetailPage from "@/pages/EntityDetailPage";
import { CommandProvider } from "@/commands/CommandContext";
import { recordDetail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

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
