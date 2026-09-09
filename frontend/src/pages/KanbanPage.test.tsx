import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { Route, Routes, useLocation } from "react-router-dom";

import KanbanPage, { withCardMoved } from "@/pages/KanbanPage";
import { CommandProvider } from "@/commands/CommandContext";
import type { KanbanLane } from "@/api/kanban";
import { kanbanCards, kanbanLanes, resetKanban } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The kanban board (§18).
 *
 * What is worth asserting is what makes a board trustworthy: that a lane's
 * header carries the *server's* count and its over-limit warning, that a card
 * shows only the facts it has, that the keyboard route moves a card exactly as
 * the drag does, and that the optimistic arithmetic renumbers the way the
 * service does — which is a pure function, tested as one.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/kanban?board=board-1") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/kanban" element={<KanbanPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetKanban());

describe("the board's optimistic arithmetic", () => {
  /**
   * The smallest board the arithmetic needs.
   *
   * Typed as the function's own parameter rather than cast away: `as never`
   * silenced the shape but also silenced the *result*, so every assertion
   * below became `any` and would have kept passing if the function started
   * returning nonsense.
   */
  const board: { lanes: KanbanLane[] } = {
    lanes: [
      {
        id: "a",
        name: "A",
        position: 0,
        wip_limit: null,
        is_done: false,
        total: 2,
        over_limit: false,
        cards: [
          { id: "1", lane_id: "a", position: 0 },
          { id: "2", lane_id: "a", position: 1 },
        ],
      },
      {
        id: "b",
        name: "B",
        position: 1,
        wip_limit: null,
        is_done: false,
        total: 1,
        over_limit: false,
        cards: [{ id: "3", lane_id: "b", position: 0 }],
      },
    ] as unknown as KanbanLane[],
  };

  it("renumbers both lanes densely, exactly as the service does", () => {
    // The guess has to match the server or the refetch "corrects" it and the
    // correction looks like a bug in the drag.
    const next = withCardMoved(board, "1", "b", 0);
    const [a, b] = next.lanes;

    expect(a?.cards.map((card) => card.id)).toEqual(["2"]);
    expect(a?.cards.map((card) => card.position)).toEqual([0]);
    expect(b?.cards.map((card) => card.id)).toEqual(["1", "3"]);
    expect(b?.cards.map((card) => card.position)).toEqual([0, 1]);
  });

  it("moves the count with the card, so the header cannot disagree", () => {
    const next = withCardMoved(board, "1", "b", 0);
    expect(next.lanes[1]?.total).toBe(2);
  });

  it("reorders within one lane without changing its count", () => {
    const next = withCardMoved(board, "2", "a", 0);
    expect(next.lanes[0]?.cards.map((card) => card.id)).toEqual(["2", "1"]);
    expect(next.lanes[0]?.total).toBe(2);
  });

  it("leaves the board alone when the card is not on it", () => {
    expect(withCardMoved(board, "nope", "b", 0)).toBe(board);
  });

  it("clamps a position past the end rather than leaving a gap", () => {
    const next = withCardMoved(board, "1", "b", 99);
    expect(next.lanes[1]?.cards.map((card) => card.position)).toEqual([0, 1]);
  });
});

