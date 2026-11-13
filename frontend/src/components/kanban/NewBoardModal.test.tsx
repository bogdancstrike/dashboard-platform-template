import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { NewBoardModal, previewKey } from "@/components/kanban/NewBoardModal";
import { kanbanBoards } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * A new board (§64): a name, the code its cards will carry, and who can see it.
 */
describe("the card code a name will produce", () => {
  it("takes the initials of the words that start with a letter", () => {
    expect(previewKey("Platform delivery")).toBe("PD");
    expect(previewKey("  support   improvements 2026 ")).toBe("SI");
  });

  it("falls back to the name itself, cleaned, and then to BOARD", () => {
    expect(previewKey("2026")).toBe("2026");
    expect(previewKey("¡¿")).toBe("BOARD");
    expect(previewKey("a-very-long-hyphenated-name")).toBe("A");
  });
});

describe("the new-board dialog", () => {
  function open() {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<NewBoardModal open onClose={onClose} onCreated={onCreated} />);
    return { onCreated, onClose };
  }

  it("wants a name, previews its code, and creates it with an audience", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/kanban/boards", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({ ...kanbanBoards[0], ...body, id: "board-9", lane_count: 5 }, { status: 201 });
      }),
    );
    const { onCreated } = open();
    await user.click(screen.getByTestId("create-board"));
    expect(await screen.findByText("A board needs a name")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Board name"), "Field service rollout");
    expect(screen.getByText("FSR-00001")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Description"), "Weekly, Ünïcode ✓");
    await user.click(screen.getByText("Named people"));
    await user.click(screen.getByTestId("create-board"));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ name: "Field service rollout", scope: "SHARED", description: "Weekly, Ünïcode ✓" });
    expect(await screen.findByText(/is ready — 5 lanes to start with/)).toBeInTheDocument();
  });

  it("reports a refused create in the server's words", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/platform/api/kanban/boards", () =>
        HttpResponse.json({ error: "conflict", message: "You already have 50 boards." }, { status: 409 }),
      ),
    );
    open();
    await user.type(screen.getByLabelText("Board name"), "One more");
    await user.click(screen.getByTestId("create-board"));
    expect(await screen.findByText("You already have 50 boards.")).toBeInTheDocument();
  });

  it("asks before throwing a typed name away", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await user.type(screen.getByLabelText("Board name"), "Half");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });
});
