import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import KanbanPage from "@/pages/KanbanPage";
import { kanbanBoards, kanbanLanes, resetKanban } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The kanban page's board-level work (§64): switching and archiving boards,
 * every lane setting, the filters and their empty answer, and the failures a
 * board can meet — including a move the server refuses, which snaps back.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/kanban?board=board-1") {
  return renderWithProviders(
    <>
      <Address />
      <Routes>
        <Route path="/kanban" element={<KanbanPage />} />
      </Routes>
    </>,
    { route },
  );
}

afterEach(() => resetKanban());

const lane = (id: string) => kanbanLanes.find((item) => item["id"] === id)!;

async function laneAction(laneId: string, item: RegExp) {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId(`lane-actions-${laneId}`));
  await user.click(await screen.findByRole("menuitem", { name: item }));
  return user;
}

describe("a board's own settings", () => {
  it("switches boards from the picker", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("kanban-board");
    await user.click(screen.getByRole("combobox", { name: "Board" }));
    const option = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((node) => node.textContent?.startsWith("Support improvements"));
      if (!found) throw new Error("no second board");
      return found;
    });
    await user.click(option);
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("board=board-2"));
    expect(await screen.findByText("This board is empty")).toBeInTheDocument();
  });

  it("archives a board, and deletes one after asking", async () => {
    const user = userEvent.setup();
    let archived: unknown = null;
    server.use(
      http.put("/platform/api/kanban/boards/:id", async ({ request }) => {
        archived = ((await request.json()) as { is_archived?: boolean }).is_archived;
        return HttpResponse.json(kanbanBoards[0]);
      }),
      http.delete("/platform/api/kanban/boards/:id", () => HttpResponse.json({ deleted: true })),
    );
    render();
    await screen.findByTestId("kanban-board");
    await user.click(screen.getByTestId("board-actions"));
    await user.click(await screen.findByRole("menuitem", { name: /Archive board/ }));
    await waitFor(() => expect(archived).toBe(true));

    await user.click(screen.getByTestId("board-actions"));
    await user.click(await screen.findByRole("menuitem", { name: /Delete board/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByTestId("address")).not.toHaveTextContent("board=board-1"));
  });

  it("adds a lane from the board's menu", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("kanban-board");
    await user.click(screen.getByTestId("board-actions"));
    await user.click(await screen.findByRole("menuitem", { name: /Add a lane/ }));
    await user.type(await screen.findByLabelText("Lane name"), "Ünïcode review");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(kanbanLanes.some((item) => item["name"] === "Ünïcode review")).toBe(true));
  });
});

describe("a lane's settings", () => {
  it("renames a lane", async () => {
    render();
    const user = await laneAction("lane-1", /Rename this lane/);
    const dialog = await screen.findByRole("dialog", { name: "Rename Backlog" });
    const name = within(dialog).getByRole("textbox");
    await user.clear(name);
    await user.type(name, "Ideas");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(lane("lane-1")["name"]).toBe("Ideas"));
  });

  it("sets and clears a work-in-progress limit", async () => {
    render();
    const user = await laneAction("lane-1", /Set a work-in-progress limit/);
    const dialog = await screen.findByRole("dialog", { name: /Work-in-progress limit for Backlog/ });
    fireEvent.change(within(dialog).getByLabelText("Work-in-progress limit"), { target: { value: "3" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lane("lane-1")["wip_limit"]).toBe(3));
  });

  it("makes a lane the done lane", async () => {
    render();
    await laneAction("lane-1", /Make this the done lane/);
    await waitFor(() => expect(lane("lane-1")["is_done"]).toBe(true));
  });

  it("removes a lane, moving its cards and saying where", async () => {
    render();
    const user = await laneAction("lane-2", /2 cards move/);
    await user.click(await screen.findByRole("button", { name: "Remove the lane" }));
    expect(await screen.findByText(/Lane removed — 2 cards moved to/)).toBeInTheDocument();
  });
});

describe("filtering the board", () => {
  it("narrows by kind, says when nothing matches, and clears", async () => {
    const user = userEvent.setup();
    render("/kanban?board=board-1&q=ζζζ-nothing");
    expect(await screen.findByText("Nothing matches those filters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.getByTestId("address")).not.toHaveTextContent("q="));
  });

  it("chooses a kind from the filter", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("kanban-board");
    await user.click(screen.getByRole("combobox", { name: "Kind" }));
    const option = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((node) => node.textContent === "Epic");
      if (!found) throw new Error("no Epic");
      return found;
    });
    await user.click(option);
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("kind=EPIC"));
  });
});

describe("when something fails", () => {
  it("says the boards could not be loaded, and retries", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get("/platform/api/kanban/boards", () => {
        calls += 1;
        return HttpResponse.json({ error: "forbidden", message: "Boards are not in your role." }, { status: 403 });
      }),
    );
    render();
    expect(await screen.findByText("Boards are not in your role.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
  });

  it("says a board could not be opened", async () => {
    server.use(
      http.get("/platform/api/kanban/boards/:id", () =>
        HttpResponse.json({ error: "not_found", message: "That board is gone." }, { status: 404 }),
      ),
    );
    render("/kanban?board=gone");
    expect(await screen.findByText("That board is gone.")).toBeInTheDocument();
  });

  it("snaps a refused move back and says why", async () => {
    server.use(
      http.post("/platform/api/kanban/cards/:id/move", () =>
        HttpResponse.json({ error: "conflict", message: "That lane is locked." }, { status: 409 }),
      ),
    );
    render();
    const card = await screen.findByTestId("card-card-1");
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: " " });
    expect(await screen.findByText("That lane is locked.")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId("lane-lane-1")).getByTestId("card-card-1")).toBeInTheDocument());
  });

  it("reports a refused lane change in the server's words", async () => {
    server.use(
      http.put("/platform/api/kanban/lanes/:id", () =>
        HttpResponse.json({ error: "forbidden", message: "Only the board's owner may change lanes." }, { status: 403 }),
      ),
    );
    render();
    await laneAction("lane-1", /Make this the done lane/);
    expect(await screen.findByText("Only the board's owner may change lanes.")).toBeInTheDocument();
  });
});
