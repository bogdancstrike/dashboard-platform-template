import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import ProjectDeliveryPage from "@/pages/entities/ProjectDeliveryPage";
import { CommandProvider } from "@/commands/CommandContext";
import { projectRecord, resetComments } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The project delivery review (§8, §44, §48).
 *
 * What is worth asserting is that it is a *review* and not a field dump: it
 * names the gap between the money and the work rather than printing both and
 * leaving the reader to subtract, its rollup is the server's count of the
 * whole queue rather than of the rows it downloaded, and the controls a review
 * actually changes write without opening a form.
 */
function render(route = "/projects/project-1") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDeliveryPage />} />
        <Route path="/projects" element={<div>the portfolio</div>} />
        <Route path="/tasks" element={<div>the board</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetComments());

/** The work under this project, as the analysis endpoint groups it. */
function laneCounts(rows: { status: string; count: number }[]) {
  server.use(
    http.post("/platform/api/analysis/run", () =>
      HttpResponse.json({
        resource_type: "task",
        resource_label: "Tasks",
        path: "/tasks",
        dimensions: [{ field: "status", label: "Status", kind: "enum", granularity: "" }],
        measures: [{ key: "count", label: "record count", aggregation: "count", field: "", format: "number" }],
        rows: rows.map((row) => ({ keys: [row.status], values: { count: row.count } })),
        totals: { count: rows.reduce((sum, row) => sum + row.count, 0) },
        matched: rows.reduce((sum, row) => sum + row.count, 0),
        truncated: false,
        other: null,
        period: { key: "all_time", field: "created_at", from: null, to: null },
        description: "record count of tasks",
        generated_at: "2026-09-06T12:00:00Z",
      }),
    ),
  );
}

/** Captures what the review wrote to the record. */
function capturePut(bodies: Record<string, unknown>[]) {
  server.use(
    http.put("/platform/api/records/:type/:id", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({ ...projectRecord, ...body });
    }),
  );
}

describe("the project delivery review", () => {
  it("names the gap between the money and the work", async () => {
    render();

    // 380k of a 400k budget spent to deliver 62% is the finding the page
    // exists for, and it is a sentence rather than three numbers to subtract.
    const summary = await screen.findByTestId("delivery-summary");
    expect(summary).toHaveTextContent("62% delivered");
    expect(summary).toHaveTextContent("95% of the budget spent");
    expect(summary).toHaveTextContent("running behind");

    const standing = screen.getByTestId("delivery-standing");
    expect(within(standing).getByText("Delivered")).toBeInTheDocument();
    expect(within(standing).getByText("Schedule")).toBeInTheDocument();
    expect(within(standing).getByText(/380,000 EUR of 400,000 EUR/)).toBeInTheDocument();
  });

  it("counts the whole work queue, not the rows it downloaded", async () => {
    laneCounts([
      { status: "NEW", count: 12 },
      { status: "IN_PROGRESS", count: 5 },
      { status: "DONE", count: 143 },
    ]);
    render();

    const work = await screen.findByTestId("project-work");
    // 160 tasks, of which the table below shows the soonest handful — the
    // lane counts describe the queue, not the page.
    expect(within(work).getByText("all 160 tasks")).toBeInTheDocument();
    expect(within(work).getByText("143")).toBeInTheDocument();

    // Every lane leads to the board already filtered, rather than being a
    // second board embedded here.
    expect(within(work).getByRole("link", { name: /143.*DONE/s })).toHaveAttribute(
      "href",
      "/tasks?f.project_id=project-1&f.status=DONE",
    );
  });

  it("changes the health without opening a form, and sends the version it read", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePut(bodies);

    render();
    const review = await screen.findByTestId("project-review");
    await user.click(within(review).getByRole("combobox", { name: "Health" }));
    await user.click(await screen.findByTitle("OFF TRACK"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      health: "OFF_TRACK",
      expected_updated_at: projectRecord.updated_at,
    });
  });

  it("says nothing has been raised rather than drawing an empty rollup", async () => {
    laneCounts([]);
    render();

    expect(
      await screen.findByText("No work has been raised under this project yet"),
    ).toBeInTheDocument();
  });

  it("shows the controls disabled, with the permission named, to a reader", async () => {
    server.use(
      http.get("/platform/api/records/project/:id", () =>
        HttpResponse.json({ ...projectRecord, can_edit: false, can_delete: false }),
      ),
    );
    render();

    // Shown and refused, never hidden: a missing button teaches nobody that
    // the feature exists (§76).
    expect(await screen.findByTestId("record-edit")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeDisabled();
    const review = screen.getByTestId("project-review");
    expect(within(review).getByRole("combobox", { name: "Health" })).toBeDisabled();
  });

  it("explains a project it cannot open, with the id to quote", async () => {
    server.use(
      http.get("/platform/api/records/project/:id", () =>
        HttpResponse.json(
          { error: "not_found", message: "That project does not exist." },
          { status: 404 },
        ),
      ),
    );
    render();

    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    expect(
      screen.getByText("It may have been deleted, or the link may be wrong."),
    ).toBeInTheDocument();
  });
});
