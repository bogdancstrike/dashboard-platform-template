import { describe, expect, it, vi } from "vitest";
import type { HookAPI } from "antd/es/modal/useModal";

import { confirmCopy, confirmDelete, confirmRemove, COPY_MEANS } from "./confirm";

/**
 * The three confirmations (§73): each names the thing, says the consequence,
 * and puts the verb on the button.
 */

function recordingModal() {
  const confirm = vi.fn();
  return { modal: { confirm } as unknown as HookAPI, confirm };
}

describe("confirmations", () => {
  const onOk = () => undefined;

  it("deletes with a danger button that says Delete", () => {
    const { modal, confirm } = recordingModal();
    confirmDelete(modal, { what: "Revenue", consequence: "It goes.", onOk });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete Revenue?",
        content: "It goes.",
        okText: "Delete",
        cancelText: "Keep it",
        okButtonProps: { danger: true, "data-testid": "confirm-delete" },
        onOk,
      }),
    );
  });

  it("removes without calling it a delete", () => {
    const { modal, confirm } = recordingModal();
    confirmRemove(modal, { what: "the chart", consequence: "The data stays.", onOk });
    const call = confirm.mock.calls[0]![0];
    expect(call.title).toBe("Remove the chart?");
    expect(call.okText).toBe("Remove");
    expect(call.cancelText).toBe("Leave it");
  });

  it("copies, saying what a copy is", () => {
    const { modal, confirm } = recordingModal();
    confirmCopy(modal, { what: "Ops board", consequence: COPY_MEANS, onOk });
    const call = confirm.mock.calls[0]![0];
    expect(call.title).toBe("Make a copy of Ops board?");
    expect(call.okText).toBe("Make a copy");
    expect(call.okButtonProps).toEqual({ "data-testid": "confirm-copy" });
    expect(COPY_MEANS).toMatch(/private copy/);
  });
});
