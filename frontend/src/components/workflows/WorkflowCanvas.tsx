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

import { Tooltip } from "antd";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { GraphNode, WorkflowGraph } from "@/api/workflowGraph";
import { NxIcon, type NxIconName } from "@/components/NxIcon";

import {
  NODE_H,
  NODE_W,
  PORT_LABEL,
  autoLayout,
  bounds,
  clamp,
  connect,
  connectionProblem,
  edgePath,
  fitView,
  iconFor,
  moveNode,
  portOffset,
  portsOf,
} from "./graph";

export interface CanvasOverlay {
  /** Per-node badges: counts from run history, or a test run's states. */
  badges: Record<string, Array<{ label: string; tone: "ok" | "warn" | "bad" | "acc" }>>;
  /** Steps and connections to emphasise; everything else is dimmed. */
  path?: { nodes: Set<string>; edges: Set<string> };
  /** Counts drawn on connections. */
  edgeCounts?: Record<string, number>;
}

export interface CanvasHandle {
  fit: () => void;
  layout: () => void;
  /** The graph point at the centre of the view, for steps added by a click. */
  centre: () => { x: number; y: number };
}

interface Props {
  graph: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  summaries: Record<string, { title: string; detail: string }>;
  problems: Record<string, string[]>;
  overlay?: CanvasOverlay | null;
  readOnly?: boolean;
  /** A palette item dropped on the canvas, at a graph position. */
  onDropItem?: (payload: string, position: { x: number; y: number }) => void;
  onMessage?: (text: string) => void;
}

type Gesture =
  | { kind: "pan"; startX: number; startY: number; viewX: number; viewY: number }
  | { kind: "move"; id: string; startX: number; startY: number; nodeX: number; nodeY: number; moved: boolean }
  | { kind: "wire"; source: string; port: string; x: number; y: number };

export const DRAG_TYPE = "application/x-nucleus-step";

/** Keep receiving a gesture's moves outside the element; absent in jsdom. */
function capture(element: Element, pointerId: number): void {
  const target = element as Partial<Pick<Element, "setPointerCapture">>;
  target.setPointerCapture?.call(element, pointerId);
}

