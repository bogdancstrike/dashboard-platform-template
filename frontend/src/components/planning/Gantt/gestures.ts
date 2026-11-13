import { type PointerEvent as ReactPointerEvent } from "react";

import type { Dependency, TimelineBar } from "@/api/planning";

import { anchors, brokenBy, daysFor, dragged, type DragMode, type Zoom } from "../gantt";

import { Linking, Preview } from "./types";

/**
 * Dragging a bar or one of its ends: whole days at a time, previewed (amber
 * when it would break a dependency), written on release — or, with no
 * travel, a press that opens the bar.
 */
export function startBarDrag(
  event: ReactPointerEvent<HTMLElement>,
  {
    bar,
    mode,
    canEdit,
    zoom,
    dependencies,
    bars,
    setPreview,
    onOpen,
    onSchedule,
  }: {
    bar: TimelineBar;
    mode: DragMode;
    canEdit: boolean;
    zoom: Zoom;
    dependencies: Dependency[];
    bars: Map<string, TimelineBar>;
    setPreview: (preview: Preview | null) => void;
    onOpen: (bar: TimelineBar) => void;
    onSchedule: (bar: TimelineBar, start: string, end: string) => void;
  },
) {
  if (!canEdit || event.button !== 0) return;
  event.stopPropagation();
  event.preventDefault();
  const startX = event.clientX;
  let moved = false;
  let latest: Preview | null = null;
  const move = (e: PointerEvent) => {
    const delta = daysFor(e.clientX - startX, zoom);
    if (!moved && Math.abs(e.clientX - startX) < 3) return;
    moved = true;
    const next = dragged(bar.start, bar.end, mode, delta);
    latest = { id: bar.id, ...next, broken: brokenBy(bar.id, next.start, next.end, dependencies, bars).length };
    setPreview(latest);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    document.body.classList.remove("nx-dragging");
    setPreview(null);
    if (!moved) {
      if (mode === "move") onOpen(bar);
      return;
    }
    if (latest && (latest.start !== bar.start || latest.end !== bar.end)) {
      onSchedule(bar, latest.start, latest.end);
    }
  };
  const cancel = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    document.body.classList.remove("nx-dragging");
    setPreview(null);
  };
  document.body.classList.add("nx-dragging");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
}

/** Dragging from a bar's end dot to another bar: the second will wait on the first. */
export function startLinkDrag(
  event: ReactPointerEvent<HTMLElement>,
  {
    bar,
    canEdit,
    shown,
    local,
    setLinking,
    onLink,
  }: {
    bar: TimelineBar;
    canEdit: boolean;
    shown: ReturnType<typeof anchors>;
    local: (clientX: number, clientY: number) => { x: number; y: number };
    setLinking: (linking: Linking | null) => void;
    onLink: (predecessorId: string, successorId: string) => void;
  },
) {
  if (!canEdit || event.button !== 0) return;
  event.stopPropagation();
  event.preventDefault();
  const anchor = shown.get(bar.id);
  if (!anchor) return;
  const origin = { x1: anchor.x2, y1: anchor.y };
  const target = (e: PointerEvent) => {
    const element = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-bar-id]");
    const id = element?.dataset.barId ?? null;
    return id && id !== bar.id ? id : null;
  };
  const move = (e: PointerEvent) => {
    const point = local(e.clientX, e.clientY);
    setLinking({ from: bar.id, ...origin, x2: point.x, y2: point.y, over: target(e) });
  };
  const up = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("nx-dragging");
    setLinking(null);
    const over = target(e);
    if (over) onLink(bar.id, over);
  };
  document.body.classList.add("nx-dragging");
  setLinking({ from: bar.id, ...origin, x2: origin.x1, y2: origin.y1, over: null });
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
