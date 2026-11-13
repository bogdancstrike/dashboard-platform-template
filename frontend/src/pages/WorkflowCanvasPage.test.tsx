import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import WorkflowCanvasPage, { historyOverlay, problemsByNode, traceOverlay, withCanvas } from "@/pages/WorkflowCanvasPage";
import { renderWithProviders } from "@/test/render";
import { canvasState, resetCanvas } from "@/test/handlers/workflows";

function renderAt(id = "wf-1", width = 1440) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  return renderWithProviders(
    <Routes>
      <Route path="/workflows/:ruleId/canvas" element={<WorkflowCanvasPage />} />
      <Route path="/workflows" element={<div>the list</div>} />
    </Routes>,
    { route: `/workflows/${id}/canvas` },
  );
}

async function ready() {
  await screen.findByTestId("workflow-canvas");
  await screen.findByTestId("node-b");
}

beforeEach(() => resetCanvas());
afterEach(() => Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 }));

describe("WorkflowCanvasPage", () => {
  it("draws the workflow's steps and connections, with the palette and versions", async () => {
    renderAt();
    await ready();
    expect(screen.getByTestId("node-t")).toHaveAccessibleName(/Record created: Tasks/);
    expect(screen.getByTestId("node-yes")).toHaveAccessibleName(/Notify people/);
    expect(screen.getByTestId("edge-e2")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-palette")).toHaveTextContent("Update a field");
    expect(screen.getByTestId("versions")).toHaveTextContent("Added the branch");
    expect(screen.getByTestId("problem-count")).toHaveTextContent("Ready to publish");
    expect(screen.getByText("Version 2 live")).toBeInTheDocument();
  });

  it("opens a step in the inspector, edits it, and saves the draft", async () => {
    renderAt();
    await ready();
    fireEvent.pointerDown(screen.getByTestId("node-t"), { button: 0, clientX: 10, clientY: 10 });
    const inspector = await screen.findByTestId("node-inspector");
    expect(inspector).toHaveTextContent("Record created");
    // Choose "Field changed" from the trigger select.
    await userEvent.click(within(inspector).getAllByRole("combobox")[0]!);
    await userEvent.click(await screen.findByText("Field changed"));
    await waitFor(() => expect(canvasState.detail.draft.nodes[0]!.data.event).toBe("FIELD_CHANGED"), { timeout: 3000 });
    expect(screen.getByTestId("draft-tag")).toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole("button", { name: "Close step" }));
    expect(screen.queryByTestId("node-inspector")).not.toBeInTheDocument();
  });

  it("adds a step from the palette after the selected one, wired in", async () => {
    renderAt();
    await ready();
    fireEvent.pointerDown(screen.getByTestId("node-yes"), { button: 0 });
    fireEvent.click(screen.getByTestId("palette-WAIT"));
    const added = await screen.findByTestId("node-wait5");
    expect(added).toHaveAccessibleName(/Wait: for 1 h/);
    await waitFor(() => expect(canvasState.detail.draft.edges.some((e) => e.source === "yes" && e.target === "wait5")).toBe(true), { timeout: 3000 });
    // Remove it again from the inspector.
    fireEvent.click(screen.getByTestId("remove-node"));
    expect(screen.queryByTestId("node-wait5")).not.toBeInTheDocument();
  });

  it("drops a palette step onto the canvas where it lands", async () => {
    renderAt();
    await ready();
    const data = { types: ["application/x-nucleus-step"], getData: () => "0" };
    fireEvent.dragOver(screen.getByTestId("workflow-canvas"), { dataTransfer: data });
    fireEvent.drop(screen.getByTestId("workflow-canvas"), { dataTransfer: data, clientX: 300, clientY: 300 });
    expect(await screen.findByTestId("node-condition5")).toBeInTheDocument();
  });

  it("publishes, and shows the problems a refused publish names", async () => {
    renderAt();
    await ready();
    fireEvent.click(screen.getByTestId("publish-workflow"));
    await waitFor(() => expect(canvasState.published).toBe(1));
    expect(await screen.findByText("Published version 3")).toBeInTheDocument();

    // An empty condition: the server refuses, per node.
    fireEvent.click(screen.getByTestId("palette-condition"));
    await screen.findByTestId("node-condition5");
    fireEvent.click(screen.getByTestId("publish-workflow"));
    expect(await screen.findByTestId("problem-condition5")).toBeInTheDocument();
    expect(screen.getByTestId("problem-count")).toHaveTextContent("1 to fix");
    expect(canvasState.published).toBe(1);
  });

  it("tests a sample record and lights the path it took", async () => {
    renderAt();
    await ready();
    fireEvent.click(screen.getByText("Test"));
    const bar = await screen.findByTestId("test-bar");
    await userEvent.click(within(bar).getByRole("combobox"));
    await userEvent.click(await screen.findByText("TSK-00001 · NEW"));
    fireEvent.click(screen.getByTestId("run-test"));
    const result = await screen.findByTestId("trace-result");
    expect(result).toHaveTextContent("would notify people");
    expect(screen.getByTestId("node-no").className).toMatch(/is-dim/);
    expect(screen.getByTestId("node-yes").className).toMatch(/is-hot/);
    expect(canvasState.tests).toBe(1);
  });

  it("overlays run counts in history mode", async () => {
    renderAt();
    await ready();
    fireEvent.click(screen.getByText(/History · 3/));
    expect(await screen.findByText("1 failed")).toBeInTheDocument();
    expect(screen.getAllByText("7 in", { selector: ".nx-wf-badge" })).toHaveLength(2);
  });

  it("restores a version, discards a draft, renames and pauses", async () => {
    renderAt();
    await ready();
    fireEvent.click(screen.getByTestId("restore-1"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(screen.queryByTestId("node-b")).not.toBeInTheDocument());
    fireEvent.click(await screen.findByTestId("discard-draft"));
    expect(await screen.findByTestId("node-b")).toBeInTheDocument();

    const name = screen.getByLabelText("Workflow name");
    fireEvent.change(name, { target: { value: "Renamed flow" } });
    fireEvent.blur(name);
    await waitFor(() => expect(canvasState.detail.rule.name).toBe("Renamed flow"));

    fireEvent.click(screen.getByTestId("canvas-enabled"));
    await waitFor(() => expect(canvasState.detail.rule.enabled).toBe(false));
  });

  it("is read-only for somebody who is not the author", async () => {
    resetCanvas({ can_edit: false });
    renderAt();
    await ready();
    expect(screen.queryByTestId("publish-workflow")).not.toBeInTheDocument();
    expect(screen.getByTestId("palette-WAIT")).toBeDisabled();
  });

  it("shows the webhook address of a webhook-triggered workflow", async () => {
    resetCanvas({ webhook_path: "/public/automations/hooks/abc" });
    renderAt();
    await ready();
    expect(screen.getByText(/\/platform\/public\/automations\/hooks\/abc/)).toBeInTheDocument();
  });

  it("answers a missing workflow with the not-found page", async () => {
    renderAt("missing");
    expect(await screen.findByText(/No page answers/)).toBeInTheDocument();
  });

  it("on a narrow screen adds steps from a menu and edits them in a drawer", async () => {
    renderAt("wf-1", 800);
    await ready();
    expect(screen.queryByTestId("workflow-palette")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("add-step"));
    fireEvent.click(await screen.findByText("Request approval"));
    expect(await screen.findByTestId("node-inspector")).toBeInTheDocument();
    expect(screen.getByTestId("next-approved")).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event("resize")); });
  });
});

describe("overlays", () => {
  it("turns run history and test traces into badges and paths", () => {
    const history = historyOverlay({ stats: { runs: 1, nodes: { a: { in: 2, failed: 1, waiting: 1 }, b: {} }, edges: { e: 2 } } });
    expect(history.badges.a!.map((b) => b.label)).toEqual(["2 in", "1 failed", "1 waiting"]);
    expect(history.badges.b).toEqual([]);
    const trace = traceOverlay({ record: { id: "1", label: "x", path: "/" }, nodes: [{ node_id: "a", state: "weird", detail: "" }], edges: ["e"], actions: [], error: null });
    expect(trace.badges.a![0]!.tone).toBe("acc");
    expect(trace.path?.edges.has("e")).toBe(true);
    expect(problemsByNode([{ node_id: "a", message: "x" }, { node_id: "a", message: "y" }])).toEqual({ a: ["x", "y"] });
    const filled = withCanvas({ resources: [], roles: [], actions: [{ kind: "TASK", label: "T", description: "", needs: [] }], severities: [], priorities: [], limits: { max_matches: 1, max_fires: 1, max_rules: 1 } });
    expect(filled.canvas_actions).toHaveLength(1);
    expect(filled.triggers).toEqual([]);
  });
});
