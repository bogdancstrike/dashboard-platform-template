/**
 * The canvas's pure half: ports, layout, labels and edits on a workflow graph.
 *
 * Kept free of React so every rule the canvas follows — which outputs a node
 * has, where auto-layout puts it, what a connection may join — is asserted
 * directly, the same rules the server's `automation_graph` enforces.
 */

import type { GraphEdge, GraphNode, NodeType, WorkflowGraph } from "@/api/workflowGraph";

export const NODE_W = 232;

/** A node setting as text: strings and numbers as they are, anything else blank. */
export function str(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}
export const NODE_H = 76;
const GAP_X = 64;
const GAP_Y = 84;

/** The outputs of a node, in the order they are drawn left to right. */
export function portsOf(node: Pick<GraphNode, "type" | "data">): string[] {
  if (node.type === "branch") return ["true", "false"];
  if (node.type === "action" && str(node.data.kind) === "APPROVAL") return ["approved", "rejected"];
  return ["out"];
}

export const PORT_LABEL: Record<string, string> = {
  out: "",
  true: "Yes",
  false: "No",
  approved: "Approved",
  rejected: "Rejected",
};

/** Where an output sits on its node, relative to the node's top-left. */
export function portOffset(node: GraphNode, port: string): { x: number; y: number } {
  const ports = portsOf(node);
  const index = Math.max(0, ports.indexOf(port));
  return { x: (NODE_W * (index + 1)) / (ports.length + 1), y: NODE_H };
}

