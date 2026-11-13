import { describe, expect, it } from "vitest";

import type { GraphNode, WorkflowGraph } from "@/api/workflowGraph";
import { canvasGraph } from "@/test/handlers/workflows";

import {
  NODE_H,
  NODE_W,
  addNode,
  autoLayout,
  blankData,
  bounds,
  clamp,
  connect,
  connectionProblem,
  countTreeRules,
  disconnect,
  edgePath,
  fitView,
  iconFor,
  minutesLabel,
  moveNode,
  nextId,
  portOffset,
  portsOf,
  reaches,
  removeNode,
  starterGraph,
  str,
  summaryOf,
  updateData,
} from "./graph";

const labels = {
  triggers: { RECORD_CREATED: "Record created", FIELD_CHANGED: "Field changed", SCHEDULE: "On a schedule", FORM_SUBMITTED: "Form submitted" },
  actions: { NOTIFY: "Notify people", WAIT: "Wait", UPDATE_FIELD: "Update a field", WEBHOOK: "Call a webhook", EMAIL: "Send an email", CREATE_RECORD: "Create a record", ASSIGN: "Assign", TASK: "Raise a task" },
  datasets: { task: "Tasks" },
};

function node(type: GraphNode["type"], data: Record<string, unknown> = {}, id = "n"): GraphNode {
  return { id, type, position: { x: 0, y: 0 }, data };
}

describe("ports", () => {
  it("gives a branch Yes and No, an approval its two outcomes, everything else one output", () => {
    expect(portsOf(node("branch"))).toEqual(["true", "false"]);
    expect(portsOf(node("action", { kind: "APPROVAL" }))).toEqual(["approved", "rejected"]);
    expect(portsOf(node("action", { kind: "TASK" }))).toEqual(["out"]);
    expect(portsOf(node("trigger"))).toEqual(["out"]);
  });

  it("spreads outputs along the bottom edge", () => {
    const branch = node("branch");
    expect(portOffset(branch, "true")).toEqual({ x: NODE_W / 3, y: NODE_H });
    expect(portOffset(branch, "false")).toEqual({ x: (NODE_W * 2) / 3, y: NODE_H });
    expect(portOffset(branch, "nope").x).toBe(NODE_W / 3);
    expect(edgePath({ x: 0, y: 0 }, { x: 10, y: 200 })).toBe("M 0 0 C 0 100, 10 100, 10 200");
  });
});

describe("editing", () => {
  it("adds, moves, re-data's and removes steps without touching the trigger", () => {
    const graph = canvasGraph();
    const { graph: added, id } = addNode(graph, "action", { kind: "WAIT", minutes: 5 }, { x: 1, y: 2 });
    expect(id).toBe("wait5");
    expect(addNode(graph, "condition", {}, { x: 0, y: 0 }).id).toBe("condition5");
    expect(addNode(graph, "action", {}, { x: 0, y: 0 }).id).toBe("action5");
    expect(nextId({ ...graph, nodes: [...graph.nodes, node("action", {}, "x5")] }, "x")).toBe("x6");
    const moved = moveNode(added, id, { x: 9, y: 9 });
    expect(moved.nodes.find((n) => n.id === id)!.position).toEqual({ x: 9, y: 9 });
    expect(removeNode(graph, "t")).toEqual(graph);
    const removed = removeNode(graph, "b");
    expect(removed.nodes.map((n) => n.id)).toEqual(["t", "yes", "no"]);
    expect(removed.edges).toEqual([]);
  });

  it("drops connections a node no longer has outputs for", () => {
    const graph = connect(canvasGraph(), "yes", "out", "no");
    const approval = updateData(graph, "yes", { kind: "APPROVAL" });
    expect(approval.edges.some((e) => e.source === "yes")).toBe(false);
    const still = updateData(graph, "yes", { kind: "TASK" });
    expect(still.edges.some((e) => e.source === "yes")).toBe(true);
  });

  it("refuses loops, self-links, links into the trigger and duplicates", () => {
    const graph = canvasGraph();
    expect(connectionProblem(graph, "yes", "out", "yes")).toMatch(/itself/);
    expect(connectionProblem(graph, "yes", "out", "t")).toMatch(/trigger/);
    expect(connectionProblem(graph, "yes", "out", "zzz")).toMatch(/not on the canvas/);
    expect(connectionProblem(graph, "yes", "nope", "no")).toMatch(/output/);
    expect(connectionProblem(graph, "b", "true", "yes")).toMatch(/already/);
    expect(connectionProblem(graph, "yes", "out", "b")).toMatch(/loop/);
    expect(connectionProblem(graph, "yes", "out", "no")).toBeNull();
    expect(reaches(graph, "t", "no")).toBe(true);
    expect(reaches(graph, "no", "t")).toBe(false);
  });

  it("re-wires an output that is already connected, and disconnects", () => {
    const graph = connect(canvasGraph(), "b", "true", "no");
    expect(graph.edges.filter((e) => e.source === "b" && e.port === "true").map((e) => e.target)).toEqual(["no"]);
    expect(disconnect(graph, "e1").edges.some((e) => e.id === "e1")).toBe(false);
  });
});

