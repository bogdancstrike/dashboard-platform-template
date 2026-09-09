import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NameModal } from "@/components/NameModal";
import { renderWithProviders } from "@/test/render";

/**
 * The plain modal, for a create whose whole decision is one word (§33).
 *
 * It exists because the two places that asked one question — a folder, a lane
 * — were doing it with `modal.confirm` and an *uncontrolled* input, and both
 * had the same three defects. All three are asserted here, because each one
 * reads to the person using it as a broken button rather than as a refusal.
 */
function render(props: Partial<Parameters<typeof NameModal>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <NameModal
      open
      title="New folder"
      label="Folder name"
      placeholder="Contracts"
      onClose={onClose}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit, onClose };
}

describe("asking for one name", () => {
  it("submits on Enter, because a one-field form should not need the mouse", async () => {
    const user = userEvent.setup();
    const { onSubmit } = render();

    await user.type(screen.getByLabelText("Folder name"), "Contracts{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("Contracts");
  });

  it("trims, so a name is not stored with the reader's stray space", async () => {
    const user = userEvent.setup();
    const { onSubmit } = render();

    await user.type(screen.getByLabelText("Folder name"), "  Contracts  ");
    await user.click(screen.getByTestId("name-modal-ok"));

    expect(onSubmit).toHaveBeenCalledWith("Contracts");
  });

  it("says an empty name is required rather than closing and creating nothing", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = render();

    await user.click(screen.getByTestId("name-modal-ok"));

    // The `confirm` version closed on OK and created nothing, which is
    // indistinguishable from a button that does not work.
    expect(await screen.findByText("Folder name is required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a name of spaces, which is an untitled folder nobody finds again", async () => {
    const user = userEvent.setup();
    const { onSubmit } = render();

    await user.type(screen.getByLabelText("Folder name"), "   ");
    await user.click(screen.getByTestId("name-modal-ok"));

    await waitFor(() =>
      expect(screen.getByText("Folder name is required")).toBeInTheDocument(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("offers what it is called now, when it is a rename rather than a create", async () => {
    const user = userEvent.setup();
    const { onSubmit } = render({ initial: "Contracts", okText: "Rename" });

    expect(screen.getByLabelText("Folder name")).toHaveValue("Contracts");
    await user.clear(screen.getByLabelText("Folder name"));
    await user.type(screen.getByLabelText("Folder name"), "Signed contracts");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onSubmit).toHaveBeenCalledWith("Signed contracts");
  });
});
