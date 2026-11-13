import type { GraphNode, WorkflowGraph } from "@/api/workflowGraph";

import { portsOf } from "./nodeTypes";

export const NODE_W = 232;
export const NODE_H = 76;
export const GAP_X = 64;
export const GAP_Y = 84;

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
