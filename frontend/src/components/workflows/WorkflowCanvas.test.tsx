import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { WorkflowGraph } from "@/api/workflowGraph";
import { canvasGraph } from "@/test/handlers/workflows";

import { WorkflowCanvas, type CanvasHandle } from "./WorkflowCanvas";

function setup(overrides: Partial<Parameters<typeof WorkflowCanvas>[0]> = {}) {
  const onChange = vi.fn<(graph: WorkflowGraph) => void>();
  const onSelect = vi.fn();
  const onMessage = vi.fn();
  const ref = createRef<CanvasHandle>();
  const graph = canvasGraph();
  const summaries = Object.fromEntries(graph.nodes.map((n) => [n.id, { title: n.id.toUpperCase(), detail: "d" }]));
  const view = render(
    <WorkflowCanvas ref={ref} graph={graph} onChange={onChange} selected={null} onSelect={onSelect}
      summaries={summaries} problems={{ no: ["Fix me"] }} onMessage={onMessage} {...overrides} />,
  );
  return { onChange, onSelect, onMessage, ref, graph, view };
}

// jsdom has no PointerEvent; a MouseEvent carries the coordinates the canvas reads.
beforeAll(() => {
  if (!("PointerEvent" in window)) {
    class PointerEventShim extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
    }
    Object.defineProperty(window, "PointerEvent", { value: PointerEventShim, configurable: true });
  }
});

describe("WorkflowCanvas", () => {
  it("moves a step by dragging it, and selects it", () => {
    const { onChange, onSelect } = setup();
    const node = screen.getByTestId("node-yes");
    fireEvent.pointerDown(node, { clientX: 100, clientY: 100 });
    expect(onSelect).toHaveBeenCalledWith("yes");
    fireEvent.pointerMove(screen.getByTestId("workflow-canvas"), { clientX: 101, clientY: 100 });
    expect(onChange).not.toHaveBeenCalled(); // under the drag threshold
    fireEvent.pointerMove(screen.getByTestId("workflow-canvas"), { clientX: 160, clientY: 140 });
    expect(onChange).toHaveBeenCalled();
    const moved = onChange.mock.calls.at(-1)![0].nodes.find((n) => n.id === "yes")!;
    expect(moved.position.x).not.toBe(-150);
    fireEvent.pointerUp(screen.getByTestId("workflow-canvas"));
  });

  it("wires an output to a step, and refuses a wire that would loop", () => {
    const { onChange, onMessage } = setup();
    const target = screen.getByTestId("node-no");
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored as it was
    const original = document.elementFromPoint;
    document.elementFromPoint = () => target;
    fireEvent.pointerDown(screen.getByTestId("port-yes-out"), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(screen.getByTestId("workflow-canvas"), { clientX: 50, clientY: 80 });
    fireEvent.pointerUp(screen.getByTestId("workflow-canvas"), { clientX: 50, clientY: 80 });
    expect(onChange.mock.calls.at(-1)![0].edges.some((e) => e.source === "yes" && e.target === "no")).toBe(true);

    document.elementFromPoint = () => screen.getByTestId("node-t");
    fireEvent.pointerDown(screen.getByTestId("port-no-out"));
    fireEvent.pointerUp(screen.getByTestId("workflow-canvas"));
    expect(onMessage).toHaveBeenCalledWith(expect.stringMatching(/trigger/));
    document.elementFromPoint = original;
  });

  it("pans, zooms, fits and recentres from the minimap", () => {
    const { ref } = setup();
    const canvas = screen.getByTestId("workflow-canvas");
    const layer = canvas.querySelector(".nx-wf-layer") as HTMLElement;
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30 });
    fireEvent.pointerUp(canvas);
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 10, clientY: 10 });
    fireEvent.wheel(canvas, { deltaY: 100, clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByText(/%$/).textContent).not.toBe("");
    fireEvent.click(screen.getByLabelText("Zoom out"));
    fireEvent.click(screen.getByTestId("canvas-fit"));
    fireEvent.pointerDown(screen.getByTestId("canvas-minimap"), { clientX: 5, clientY: 5 });
    expect(layer.style.transform).toMatch(/translate/);
    act(() => ref.current!.fit());
    expect(ref.current!.centre()).toHaveProperty("x");
  });

  it("tidies through the handle, and selects then removes a connection", () => {
    const { ref, onChange } = setup();
    act(() => ref.current!.layout());
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByTestId("edge-e3"));
    fireEvent.click(screen.getByTestId("delete-edge"));
    expect(onChange.mock.calls.at(-1)![0].edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    fireEvent.pointerDown(screen.getByTestId("edge-e2"));
    fireEvent.keyDown(screen.getByTestId("workflow-canvas"), { key: "Delete" });
    expect(onChange.mock.calls.at(-1)![0].edges.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("paints problems, badges and a lit path; selects by keyboard", () => {
    const { onSelect } = setup({
      overlay: { badges: { b: [{ label: "7 in", tone: "acc" }] }, path: { nodes: new Set(["t"]), edges: new Set(["e1"]) }, edgeCounts: { e1: 7 } },
    });
    expect(screen.getByTestId("problem-no")).toHaveAccessibleName("Fix me");
    expect(screen.getByText("7 in")).toBeInTheDocument();
    expect(screen.getByTestId("node-b").className).toMatch(/is-dim/);
    expect(screen.getByText("Yes")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("node-b"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("reports a dropped palette step at its position, and ignores drags when read-only", () => {
    const onDropItem = vi.fn();
    setup({ onDropItem });
    const data = { types: ["application/x-nucleus-step"], getData: () => "3" };
    fireEvent.dragOver(screen.getByTestId("workflow-canvas"), { dataTransfer: data });
    fireEvent.drop(screen.getByTestId("workflow-canvas"), { dataTransfer: data, clientX: 200, clientY: 200 });
    expect(onDropItem).toHaveBeenCalledWith("3", expect.objectContaining({ x: expect.any(Number) }));
  });

  it("does not move or wire anything when read-only", () => {
    const { onChange } = setup({ readOnly: true });
    fireEvent.pointerDown(screen.getByTestId("node-yes"), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(screen.getByTestId("workflow-canvas"), { clientX: 90, clientY: 90 });
    fireEvent.pointerDown(screen.getByTestId("port-yes-out"));
    fireEvent.keyDown(screen.getByTestId("workflow-canvas"), { key: "Delete" });
    const data = { types: ["application/x-nucleus-step"], getData: () => "1" };
    fireEvent.drop(screen.getByTestId("workflow-canvas"), { dataTransfer: data });
    expect(onChange).not.toHaveBeenCalled();
  });
});
