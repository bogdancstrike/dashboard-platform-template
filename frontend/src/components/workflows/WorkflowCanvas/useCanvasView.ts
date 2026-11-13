import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ForwardedRef } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent } from "react";

import type { GraphNode } from "@/api/workflowGraph";

import { NODE_H, NODE_W, autoLayout, clamp, connect, connectionProblem, fitView, moveNode } from "../graph";
import type { CanvasHandle, CanvasProps, Gesture, View } from "./types";

/** Keep receiving a gesture's moves outside the element; absent in jsdom. */
function capture(element: Element, pointerId: number): void {
  const target = element as Partial<Pick<Element, "setPointerCapture">>;
  target.setPointerCapture?.call(element, pointerId);
}

/**
 * The canvas's own state — the view (pan and zoom) and the gesture in flight —
 * and the pointer, wheel and key handlers that change it. Every edit to the
 * graph itself still goes up through `onChange`.
 */
export function useCanvasView(
  { graph, onChange, onSelect, readOnly, onMessage }: Pick<CanvasProps, "graph" | "onChange" | "onSelect" | "readOnly" | "onMessage">,
  ref: ForwardedRef<CanvasHandle>,
) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
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

  const onWheel = (event: WheelEvent) => {
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

  const onKey = (event: KeyboardEvent) => {
    if (readOnly || (event.key !== "Delete" && event.key !== "Backspace")) return;
    if ((event.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
    if (selectedEdge) {
      onChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdge) });
      setSelectedEdge(null);
    }
  };

  return {
    host, view, setView, gesture, selectedEdge, setSelectedEdge, size, fit, toGraph,
    onBackgroundDown, onNodeDown, onPortDown, onMove, onUp, onWheel, zoomBy, onKey,
  };
}