describe("the kanban board", () => {
  it("draws every lane with the count the server computed", async () => {
    render();

    const board = await screen.findByTestId("kanban-board");
    for (const name of ["Backlog", "In progress", "Done"]) {
      expect(within(board).getByLabelText(name)).toBeInTheDocument();
    }
    // Two cards in a lane whose limit is one — the count is `total/limit`.
    expect(within(screen.getByTestId("lane-lane-2")).getByText("2/1")).toBeInTheDocument();
  });

  it("says a lane is over its limit, in words, and stops nothing", async () => {
    render();

    const lane = await screen.findByTestId("lane-lane-2");
    // Colour alone is not a fact (§64), and the sentence is what says the
    // board is not refusing anything.
    expect(within(lane).getByText(/Over its limit of 1/)).toBeInTheDocument();
    expect(within(lane).getByText(/Nothing is stopping you/)).toBeInTheDocument();
  });

  it("puts only the facts a card has on its face", async () => {
    render();

    // A story with a priority, an assignee and a checklist shows all three.
    const story = await screen.findByTestId("card-card-2");
    expect(within(story).getByText("high")).toBeInTheDocument();
    expect(within(story).getByText("MM")).toBeInTheDocument();
    expect(within(story).getByText("1/2")).toBeInTheDocument();

    // An epic with none of them shows none of them, rather than empty slots.
    const epic = screen.getByTestId("card-card-1");
    expect(within(epic).queryByText("high")).not.toBeInTheDocument();
    expect(within(epic).getByText("8")).toBeInTheDocument();
  });

  it("moves a card from the keyboard, through the same call as the drag", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("kanban-board");
    const card = screen.getByTestId("card-card-1");
    await user.click(within(card).getByRole("button", { name: "Move PLAT-00001" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to Done" }));

    // The write landed, and the lane came with it.
    await waitFor(() =>
      expect(kanbanCards.find((item) => item["id"] === "card-1")?.["lane_id"]).toBe("lane-3"),
    );
    // Arriving in the done lane completes the card — the same rule the
    // service applies, so the board and every report agree.
    expect(kanbanCards.find((item) => item["id"] === "card-1")?.["completed_at"]).not.toBeNull();
  });

  it("adds a card with one field, in place", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("kanban-board");
    await user.click(screen.getByTestId("add-card-lane-1"));
    await user.type(await screen.findByTestId("new-card-lane-1"), "Write the handbook{Enter}");

    await waitFor(() =>
      expect(kanbanCards.some((item) => item["title"] === "Write the handbook")).toBe(true),
    );
  });

  it("names a lane somebody adds — the thing the task board cannot do", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("kanban-board");
    await user.click(screen.getByTestId("add-lane"));
    await user.type(await screen.findByLabelText("Lane name"), "Blocked");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(kanbanLanes.some((item) => item["name"] === "Blocked")).toBe(true),
    );
  });

  it("says what happens to the work before a lane is removed", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("kanban-board");
    await user.click(screen.getByTestId("lane-actions-lane-2"));
    // The menu item itself says how many cards move — that is the question
    // somebody is actually asking.
    await user.click(await screen.findByRole("menuitem", { name: /2 cards move/ }));
    expect(await screen.findByText(/2 cards will move\. Nothing is deleted\./)).toBeInTheDocument();
  });

  it("filters the board in the address, so a narrowed view is a link", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("kanban-board");
    await user.click(screen.getByRole("combobox", { name: "Kind" }));
    await user.click(await screen.findByTitle("Bug"));

    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("kind=BUG"));
    // Only the bug is left, and the counts followed it.
    await waitFor(() =>
      expect(screen.queryByTestId("card-card-1")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("card-card-3")).toBeInTheDocument();
  });

  it("opens a card in a drawer, with its family and its checklist", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("kanban-board");
    await user.click(within(screen.getByTestId("card-card-2")).getByText("Save a chart from the builder"));

    const drawer = await screen.findByRole("dialog");
    // A drawer rather than a route: the board stays behind it, and "what else
    // is in this lane" is half of why the card was opened.
    expect(within(drawer).getByText("PLAT-00002")).toBeInTheDocument();
    expect(within(drawer).getByText(/Part of/)).toBeInTheDocument();
    expect(within(drawer).getByRole("checkbox", { name: "Reviewed" })).toBeChecked();
    expect(within(drawer).getByRole("checkbox", { name: "Tested" })).not.toBeChecked();
  });

  it("ticks a to-do as an edit to the card", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("kanban-board");
    await user.click(within(screen.getByTestId("card-card-2")).getByText("Save a chart from the builder"));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("checkbox", { name: "Tested" }));

    // Written to the card, not held on the page — a "checklist API" would be
    // a second set of rules about who may tick a box.
    await waitFor(() =>
      expect(kanbanCards.find((item) => item["id"] === "card-2")?.["checklist_done"]).toBe(2),
    );
  });

  it("offers as a parent only what the hierarchy permits", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("kanban-board");
    await user.click(within(screen.getByTestId("card-card-2")).getByText("Save a chart from the builder"));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("combobox", { name: "Parent" }));

    // A story may sit under an epic and nothing else, and the options come
    // from the server's own rule (§76).
    //
    // Scoped to the dropdown's own options: AntD puts the same `title` on the
    // closed select's label, so matching by title alone finds both as soon as
    // one is chosen — which is the state a re-run leaves behind.
    await waitFor(() =>
      expect(document.querySelectorAll(".ant-select-item-option").length).toBeGreaterThan(0),
    );
    const options = [...document.querySelectorAll(".ant-select-item-option")];
    expect(options.map((option) => option.textContent)).toEqual([
      "PLAT-00001 Self-service reporting",
    ]);
  });

  it("shows the gallery when the address names no board", async () => {
    render("/kanban?board=none");
    // A board that does not exist is not a reason to draw nothing: the picker
    // is still there, and so is every board this reader can open.
    expect(await screen.findByTestId("board-picker")).toBeInTheDocument();
  });

  /**
   * A tile says what is on the card besides its title (§18).
   *
   * The checklist ratio was already there; the conversation was not, and "two
   * comments" is often the reason to open *this* card rather than the next
   * one. Counted with the board rather than per card, so the chip costs no
   * request.
   */
  it("shows how much has been said on a card, and nothing when nothing has", async () => {
    render();

    const busy = await screen.findByTestId("card-comments-card-3");
    expect(busy).toHaveTextContent("2");
    // Absent rather than "0": a zero chip is a row of noise on every tile.
    expect(screen.queryByTestId("card-comments-card-1")).not.toBeInTheDocument();
  });

  /**
   * Reordering within a lane is reachable without a mouse (§18, §54).
   *
   * The grip menu offered "move to another lane" only, which left the
   * *ordering* half of the board mouse-only — and a drag is exactly the
   * gesture somebody using a keyboard cannot make.
   */
  it("moves a card up and down its own lane from the keyboard", async () => {
    const user = userEvent.setup();
    const moves: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/kanban/cards/:id/move", async ({ request, params }) => {
        moves.push({ id: String(params["id"]), ...(await request.json() as object) });
        return HttpResponse.json({ ...kanbanCards[1] });
      }),
    );
    render();

    // The second card in "In progress": it can go up, and it is last, so it
    // cannot go down.
    await user.click(await screen.findByRole("button", { name: "Move PLAT-00003" }));
    const down = await screen.findByRole("menuitem", { name: /Move down in this lane/ });
    expect(down).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("menuitem", { name: /Move up in this lane/ }));
    await waitFor(() => expect(moves).toHaveLength(1));
    // Its own lane, one place earlier — the same endpoint the drag uses, so
    // the two paths cannot diverge.
    expect(moves[0]).toMatchObject({ id: "card-3", lane_id: "lane-2", position: 0 });
  });
});