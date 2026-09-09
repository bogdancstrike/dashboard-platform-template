import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import EntityDetailPage from "@/pages/EntityDetailPage";
import TasksBoardPage from "@/pages/entities/TasksBoardPage";
import { CommandProvider } from "@/commands/CommandContext";
import { entityResult, explorerCatalogue, recordDetail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Writing a record (§9, §73, §74).
 *
 * What is worth asserting is not that a drawer opens — it is the three
 * promises the form makes to the server and to the reader: it sends only what
 * changed, it says which version it edited, and it does not offer a control
 * for something the role cannot do.
 */
function renderDetail() {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tasks/:id" element={<EntityDetailPage resourceKey="task" />} />
        <Route path="/tasks" element={<div>the board</div>} />
      </Routes>
    </CommandProvider>,
    { route: "/tasks/task-1" },
  );
}

function renderBoard() {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tasks" element={<TasksBoardPage />} />
        <Route path="/tasks/:id" element={<div>the record</div>} />
      </Routes>
    </CommandProvider>,
    { route: "/tasks" },
  );
}

/** Captures what a PUT actually carried. */
function capturePut(bodies: Record<string, unknown>[], response?: () => Response) {
  server.use(
    http.put("/platform/api/records/:type/:id", async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return response ? response() : HttpResponse.json({ ...recordDetail, status: "DONE" });
    }),
  );
}

describe("the edit form", () => {
  it("sends only the fields that changed, and the version it was editing", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePut(bodies);

    renderDetail();
    await user.click(await screen.findByTestId("record-edit"));

    const drawer = await screen.findByRole("dialog");
    const title = await within(drawer).findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Review the migration plan");
    await user.click(within(drawer).getByTestId("record-form-save"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // Status and progress were rendered and untouched, so they do not travel:
    // a payload carrying every field overwrites what somebody else moved
    // while the drawer was open.
    expect(bodies[0]).toEqual({
      title: "Review the migration plan",
      expected_updated_at: recordDetail.updated_at,
    });
  });

  it("offers the vocabulary the catalogue declares, not the value the record happens to hold", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByTestId("record-edit"));

    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("combobox", { name: "Status" }));

    // NEW and DONE are in the declared vocabulary and absent from this record.
    expect(await screen.findByTitle("NEW")).toBeInTheDocument();
    expect(await screen.findByTitle("DONE")).toBeInTheDocument();
  });

  it("says what the server refused, with its correlation id", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/platform/api/records/:type/:id", () =>
        HttpResponse.json(
          {
            error: "conflict",
            message: "Somebody else changed this task while you were editing it.",
            details: {},
          },
          { status: 409 },
        ),
      ),
    );

    renderDetail();
    await user.click(await screen.findByTestId("record-edit"));
    const drawer = await screen.findByRole("dialog");
    await user.type(await within(drawer).findByLabelText("Title"), "!");
    await user.click(within(drawer).getByTestId("record-form-save"));

    expect(
      await screen.findByText("Somebody else changed this task while you were editing it."),
    ).toBeInTheDocument();
  });

  it("guards a close that would discard unsaved changes (§74)", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByTestId("record-edit"));

    const drawer = await screen.findByRole("dialog");
    await user.type(await within(drawer).findByLabelText("Title"), " (draft)");
    await user.click(within(drawer).getByRole("button", { name: "Cancel" }));

    expect(await screen.findAllByText("Discard your changes?")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeInTheDocument();
  });

  it("shows the controls disabled with the permission named, rather than hiding them", async () => {
    server.use(
      http.get("/platform/api/records/:type/:id", () =>
        HttpResponse.json({ ...recordDetail, can_edit: false, can_delete: false }),
      ),
    );

    renderDetail();

    // §76: a hidden button teaches nobody that the feature exists.
    expect(await screen.findByTestId("record-edit")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeDisabled();
  });
});

describe("moving a card between lanes", () => {
  it("writes the task's status and reconciles the lanes against the server", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePut(bodies);

    let laneQueries = 0;
    server.use(
      http.post("/platform/api/explorer/query", async ({ request }) => {
        const body = (await request.json()) as { filters?: Record<string, string> };
        if (body.filters?.["status"]) laneQueries += 1;
        return HttpResponse.json(entityResult(body));
      }),
    );

    renderBoard();
    const board = await screen.findByTestId("task-board");
    await waitFor(() => expect(laneQueries).toBeGreaterThan(0));
    const before = laneQueries;

    // The keyboard path, which is the same call the drop makes (§54).
    await user.click(
      within(board).getByRole("button", { name: /Move Review customer migration/ }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "DONE" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ status: "DONE" });
    // The lane totals are aggregates only the database can compute, so every
    // lane is asked again rather than adjusted in the browser.
    await waitFor(() => expect(laneQueries).toBeGreaterThan(before));
  });

  it("explains a refused move instead of quietly snapping the card back", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/platform/api/records/:type/:id", () =>
        HttpResponse.json(
          { error: "conflict", message: "Somebody else moved it.", details: {} },
          { status: 409 },
        ),
      ),
    );

    renderBoard();
    const board = await screen.findByTestId("task-board");
    await user.click(
      within(board).getByRole("button", { name: /Move Review customer migration/ }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "DONE" }));

    expect(await screen.findByText(/moved on somebody else's screen/)).toBeInTheDocument();
  });

  it("says the board is read-only when the role cannot write records", async () => {
    server.use(
      http.get("/platform/api/explorer/catalog", () =>
        HttpResponse.json({
          ...explorerCatalogue,
          items: explorerCatalogue.items.map((item) => ({
            ...item,
            can_create: false,
            can_edit: false,
            can_delete: false,
          })),
        }),
      ),
    );

    renderBoard();

    expect(await screen.findByText("This board is read-only for you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New task/ })).toBeDisabled();
  });
});
