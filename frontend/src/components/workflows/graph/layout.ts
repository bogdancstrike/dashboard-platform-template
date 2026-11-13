import type { WorkflowGraph } from "@/api/workflowGraph";

import { GAP_X, GAP_Y, NODE_H, NODE_W } from "./geometry";
import { blankData } from "./nodeTypes";

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
