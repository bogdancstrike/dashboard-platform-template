/**
 * The node canvas (§49): pan, zoom, drag steps, drag from an output to connect.
 *
 * Built rather than borrowed. A node library would be most of the canvas page's
 * weight for what is, here, a few dozen boxes and the lines between them — and
 * it would bring its own look to undo. So: one transformed layer holding an SVG
 * of edges and absolutely positioned step cards, pointer events for the three
 * gestures (pan the background, move a card, wire an output), the wheel for
 * zoom, and a minimap that is the same geometry drawn small.
 *
 * Everything the canvas draws comes from props; it owns only the view (pan and
 * zoom) and the gesture in flight. Every edit goes up through `onChange`, so the
 * page decides when to save — and the same edits are available without a
 * pointer, from the inspector, because a canvas only a mouse can drive is a
 * canvas a keyboard or a phone cannot.
 */

import { forwardRef, useMemo } from "react";

import { NODE_H, NODE_W } from "../graph";
import { CanvasControls } from "./CanvasControls";
import { CanvasEdges } from "./CanvasEdges";
import { CanvasNode } from "./CanvasNode";
import { Minimap } from "./Minimap";
import { DRAG_TYPE, type CanvasHandle, type CanvasProps } from "./types";
import { useCanvasView } from "./useCanvasView";

export { DRAG_TYPE, type CanvasHandle, type CanvasOverlay } from "./types";

export const WorkflowCanvas = forwardRef<CanvasHandle, CanvasProps>(function WorkflowCanvas(props, ref) {
  const { graph, onChange, selected, onSelect, summaries, problems, overlay, readOnly, onDropItem } = props;
  const canvas = useCanvasView(props, ref);
  const { host, view, setView, gesture, selectedEdge, setSelectedEdge, toGraph } = canvas;
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const { width: viewWidth, height: viewHeight } = canvas.size();
  const unlink = () => {
    onChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdge) });
    setSelectedEdge(null);
  };

  return (
    <div
      ref={host}
      className={`nx-wf-canvas${gesture?.kind === "pan" ? " is-panning" : ""}`}
      data-testid="workflow-canvas"
      tabIndex={0}
      role="application"
      aria-label="Workflow canvas"
      onPointerDown={canvas.onBackgroundDown}
      onPointerMove={canvas.onMove}
      onPointerUp={canvas.onUp}
      onWheel={canvas.onWheel}
      onKeyDown={canvas.onKey}
      onDragOver={(event) => {
        if (!readOnly && event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
      }}
      onDrop={(event) => {
        const payload = event.dataTransfer.getData(DRAG_TYPE);
        if (!payload || readOnly) return;
        event.preventDefault();
        const at = toGraph(event.clientX, event.clientY);
        onDropItem?.(payload, { x: Math.round(at.x - NODE_W / 2), y: Math.round(at.y - NODE_H / 2) });
      }}
    >
      <div
        className="nx-wf-layer"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <CanvasEdges
          graph={graph}
          byId={byId}
          overlay={overlay}
          selectedEdge={selectedEdge}
          onPick={(edgeId) => { setSelectedEdge(edgeId); onSelect(null); }}
          gesture={gesture}
        />

        {graph.nodes.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            summary={summaries[node.id] ?? { title: node.type, detail: "" }}
            issues={problems[node.id] ?? []}
            selected={selected === node.id}
            overlay={overlay}
            onSelect={onSelect}
            onNodeDown={canvas.onNodeDown}
            onPortDown={canvas.onPortDown}
          />
        ))}
      </div>

      <CanvasControls
        zoom={view.zoom}
        onZoom={canvas.zoomBy}
        onFit={canvas.fit}
        onUnlink={selectedEdge && !readOnly ? unlink : undefined}
      />

      <Minimap graph={graph} problems={problems} view={view} setView={setView} viewWidth={viewWidth} viewHeight={viewHeight} />
    </div>
  );
});
