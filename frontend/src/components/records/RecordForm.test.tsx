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
    expect(await screen.findByTitle("New")).toBeInTheDocument();
    expect(await screen.findByTitle("Done")).toBeInTheDocument();
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

/** The board's own write: where a card sits, by its neighbours (§18). */
function capturePlace(bodies: Record<string, unknown>[]) {
  server.use(
    http.post("/platform/api/tasks/:id/place", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({
        id: params["id"],
        status: body["status"],
        board_position: 1536,
        updated_at: new Date().toISOString(),
      });
    }),
  );
}

describe("moving a card between lanes", () => {
  it("writes the task's status and reconciles the lanes against the server", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePlace(bodies);

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
    await carryByKeyboard(user, board, /Review customer migration/, "done");

    await waitFor(() => expect(bodies).toHaveLength(1));
    // The lane and the neighbours it landed between — not a number the
    // browser made up from the dozen cards it happened to have loaded.
    expect(bodies[0]).toMatchObject({ status: "DONE" });
    expect(bodies[0]).toHaveProperty("after_id");
    expect(bodies[0]).toHaveProperty("before_id");
    // The lane totals are aggregates only the database can compute, so every
    // lane is asked again rather than adjusted in the browser.
    await waitFor(() => expect(laneQueries).toBeGreaterThan(before));
  });

  it("reorders within a lane, between the two cards it was dropped between", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePlace(bodies);
    // A lane with two cards in it: the fixture's own card and a second one
    // under it, so there is an order to change.
    server.use(
      http.post("/platform/api/explorer/query", async ({ request }) => {
        const body = (await request.json()) as Parameters<typeof entityResult>[0];
        const result = entityResult(body);
        const [only] = result.items;
        if (body.filters?.["status"] && only) {
          const twin = { ...only, id: `${String(only["id"])}-twin`, title: "The card below" };
          return HttpResponse.json({ ...result, items: [only, twin], total: 2 });
        }
        return HttpResponse.json(result);
      }),
    );

    renderBoard();
    const board = await screen.findByTestId("task-board");
    await within(board).findByRole("article", { name: /The card below/ });
    // A lane with two cards in it, whichever the fixture puts them in.
    const list = Array.from(board.querySelectorAll("[data-drop-list]")).find(
      (element) => element.querySelectorAll("[data-drag-id]").length >= 2,
    );
    expect(list).toBeDefined();
    const [first, second] = Array.from(list!.querySelectorAll<HTMLElement>("[data-drag-id]"));
    const lane = list!.getAttribute("data-drop-list");

    second!.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByTestId("drag-announcer")).toHaveTextContent(/Over .*position 1/);
    await user.keyboard(" ");

    await waitFor(() => expect(bodies).toHaveLength(1));
    // One step up: the top of the lane, directly above the card that led it.
    expect(bodies[0]).toMatchObject({
      status: lane,
      after_id: null,
      before_id: first!.getAttribute("data-drag-id"),
    });
  });

  it("explains a refused move instead of quietly snapping the card back", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/platform/api/tasks/:id/place", () =>
        HttpResponse.json(
          { error: "conflict", message: "Somebody else moved it.", details: {} },
          { status: 409 },
        ),
      ),
    );

    renderBoard();
    const board = await screen.findByTestId("task-board");
    await carryByKeyboard(user, board, /Review customer migration/, "done");

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

/**
 * Pick a card up with Space, walk it right with the arrows until the live
 * region says it is over `lane`, and drop it with Space — the way somebody
 * without a pointer moves a card now that there is no menu for it.
 */
async function carryByKeyboard(
  user: ReturnType<typeof userEvent.setup>,
  board: HTMLElement,
  card: RegExp,
  lane: string,
) {
  const tile = within(board).getByRole("article", { name: card });
  tile.focus();
  await user.keyboard(" ");
  const announcer = screen.getByTestId("drag-announcer");
  expect(announcer).toHaveTextContent(/Picked up/);
  for (let step = 0; step < 10 && !new RegExp(`Over ${lane},`).test(announcer.textContent ?? ""); step += 1) {
    await user.keyboard("{ArrowRight}");
  }
  expect(announcer).toHaveTextContent(new RegExp(`Over ${lane},`));
  await user.keyboard(" ");
}
