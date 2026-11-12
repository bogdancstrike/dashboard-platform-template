import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { KanbanBoard } from "@/api/kanban";
import { renderWithProviders } from "@/test/render";

import { BoardGallery } from "./BoardGallery";

/**
 * The board gallery (§18): which boards there are, who can see each, what is
 * on it — and a way to make one only for somebody who may.
 */

function board(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "b1",
    key: "OPS",
    name: "Operations",
    description: "Day-to-day work",
    scope: "PUBLIC",
    is_archived: false,
    owner: { id: "u1", is_me: true },
    lane_count: 4,
    card_count: 12,
    can_edit: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("the board gallery", () => {
  it("shows each board's key, audience and contents, and opens it", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderWithProviders(
      <BoardGallery
        boards={[
          board(),
          board({ id: "b2", key: "ONE", name: "Solo", description: null, scope: "SOMETHING-NEW", lane_count: 1, card_count: 1 }),
          board({ id: "b3", key: "TEAM", name: "Team", scope: "SHARED", card_count: undefined }),
        ]}
        canCreate={false}
        onOpen={onOpen}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText("OPS")).toBeInTheDocument();
    expect(screen.getByLabelText("Everyone signed in")).toBeInTheDocument();
    expect(screen.getByLabelText("Named people")).toBeInTheDocument();
    // An unknown audience reads as the narrowest one rather than as nothing.
    expect(screen.getAllByLabelText("Only you")).toHaveLength(1);
    expect(screen.getByText("4 lanes · 12 cards")).toBeInTheDocument();
    expect(screen.getByText("1 lane · 1 card")).toBeInTheDocument();
    expect(screen.getAllByText("Day-to-day work")).toHaveLength(2);
    expect(screen.queryByTestId("gallery-new")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("board-b2"));
    expect(onOpen).toHaveBeenCalledWith("b2");
  });

  it("offers a new board to somebody who may make one", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(<BoardGallery boards={[board()]} canCreate onOpen={vi.fn()} onCreate={onCreate} />);
    await user.click(screen.getByRole("button", { name: /New board/ }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("explains an empty gallery, with the first board one press away", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const { rerender } = renderWithProviders(
      <BoardGallery boards={[]} canCreate onOpen={vi.fn()} onCreate={onCreate} />,
    );
    expect(screen.getByText("No boards yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Create the first one/ }));
    expect(onCreate).toHaveBeenCalled();

    rerender(<BoardGallery boards={[]} canCreate={false} onOpen={vi.fn()} onCreate={onCreate} />);
    expect(screen.queryByRole("button", { name: /Create the first one/ })).not.toBeInTheDocument();
  });
});
