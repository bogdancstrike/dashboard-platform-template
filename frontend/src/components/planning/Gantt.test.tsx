import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planningState, resetPlanning } from "@/test/handlers/planning";
import { pointAt } from "@/test/pointerShim";
import { renderWithProviders } from "@/test/render";

import { Gantt } from "./Gantt";
import { ZOOMS } from "./gantt";

const px = ZOOMS.day.px;

function draw(overrides: Partial<Parameters<typeof Gantt>[0]> = {}) {
  const props = {
    data: planningState.timeline,
    zoom: "day" as const,
    from: "2026-08-30",
    to: "2026-09-20",
    showCritical: true,
    canEdit: true,
    onSchedule: vi.fn(),
    onLink: vi.fn(),
    onUnlink: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<Gantt {...props} />);
  return props;
}

/** A pointer gesture: down on `target`, move by `dx`, up. */
function gesture(target: Element, dx: number) {
  fireEvent.pointerDown(target, { button: 0, clientX: 100, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 100 + dx, clientY: 10 });
  fireEvent.pointerUp(window, { clientX: 100 + dx, clientY: 10 });
}

describe("the Gantt chart", () => {
  beforeEach(() => resetPlanning());

  it("draws groups, bars, a milestone, today, arrows and the critical path", () => {
    draw();
    expect(screen.getByText("Customer portal")).toBeInTheDocument();
    expect(screen.getByTestId("gantt-bar-TSK-00001")).toHaveClass("is-critical");
    expect(screen.getByTestId("gantt-bar-TSK-00003")).toHaveClass("is-milestone");
    expect(screen.getByTestId("gantt-today")).toBeInTheDocument();
    expect(screen.getByTestId("gantt-link-d-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /TSK-00001 Design the schema, 1 Sep to 3 Sep/ })).toBeInTheDocument();
  });

  it("moves a bar by whole days, previewing the dates and the link it breaks", () => {
    const props = draw();
    const target = screen.getByTestId("gantt-bar-TSK-00001");
    fireEvent.pointerDown(target, { button: 0, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 100 + px * 2, clientY: 10 });
    expect(screen.getByRole("status")).toHaveTextContent("3 Sep – 5 Sep · breaks 1 link");
    expect(target).toHaveClass("is-conflict");
    fireEvent.pointerUp(window, { clientX: 100 + px * 2, clientY: 10 });
    expect(props.onSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: "t-a" }), "2026-09-03", "2026-09-05");
  });

  it("resizes from either end, and a click without travel opens the task", () => {
    const props = draw();
    gesture(screen.getByTestId("gantt-end-TSK-00002"), px * 3);
    expect(props.onSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ id: "t-b" }), "2026-09-04", "2026-09-11");
    gesture(screen.getByTestId("gantt-start-TSK-00002"), -px);
    expect(props.onSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ id: "t-b" }), "2026-09-03", "2026-09-08");
    gesture(screen.getByTestId("gantt-bar-TSK-00002"), 1);
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "t-b" }));
    fireEvent.pointerDown(screen.getByTestId("gantt-bar-TSK-00002"), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: px * 2 });
    fireEvent.pointerCancel(window);
    expect(props.onSchedule).toHaveBeenCalledTimes(2);
  });

  it("draws a dependency from one bar's end dot to another bar", () => {
    const props = draw();
    const other = screen.getByTestId("gantt-bar-TSK-00003");
    const restore = pointAt(() => other);
    try {
      fireEvent.pointerDown(screen.getByTestId("gantt-connector-TSK-00002"), { button: 0, clientX: 300, clientY: 90 });
      fireEvent.pointerMove(window, { clientX: 500, clientY: 130 });
      expect(screen.getByTestId("gantt-link-draft")).toBeInTheDocument();
      expect(other).toHaveClass("is-link-target");
      fireEvent.pointerUp(window, { clientX: 500, clientY: 130 });
    } finally {
      restore();
    }
    expect(props.onLink).toHaveBeenCalledWith("t-b", "t-m");
    expect(screen.queryByTestId("gantt-link-draft")).not.toBeInTheDocument();
  });

  it("moves with the keyboard, removes an arrow, and folds a group", () => {
    const props = draw();
    const target = screen.getByTestId("gantt-bar-TSK-00001");
    fireEvent.keyDown(target, { key: "ArrowRight" });
    expect(props.onSchedule).toHaveBeenLastCalledWith(expect.anything(), "2026-09-02", "2026-09-04");
    fireEvent.keyDown(target, { key: "ArrowLeft", shiftKey: true });
    expect(props.onSchedule).toHaveBeenLastCalledWith(expect.anything(), "2026-09-01", "2026-09-02");
    fireEvent.keyDown(target, { key: "Enter" });
    expect(props.onOpen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Dependency TSK-00001 → TSK-00002/ }));
    expect(props.onUnlink).toHaveBeenCalledWith(expect.objectContaining({ id: "d-1" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /Dependency TSK-00001/ }), { key: "Delete" });
    expect(props.onUnlink).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Customer portal" }));
    expect(screen.queryByTestId("gantt-bar-TSK-00001")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Customer portal" }));
    expect(screen.getByTestId("gantt-bar-TSK-00001")).toBeInTheDocument();
  });

  it("is read-only without the permission, and compact on a phone", () => {
    const props = draw({ canEdit: false, compact: true, showCritical: false });
    expect(screen.queryByTestId("gantt-connector-TSK-00001")).not.toBeInTheDocument();
    expect(screen.getByTestId("gantt-bar-TSK-00001")).not.toHaveClass("is-critical");
    gesture(screen.getByTestId("gantt-bar-TSK-00001"), px * 3);
    fireEvent.keyDown(screen.getByTestId("gantt-bar-TSK-00001"), { key: "ArrowRight" });
    expect(props.onSchedule).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Dependency/ })).not.toBeInTheDocument();
  });
});
