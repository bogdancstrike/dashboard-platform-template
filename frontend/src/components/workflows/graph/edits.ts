/** Edits on a workflow graph, each returning a new graph, and the rules a connection follows. */

import type { GraphEdge, NodeType, WorkflowGraph } from "@/api/workflowGraph";

import { portsOf, str } from "./nodeTypes";

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
