import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SavedDashboard } from "@/api/dashboards";
import { ShareDrawer } from "@/components/dashboards/ShareDrawer";
import { savedDashboards } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * Sharing a dashboard (§45, §67): who can see it, the saved answer beside the
 * draft, and a copyable address whether or not the clipboard cooperates.
 */
const BOARD = {
  ...savedDashboards[0]!,
  scope: "SHARED",
  members: [{ id: "u-2", name: "Otto Operator", email: "operator@nucleus.example" }],
} as unknown as SavedDashboard;

function open(props: Partial<Parameters<typeof ShareDrawer>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<ShareDrawer open dashboard={BOARD} saving={false} canShare onClose={onClose} onSave={onSave} {...props} />);
  return { onSave, onClose };
}

afterEach(() => vi.unstubAllGlobals());

describe("sharing a dashboard", () => {
  it("lists who has it today, and saves only once something changed", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    expect(screen.getByText("Access today")).toBeInTheDocument();
    expect(screen.getByText("Otto Operator")).toBeInTheDocument();
    expect(screen.getByText("owner · can edit")).toBeInTheDocument();
    expect(screen.getByTestId("save-share")).toBeDisabled();
    await user.click(screen.getByText("Everyone"));
    expect(screen.getByText(/Anyone signed in finds it/)).toBeInTheDocument();
    await user.click(screen.getByTestId("save-share"));
    // Named people are dropped when the audience is everyone.
    expect(onSave).toHaveBeenCalledWith({ scope: "PUBLIC", member_ids: [] });
  });

  it("keeps the named people when it stays shared", async () => {
    const user = userEvent.setup();
    const { onSave } = open({ dashboard: { ...BOARD, scope: "PRIVATE" } });
    await user.click(screen.getByText("Named people"));
    await user.click(screen.getByTestId("save-share"));
    expect(onSave).toHaveBeenCalledWith({ scope: "SHARED", member_ids: ["u-2"] });
  });

  it("says everyone else has it when it is public", () => {
    open({ dashboard: { ...BOARD, scope: "PUBLIC", members: [] } as unknown as SavedDashboard });
    expect(screen.getByText("and everyone else signed in")).toBeInTheDocument();
  });

  it("explains why only 'Only me' is open to a role that cannot share", () => {
    open({ canShare: false, dashboard: { ...BOARD, scope: "PRIVATE", members: [] } as unknown as SavedDashboard });
    expect(screen.getByText("Sharing needs the searches.share permission")).toBeInTheDocument();
    expect(screen.queryByText("Access today")).not.toBeInTheDocument();
  });

  it("copies the address, and says where it is when the clipboard is refused", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    open();
    expect(screen.getByRole("textbox", { name: "Link to this dashboard" })).toHaveValue(`${window.location.origin}/dashboards?dashboard=${BOARD.id}`);
    await user.click(screen.getByTestId("copy-link"));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    await user.click(screen.getByTestId("copy-link"));
    expect(await screen.findByText(/this browser blocked the clipboard/)).toBeInTheDocument();
  });

  it("closes without saving", async () => {
    const user = userEvent.setup();
    const { onClose, onSave } = open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("draws nothing without a dashboard", () => {
    const { container } = renderWithProviders(<ShareDrawer open dashboard={undefined} saving={false} canShare onClose={vi.fn()} onSave={vi.fn()} />);
    expect(container.querySelector("[data-testid='share-drawer']")).toBeNull();
  });
});