export const WorkflowCanvas = forwardRef<CanvasHandle, Props>(function WorkflowCanvas(
  { graph, onChange, selected, onSelect, summaries, problems, overlay, readOnly, onDropItem, onMessage },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, zoom: 1 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const fitted = useRef(false);

  const size = () => ({
    width: host.current?.clientWidth || 800,
    height: host.current?.clientHeight || 520,
  });

  const fit = useCallback(() => {
    const { width, height } = size();
    setView(fitView(graph, width, height));
  }, [graph]);

  useImperativeHandle(ref, () => ({
    fit,
    layout: () => {
      const laid = autoLayout(graph);
      onChange(laid);
      const { width, height } = size();
      setView(fitView(laid, width, height));
    },
    centre: () => {
      const { width, height } = size();
      return { x: (width / 2 - view.x) / view.zoom - NODE_W / 2, y: (height / 2 - view.y) / view.zoom - NODE_H / 2 };
    },
  }), [fit, graph, onChange, view]);

  useEffect(() => {
    if (!fitted.current && graph.nodes.length) {
      fitted.current = true;
      fit();
    }
  }, [fit, graph.nodes.length]);

  const toGraph = (clientX: number, clientY: number) => {
    const rect = host.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: ((clientX || 0) - left - view.x) / view.zoom, y: ((clientY || 0) - top - view.y) / view.zoom };
  };

  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  // ── gestures ──
  const onBackgroundDown = (event: ReactPointerEvent) => {
    if (event.button > 0) return;
    onSelect(null);
    setSelectedEdge(null);
    setGesture({ kind: "pan", startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y });
    capture(event.target as Element, event.pointerId);
  };

  const onNodeDown = (event: ReactPointerEvent, node: GraphNode) => {
    event.stopPropagation();
    if (event.button > 0) return;
    onSelect(node.id);
    setSelectedEdge(null);
    if (readOnly) return;
    setGesture({ kind: "move", id: node.id, startX: event.clientX, startY: event.clientY,
      nodeX: node.position.x, nodeY: node.position.y, moved: false });
    capture(event.currentTarget, event.pointerId);
  };

  const onPortDown = (event: ReactPointerEvent, node: GraphNode, port: string) => {
    event.stopPropagation();
    if (readOnly || event.button > 0) return;
    const at = toGraph(event.clientX, event.clientY);
    setGesture({ kind: "wire", source: node.id, port, x: at.x, y: at.y });
    capture(event.currentTarget, event.pointerId);
  };

  const onMove = (event: ReactPointerEvent) => {
    if (!gesture) return;
    if (gesture.kind === "pan") {
      setView((current) => ({ ...current, x: gesture.viewX + event.clientX - gesture.startX,
        y: gesture.viewY + event.clientY - gesture.startY }));
    } else if (gesture.kind === "move") {
      const dx = (event.clientX - gesture.startX) / view.zoom;
      const dy = (event.clientY - gesture.startY) / view.zoom;
      if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      setGesture({ ...gesture, moved: true });
      onChange(moveNode(graph, gesture.id, { x: Math.round(gesture.nodeX + dx), y: Math.round(gesture.nodeY + dy) }));
    } else {
      const at = toGraph(event.clientX, event.clientY);
      setGesture({ ...gesture, x: at.x, y: at.y });
    }
  };

  const onUp = (event: ReactPointerEvent) => {
    if (gesture?.kind === "wire") {
      // jsdom has no `elementFromPoint`; a browser always does.
      const locate = (document as Partial<Document>).elementFromPoint?.bind(document);
      const hit = locate?.(event.clientX, event.clientY)?.closest("[data-node-id]");
      const target = hit?.getAttribute("data-node-id");
      if (target) {
        const problem = connectionProblem(graph, gesture.source, gesture.port, target);
        if (problem) onMessage?.(problem);
        else onChange(connect(graph, gesture.source, gesture.port, target));
      }
    }
    setGesture(null);
  };

  const onWheel = (event: React.WheelEvent) => {
    const rect = host.current?.getBoundingClientRect();
    const px = event.clientX - (rect?.left ?? 0);
    const py = event.clientY - (rect?.top ?? 0);
    setView((current) => {
      const zoom = clamp(current.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.3, 2);
      const scale = zoom / current.zoom;
      return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
    });
  };

  const zoomBy = (factor: number) => {
    const { width, height } = size();
    setView((current) => {
      const zoom = clamp(current.zoom * factor, 0.3, 2);
      const scale = zoom / current.zoom;
      return { zoom, x: width / 2 - (width / 2 - current.x) * scale, y: height / 2 - (height / 2 - current.y) * scale };
    });
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (readOnly || (event.key !== "Delete" && event.key !== "Backspace")) return;
    if ((event.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
    if (selectedEdge) {
      onChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdge) });
      setSelectedEdge(null);
    }
  };

  // ── drawing ──
  const anchor = (node: GraphNode, port: string) => {
    const offset = portOffset(node, port);
    return { x: node.position.x + offset.x, y: node.position.y + offset.y };
  };
  const input = (node: GraphNode) => ({ x: node.position.x + NODE_W / 2, y: node.position.y });
  const path = overlay?.path;

  const box = bounds(graph);
  const mini = { width: 168, height: 112 };
  const miniScale = Math.min(mini.width / (box.width + 80), mini.height / (box.height + 80));
  const { width: viewWidth, height: viewHeight } = size();

  return (
    <div
      ref={host}
      className={`nx-wf-canvas${gesture?.kind === "pan" ? " is-panning" : ""}`}
      data-testid="workflow-canvas"
      tabIndex={0}
      role="application"
      aria-label="Workflow canvas"
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onWheel={onWheel}
      onKeyDown={onKey}
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
                  onPointerDown={(event) => { event.stopPropagation(); setSelectedEdge(edge.id); onSelect(null); }} />
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

        {graph.nodes.map((node) => {
          const summary = summaries[node.id] ?? { title: node.type, detail: "" };
          const issues = problems[node.id] ?? [];
          const dim = path && !path.nodes.has(node.id);
          const badges = overlay?.badges[node.id] ?? [];
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              data-testid={`node-${node.id}`}
              className={[
                "nx-wf-node", `nx-wf-node--${node.type}`,
                selected === node.id ? "is-selected" : "",
                issues.length ? "has-problem" : "",
                dim ? "is-dim" : "",
                path?.nodes.has(node.id) ? "is-hot" : "",
              ].join(" ")}
              style={{ left: node.position.x, top: node.position.y, width: NODE_W, height: NODE_H }}
              onPointerDown={(event) => onNodeDown(event, node)}
              role="button"
              tabIndex={0}
              aria-label={`${summary.title}${summary.detail ? `: ${summary.detail}` : ""}${issues.length ? ` — ${issues.length} problem${issues.length === 1 ? "" : "s"}` : ""}`}
              aria-pressed={selected === node.id}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); }
              }}
            >
              {node.type !== "trigger" && <span className="nx-wf-port nx-wf-port--in" aria-hidden="true" />}
              <span className="nx-wf-node-icon" aria-hidden="true"><NxIcon name={iconFor(node) as NxIconName} size={16} /></span>
              <span className="nx-wf-node-text">
                <span className="nx-wf-node-kind">{node.type === "trigger" ? "When" : node.type === "action" ? "Then" : "If"}</span>
                <span className="nx-wf-node-title">{summary.title}</span>
                <span className="nx-wf-node-detail">{summary.detail}</span>
              </span>
              {issues.length > 0 && (
                <Tooltip title={issues.join(" ")}>
                  <span className="nx-wf-node-problem" data-testid={`problem-${node.id}`} role="img" aria-label={issues.join(" ")}>!</span>
                </Tooltip>
              )}
              {badges.length > 0 && (
                <span className="nx-wf-badges">
                  {badges.map((badge) => (
                    <span key={badge.label} className={`nx-wf-badge nx-wf-badge--${badge.tone}`}>{badge.label}</span>
                  ))}
                </span>
              )}
              {portsOf(node).map((port) => {
                const offset = portOffset(node, port);
                return (
                  <span
                    key={port}
                    className={`nx-wf-port nx-wf-port--out nx-wf-port--${port}`}
                    style={{ left: offset.x }}
                    data-testid={`port-${node.id}-${port}`}
                    title={PORT_LABEL[port] || "Drag to connect"}
                    onPointerDown={(event) => onPortDown(event, node, port)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="nx-wf-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
        <button type="button" aria-label="Fit to view" onClick={fit} data-testid="canvas-fit">
          <NxIcon name="expandAll" size={14} />
        </button>
        <span className="nx-wf-zoom" aria-live="polite">{Math.round(view.zoom * 100)}%</span>
        {selectedEdge && !readOnly && (
          <button type="button" className="nx-wf-unlink" data-testid="delete-edge"
            onClick={() => { onChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdge) }); setSelectedEdge(null); }}>
            Remove connection
          </button>
        )}
      </div>

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
    </div>
  );
});
