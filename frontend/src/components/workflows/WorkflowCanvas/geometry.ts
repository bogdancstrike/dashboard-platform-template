import type { GraphNode } from "@/api/workflowGraph";

import { NODE_W, portOffset } from "../graph";

/** Where a wire leaves a node's output, in graph coordinates. */
export function anchor(node: GraphNode, port: string) {
  const offset = portOffset(node, port);
  return { x: node.position.x + offset.x, y: node.position.y + offset.y };
}

/** Where a wire enters a node: the middle of its top edge. */
export function input(node: GraphNode) {
  return { x: node.position.x + NODE_W / 2, y: node.position.y };
}
