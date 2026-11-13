import type { GraphNode, WorkflowGraph } from "@/api/workflowGraph";

import { PORT_LABEL, edgePath } from "../graph";
import { anchor, input } from "./geometry";
import type { CanvasOverlay, Gesture } from "./types";

interface CanvasEdgesProps {
  graph: WorkflowGraph;
  byId: Map<string, GraphNode>;
  overlay?: CanvasOverlay | null;
  selectedEdge: string | null;
  onPick: (edgeId: string) => void;
  gesture: Gesture | null;
}

/** The connections, their port labels and run counts, and the wire being drawn. */
export function CanvasEdges({ graph, byId, overlay, selectedEdge, onPick, gesture }: CanvasEdgesProps) {
  const path = overlay?.path;
  return (
    <svg className="nx-wf-edges" width="1" height="1" aria-hidden="true">
      {graph.edges.map((edge) => {
        const from = byId.get(edge.source);
        const to = byId.get(edge.target);
        if (!from || !to) return null;
        const start = anchor(from, edge.port);
        const end = input(to);
        const dim = path && !path.edges.has(edge.id);
        const count = overlay?.edgeCounts?.[edge.id];
        const label = PORT_LABEL[edge.port];
        return (
          <g key={edge.id} className={`nx-wf-edge${selectedEdge === edge.id ? " is-selected" : ""}${dim ? " is-dim" : ""}${path?.edges.has(edge.id) ? " is-hot" : ""}`}>
            <path d={edgePath(start, end)} className="nx-wf-edge-hit" data-testid={`edge-${edge.id}`}
              onPointerDown={(event) => { event.stopPropagation(); onPick(edge.id); }} />
            <path d={edgePath(start, end)} className="nx-wf-edge-line" />
            {label && <text x={start.x + 6} y={start.y + 16} className="nx-wf-edge-label">{label}</text>}
            {count ? (
              <text x={(start.x + end.x) / 2 + 8} y={(start.y + end.y) / 2} className="nx-wf-edge-count">{count}</text>
            ) : null}
          </g>
        );
      })}
      {gesture?.kind === "wire" && byId.get(gesture.source) && (
        <path className="nx-wf-edge-draft" d={edgePath(anchor(byId.get(gesture.source)!, gesture.port), { x: gesture.x, y: gesture.y })} />
      )}
    </svg>
  );
}