describe("layout", () => {
  it("puts each step a row below the step that leads to it, branches side by side", () => {
    const laid = autoLayout(canvasGraph());
    const at = (id: string) => laid.nodes.find((n) => n.id === id)!.position;
    expect(at("t").y).toBe(0);
    expect(at("b").y).toBeGreaterThan(at("t").y);
    expect(at("yes").y).toBe(at("no").y);
    expect(at("yes").x).toBeLessThan(at("no").x);
  });

  it("still places steps that are on a loop or disconnected", () => {
    const graph: WorkflowGraph = {
      nodes: [node("trigger", {}, "t"), node("action", {}, "a"), node("action", {}, "c")],
      edges: [{ id: "x", source: "a", port: "out", target: "c" }, { id: "y", source: "c", port: "out", target: "a" }],
    };
    const laid = autoLayout(graph);
    expect(new Set(laid.nodes.map((n) => n.position.y)).size).toBe(3);
  });

  it("fits the view around every node, within zoom limits", () => {
    expect(bounds({ nodes: [], edges: [] })).toEqual({ x: 0, y: 0, width: NODE_W, height: NODE_H });
    const box = bounds(canvasGraph());
    expect(box.width).toBe(300 + NODE_W);
    const view = fitView(canvasGraph(), 900, 600);
    expect(view.zoom).toBeGreaterThan(0.35);
    expect(view.zoom).toBeLessThanOrEqual(1.15);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });
});

describe("words", () => {
  it("summarises every kind of step in a few words", () => {
    expect(summaryOf(node("trigger", { event: "RECORD_CREATED", resource_type: "task" }), labels)).toEqual({ title: "Record created", detail: "Tasks" });
    expect(summaryOf(node("trigger", { event: "FIELD_CHANGED", resource_type: "task", field: "status", to: "DONE" }), labels).detail).toBe("Tasks · status → DONE");
    expect(summaryOf(node("trigger", { event: "SCHEDULE", resource_type: "task", schedule: "0 9 * * *" }), labels).detail).toBe("Tasks · 0 9 * * *");
    expect(summaryOf(node("trigger", { event: "FORM_SUBMITTED", resource_type: "x", form: "bug" }), labels).detail).toBe("Choose a dataset · bug");
    expect(summaryOf(node("trigger", {}), labels).title).toBe("Choose a trigger");
    expect(summaryOf(node("branch", { tree: canvasGraph().nodes[1]!.data.tree }), labels)).toEqual({ title: "If / else", detail: "1 rule" });
    expect(summaryOf(node("condition", {}), labels).detail).toBe("No rules yet");
    expect(summaryOf(node("action", { kind: "WAIT", minutes: 120 }), labels).detail).toBe("for 2 h");
    expect(summaryOf(node("action", { kind: "UPDATE_FIELD", field: "status", value: "DONE" }), labels).detail).toBe("status = DONE");
    expect(summaryOf(node("action", { kind: "UPDATE_FIELD" }), labels).detail).toBe("Choose a field");
    expect(summaryOf(node("action", { kind: "WEBHOOK" }), labels).detail).toBe("No address yet");
    expect(summaryOf(node("action", { kind: "EMAIL", subject: "Hi" }), labels).detail).toBe("Hi");
    expect(summaryOf(node("action", { kind: "CREATE_RECORD", resource_type: "task" }), labels).detail).toBe("Tasks");
    expect(summaryOf(node("action", { kind: "ASSIGN", to_owner: true }), labels).detail).toMatch(/owner/);
    expect(summaryOf(node("action", { kind: "ASSIGN" }), labels).detail).toBe("to a person");
    expect(summaryOf(node("action", { kind: "TASK", title: "Go" }), labels)).toEqual({ title: "Raise a task", detail: "Go" });
  });

  it("labels waits, icons and values", () => {
    expect(minutesLabel(2880)).toBe("2 days");
    expect(minutesLabel(1440)).toBe("1 day");
    expect(minutesLabel(45)).toBe("45 min");
    expect(iconFor(node("trigger"))).toBe("flow");
    expect(iconFor(node("condition"))).toBe("filter");
    expect(iconFor(node("branch"))).toBe("graph");
    expect(iconFor(node("action", { kind: "APPROVAL" }))).toBe("shield");
    expect(iconFor(node("action", { kind: "???" }))).toBe("sliders");
    expect(str({})).toBe("");
    expect(str(3)).toBe("3");
    expect(str(true)).toBe("true");
    expect(countTreeRules(null)).toBe(0);
    expect(countTreeRules({ type: "group", children: [{ type: "rule" }, { type: "group", children1: { a: { type: "rule" } } }] })).toBe(2);
    expect(countTreeRules({ type: "group", children1: 4 })).toBe(0);
  });

  it("starts every action kind with sensible settings", () => {
    for (const kind of ["NOTIFY", "EMAIL", "TASK", "WEBHOOK", "WAIT", "APPROVAL", "ASSIGN", "CREATE_RECORD", "UPDATE_FIELD"]) {
      expect(blankData(kind).kind).toBe(kind);
    }
    const starter = starterGraph("ticket");
    expect(starter.nodes[0]!.data.resource_type).toBe("ticket");
    expect(starter.edges).toHaveLength(1);
  });
});
