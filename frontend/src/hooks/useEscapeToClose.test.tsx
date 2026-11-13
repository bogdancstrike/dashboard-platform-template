import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEscapeToClose } from "./useEscapeToClose";

function Probe({ open, close }: { open: boolean; close: () => void }) {
  useEscapeToClose(open, close);
  return null;
}

describe("useEscapeToClose", () => {
  it("closes on Esc while open, from anywhere on the page", () => {
    const close = vi.fn();
    render(<Probe open close={close} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("listens to nothing while closed", () => {
    const close = vi.fn();
    const { rerender } = render(<Probe open={false} close={close} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    rerender(<Probe open close={close} />);
    rerender(<Probe open={false} close={close} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });
});