/** A gentle vertical S-curve from an output to an input. */
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const bend = Math.max(36, Math.abs(to.y - from.y) / 2);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bend}, ${to.x} ${to.y - bend}, ${to.x} ${to.y}`;
}

/** A fresh id that is not taken in this graph. */
export function nextId(graph: WorkflowGraph, stem: string): string {
  const taken = new Set(graph.nodes.map((node) => node.id));
  let index = graph.nodes.length + 1;
  while (taken.has(`${stem}${index}`)) index += 1;
  return `${stem}${index}`;
}

export function addNode(graph: WorkflowGraph, type: NodeType, data: Record<string, unknown>,
  position: { x: number; y: number }): { graph: WorkflowGraph; id: string } {
  const id = nextId(graph, type === "action" ? (str(data.kind) || "action").toLowerCase() : type);
  return { graph: { ...graph, nodes: [...graph.nodes, { id, type, position, data }] }, id };
}

export function removeNode(graph: WorkflowGraph, id: string): WorkflowGraph {
  return {
    nodes: graph.nodes.filter((node) => node.id !== id || node.type === "trigger"),
    edges: graph.edges.filter((edge) => (edge.source !== id && edge.target !== id) ||
      graph.nodes.find((node) => node.id === id)?.type === "trigger"),
  };
}

export function moveNode(graph: WorkflowGraph, id: string, position: { x: number; y: number }): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map((node) => (node.id === id ? { ...node, position } : node)) };
}

export function updateData(graph: WorkflowGraph, id: string, data: Record<string, unknown>): WorkflowGraph {
  return {
    nodes: graph.nodes.map((node) => (node.id === id ? { ...node, data } : node)),
    // A node whose ports changed (an action that became an approval) keeps
    // only the connections it still has outputs for.
    edges: graph.edges.filter((edge) => {
      if (edge.source !== id) return true;
      return portsOf({ type: graph.nodes.find((n) => n.id === id)!.type, data }).includes(edge.port);
    }),
  };
}

/**
 * Why a connection may not be made, or null when it may.
 *
 * The same rules publishing checks, applied while dragging so the reader is
 * told at the port rather than at publish time.
 */
export function connectionProblem(graph: WorkflowGraph, source: string, port: string, target: string): string | null {
  if (source === target) return "A step cannot lead to itself.";
  const to = graph.nodes.find((node) => node.id === target);
  const from = graph.nodes.find((node) => node.id === source);
  if (!to || !from) return "That step is not on the canvas.";
  if (to.type === "trigger") return "Nothing can lead back into the trigger.";
  if (!portsOf(from).includes(port)) return "That output does not exist.";
  if (graph.edges.some((edge) => edge.source === source && edge.port === port && edge.target === target)) {
    return "Those steps are already connected.";
  }
  if (reaches(graph, target, source)) return "That would make a loop — a workflow always moves forward.";
  return null;
}

/** Whether `to` can be reached from `from` along the edges. */
export function reaches(graph: WorkflowGraph, from: string, to: string): boolean {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === to) return true;
    for (const edge of graph.edges) {
      if (edge.source === current && !seen.has(edge.target)) {
        seen.add(edge.target);
        stack.push(edge.target);
      }
    }
  }
  return false;
}

export function connect(graph: WorkflowGraph, source: string, port: string, target: string): WorkflowGraph {
  // One output feeds one step: dragging from an output that is already wired
  // re-wires it, which is what a reader dragging it again means.
  const edges = graph.edges.filter((edge) => !(edge.source === source && edge.port === port));
  const edge: GraphEdge = { id: `e-${source}-${port}-${target}`, source, port, target };
  return { ...graph, edges: [...edges, edge] };
}

export function disconnect(graph: WorkflowGraph, edgeId: string): WorkflowGraph {
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) };
}

/**
 * Layered top-to-bottom layout: each step one row below the deepest step that
 * leads to it, siblings spread around their parents' centre.
 */
export function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  const depth = new Map<string, number>();
  const trigger = graph.nodes.find((node) => node.type === "trigger");
  const order: string[] = [];
  const incoming = new Map<string, number>();
  for (const node of graph.nodes) incoming.set(node.id, 0);
  for (const edge of graph.edges) incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  const queue = graph.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort((a, b) => (a.id === trigger?.id ? -1 : b.id === trigger?.id ? 1 : 0)).map((node) => node.id);
  for (const id of queue) depth.set(id, 0);
  const remaining = new Map(incoming);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    const outgoing = graph.edges.filter((edge) => edge.source === id)
      .sort((a, b) => portRank(a.port) - portRank(b.port));
    for (const edge of outgoing) {
      depth.set(edge.target, Math.max(depth.get(edge.target) ?? 0, (depth.get(id) ?? 0) + 1));
      remaining.set(edge.target, (remaining.get(edge.target) ?? 1) - 1);
      if ((remaining.get(edge.target) ?? 0) === 0) queue.push(edge.target);
    }
  }
  // Anything on a loop keeps a row below everything else rather than vanishing.
  let spare = Math.max(0, ...Array.from(depth.values())) + 1;
  for (const node of graph.nodes) if (!depth.has(node.id)) { depth.set(node.id, spare++); order.push(node.id); }

  const rows = new Map<number, string[]>();
  for (const id of order) {
    const row = depth.get(id)!;
    rows.set(row, [...(rows.get(row) ?? []), id]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [row, ids] of Array.from(rows.entries()).sort((a, b) => a[0] - b[0])) {
    // Order a row by where its parents sit, so branches do not cross.
    const parentX = (id: string) => {
      const xs = graph.edges.filter((edge) => edge.target === id)
        .map((edge) => (positions.get(edge.source)?.x ?? 0) + (portRank(edge.port) - 0.5) * 10);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    ids.sort((a, b) => parentX(a) - parentX(b));
    const width = ids.length * NODE_W + (ids.length - 1) * GAP_X;
    ids.forEach((id, index) => {
      positions.set(id, { x: index * (NODE_W + GAP_X) - width / 2 + NODE_W / 2, y: row * (NODE_H + GAP_Y) });
    });
  }
  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) };
}

function portRank(port: string): number {
  return port === "false" || port === "rejected" ? 1 : 0;
}

/** The rectangle that holds every node, for fitting the view and the minimap. */
export function bounds(graph: WorkflowGraph): { x: number; y: number; width: number; height: number } {
  if (!graph.nodes.length) return { x: 0, y: 0, width: NODE_W, height: NODE_H };
  const xs = graph.nodes.map((node) => node.position.x);
  const ys = graph.nodes.map((node) => node.position.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x + NODE_W, height: Math.max(...ys) - y + NODE_H };
}

/** Scale and offset that fit the graph in a viewport, with a margin. */
export function fitView(graph: WorkflowGraph, width: number, height: number, margin = 48) {
  const box = bounds(graph);
  const zoom = clamp(Math.min((width - margin * 2) / box.width, (height - margin * 2) / box.height), 0.35, 1.15);
  return {
    zoom,
    x: (width - box.width * zoom) / 2 - box.x * zoom,
    y: Math.max(margin / 2, (height - box.height * zoom) / 2) - box.y * zoom,
  };
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export interface PaletteItem {
  type: NodeType;
  data: Record<string, unknown>;
  label: string;
  description: string;
  icon: string;
  group: "Logic" | "Actions" | "Flow";
}

/** Data a fresh node of each action kind starts with. */
export function blankData(kind: string): Record<string, unknown> {
  switch (kind) {
    case "NOTIFY":
      return { kind, recipients: { user_ids: [], role: "", owner: true }, title: "{rule}: {record}" };
    case "EMAIL":
      return { kind, recipients: { user_ids: [], role: "", owner: true }, subject: "{rule}: {record}" };
    case "TASK":
      return { kind, title: "Follow up {record}", priority: "HIGH" };
    case "WEBHOOK":
      return { kind, url: "" };
    case "WAIT":
      return { kind, minutes: 60 };
    case "APPROVAL":
      return { kind, title: "Approve {record}" };
    case "ASSIGN":
      return { kind, to_owner: true };
    case "CREATE_RECORD":
      return { kind, resource_type: "task", values: { title: "Follow up {record}" } };
    default:
      return { kind };
  }
}

const ACTION_ICON: Record<string, string> = {
  NOTIFY: "bell", EMAIL: "mail", TASK: "check", WEBHOOK: "plug", UPDATE_FIELD: "pen",
  ASSIGN: "user", CREATE_RECORD: "plus", WAIT: "calendar", APPROVAL: "shield",
};

export function iconFor(node: Pick<GraphNode, "type" | "data">): string {
  if (node.type === "trigger") return "flow";
  if (node.type === "condition") return "filter";
  if (node.type === "branch") return "graph";
  return ACTION_ICON[str(node.data.kind)] ?? "sliders";
}

export function minutesLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** The second line of a node: what it is set to do, in a few words. */
export function summaryOf(node: GraphNode, labels: { triggers: Record<string, string>; actions: Record<string, string>;
  datasets: Record<string, string> }): { title: string; detail: string } {
  const data = node.data;
  if (node.type === "trigger") {
    const event = str(data.event);
    const dataset = labels.datasets[str(data.resource_type)] ?? "Choose a dataset";
    let detail = dataset;
    if (event === "FIELD_CHANGED" && data.field) detail = `${dataset} · ${str(data.field)}${data.to ? ` → ${str(data.to)}` : ""}`;
    if (event === "SCHEDULE") detail = `${dataset} · ${str(data.schedule)}`;
    if (event === "FORM_SUBMITTED" && data.form) detail = `${dataset} · ${str(data.form)}`;
    return { title: labels.triggers[event] ?? "Choose a trigger", detail };
  }
  if (node.type === "condition" || node.type === "branch") {
    const count = countTreeRules(data.tree);
    return {
      title: node.type === "branch" ? "If / else" : "Only if",
      detail: count ? `${count} rule${count === 1 ? "" : "s"}` : "No rules yet",
    };
  }
  const kind = str(data.kind);
  const title = labels.actions[kind] ?? kind;
  if (kind === "WAIT") return { title, detail: `for ${minutesLabel(Number(data.minutes ?? 0))}` };
  if (kind === "UPDATE_FIELD") return { title, detail: data.field ? `${str(data.field)} = ${str(data.value)}` : "Choose a field" };
  if (kind === "WEBHOOK") return { title, detail: str(data.url) || "No address yet" };
  if (kind === "EMAIL") return { title, detail: str(data.subject) };
  if (kind === "CREATE_RECORD") return { title, detail: labels.datasets[str(data.resource_type)] ?? "" };
  if (kind === "ASSIGN") return { title, detail: data.to_owner ? "to the workflow's owner" : "to a person" };
  return { title, detail: str(data.title) };
}

export function countTreeRules(tree: unknown): number {
  if (!tree || typeof tree !== "object") return 0;
  const node = tree as { type?: string; children1?: unknown; children?: unknown };
  if (node.type === "rule") return 1;
  const children = node.children1 ?? node.children;
  const list = Array.isArray(children) ? children : children && typeof children === "object" ? Object.values(children) : [];
  return list.reduce((sum: number, child) => sum + countTreeRules(child), 0);
}

/** A first graph for a workflow started from scratch on the canvas. */
export function starterGraph(resourceType = "task"): WorkflowGraph {
  return autoLayout({
    nodes: [
      { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { event: "RECORD_CREATED", resource_type: resourceType } },
      { id: "notify1", type: "action", position: { x: 0, y: 0 }, data: blankData("NOTIFY") },
    ],
    edges: [{ id: "e-trigger-out-notify1", source: "trigger", port: "out", target: "notify1" }],
  });
}
