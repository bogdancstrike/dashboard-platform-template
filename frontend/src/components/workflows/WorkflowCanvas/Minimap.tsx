import type { Dispatch, SetStateAction } from "react";

import type { WorkflowGraph } from "@/api/workflowGraph";

import { NODE_H, NODE_W, bounds } from "../graph";
import type { View } from "./types";

interface MinimapProps {
  graph: WorkflowGraph;
  problems: Record<string, string[]>;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  viewWidth: number;
  viewHeight: number;
}

/** The same geometry drawn small, with the view's rectangle; a press re-centres the view there. */
export function Minimap({ graph, problems, view, setView, viewWidth, viewHeight }: MinimapProps) {
  const box = bounds(graph);
  const mini = { width: 168, height: 112 };
  const miniScale = Math.min(mini.width / (box.width + 80), mini.height / (box.height + 80));
  return (
    <svg
      className="nx-wf-minimap"
      width={mini.width}
      height={mini.height}
      data-testid="canvas-minimap"
      aria-label="Minimap"
      role="img"
      onPointerDown={(event) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const gx = (event.clientX - rect.left) / miniScale + box.x - 40;
        const gy = (event.clientY - rect.top) / miniScale + box.y - 40;
        setView((current) => ({ ...current, x: viewWidth / 2 - gx * current.zoom, y: viewHeight / 2 - gy * current.zoom }));
      }}
    >
      <g transform={`scale(${miniScale}) translate(${40 - box.x} ${40 - box.y})`}>
        {graph.nodes.map((node) => (
          <rect key={node.id} x={node.position.x} y={node.position.y} width={NODE_W} height={NODE_H} rx={18}
            className={`nx-wf-mini-node nx-wf-mini-node--${node.type}${problems[node.id]?.length ? " has-problem" : ""}`} />
        ))}
        <rect className="nx-wf-mini-view" x={-view.x / view.zoom} y={-view.y / view.zoom}
          width={viewWidth / view.zoom} height={viewHeight / view.zoom} rx={12} />
      </g>
    </svg>
  );
}
