/**
 * Drag a card between lanes — by pointer, by touch, and by keyboard (§18, §54).
 *
 * The browser's own drag-and-drop draws a translucent screenshot that cannot
 * be styled, does not fire on touch at all, and hides the payload while it is
 * in the air. A board is the surface people drag on most, so this is a small
 * engine of its own instead:
 *
 * * **The whole card is the handle.** A mouse press becomes a drag after a few
 *   pixels of travel, so a click still opens the card; a finger has to rest
 *   for a moment first, so a swipe still scrolls the page.
 * * **The card is lifted, not ghosted.** A copy follows the pointer with a
 *   slight tilt and a deep shadow, and the card's place in its lane closes up.
 * * **The landing is drawn.** The lane under the pointer lights up and a gap
 *   the size of the card opens where it will land — at the pointer on an
 *   arranged board, at its sorted place on a sorted one (`resolveIndex`).
 * * **Edges scroll.** Near the side of the board, the bottom of a lane or the
 *   window, the content scrolls under the card.
 * * **The drop settles.** The lifted copy glides into the gap before the
 *   board re-renders, so the card is never seen to jump.
 * * **Keyboard:** Space picks the focused card up, the arrows move it between
 *   and within lanes, Space or Enter drops, Escape puts it back — each step
 *   announced through a live region.
 *
 * The page owns the data and the write; this owns the gesture.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { createGhost, findDropTarget, refocus, scrollEdges } from "./dom";
import { keyboardStep } from "./keyboardGesture";
import { startPointerGesture } from "./pointerGesture";
import { renderLaneItems } from "./renderLane";
import type { BoardDrag, BoardDragOptions } from "./types";

export { DropGap } from "./DropGap";
export type { BoardDrag, BoardDragOptions, DropTarget } from "./types";

export function useBoardDrag(options: BoardDragOptions) {
  const [drag, setDrag] = useState<BoardDrag | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const hintId = useId();

  const opts = useRef(options);
  opts.current = options;
  const dragRef = useRef<BoardDrag | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0, offX: 0, offY: 0 });
  const frame = useRef<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  const commit = useCallback((next: BoardDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const announce = useCallback((text: string) => setAnnouncement(text), []);

  const position = (lane: string, index: number, id: string) => {
    const count = opts.current.items(lane).filter((item) => item !== id).length + 1;
    return `${opts.current.laneName(lane)}, position ${index + 1} of ${count}`;
  };

  /** Where the pointer is, as a lane and an index. */
  const hitTest = useCallback(() => {
    const current = dragRef.current;
    if (!current) return;
    const target = findDropTarget(pointer.current.x, pointer.current.y, current, opts.current);
    if (!target) return;
    const { lane, index: resolved } = target;
    if (current.over.lane !== lane || current.over.index !== resolved) {
      commit({ ...current, over: { lane, index: resolved } });
    }
  }, [commit]);

  const placeGhost = () => {
    const { x, y, offX, offY } = pointer.current;
    if (ghost.current) {
      ghost.current.style.transform = `translate3d(${x - offX}px, ${y - offY}px, 0) rotate(2.5deg) scale(1.03)`;
    }
  };

  /** Scrolls whatever the pointer is near the edge of, every frame of the drag. */
  const tick = useCallback(() => {
    frame.current = null;
    const current = dragRef.current;
    if (!current || current.mode !== "pointer") return;
    const { x, y } = pointer.current;
    if (scrollEdges(x, y)) hitTest();
    frame.current = window.requestAnimationFrame(tick);
  }, [hitTest]);

  const removeGhost = () => {
    ghost.current?.remove();
    ghost.current = null;
  };

  const settle = useCallback(
    (drop: boolean) => {
      const current = dragRef.current;
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
      cleanup.current?.();
      cleanup.current = null;
      if (!current) return;

      const target = drop ? current.over : { lane: current.from, index: current.origin };
      const changed = target.lane !== current.from || target.index !== current.origin;
      const finish = () => {
        removeGhost();
        commit(null);
        if (changed) {
          opts.current.onDrop(current.id, current.from, target);
          setLanded(current.id);
          window.setTimeout(() => setLanded((value) => (value === current.id ? null : value)), 700);
          announce(`Dropped ${opts.current.describe(current.id)} in ${position(target.lane, target.index, current.id)}.`);
          if (current.mode === "keyboard") refocus(current.id);
        } else {
          announce(`${opts.current.describe(current.id)} is back where it was.`);
        }
      };

      if (current.mode === "pointer" && ghost.current) {
        if (!drop) commit({ ...current, over: target });
        // Glide into the gap, then let the board re-render under it.
        window.requestAnimationFrame(() => {
          const slot = document.querySelector<HTMLElement>("[data-drop-slot]");
          const element = ghost.current;
          if (!element) return finish();
          const box = slot?.getBoundingClientRect();
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!box || reduce) return finish();
          element.classList.add("is-settling");
          element.style.transform = `translate3d(${box.left}px, ${box.top}px, 0) rotate(0deg) scale(1)`;
          window.setTimeout(finish, 190);
        });
      } else {
        finish();
      }
    },
    [announce, commit],
  );

  // Never leave a lifted card behind a route change.
  useEffect(
    () => () => {
      cleanup.current?.();
      removeGhost();
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    },
    [],
  );

  const lift = useCallback(
    (card: HTMLElement, id: string, from: string, x: number, y: number) => {
      const box = card.getBoundingClientRect();
      pointer.current = { x, y, offX: x - box.left, offY: y - box.top };
      const origin = opts.current.items(from).indexOf(id);

      const copy = createGhost(card, box.width);
      ghost.current = copy;
      placeGhost();

      commit({
        id,
        from,
        origin: Math.max(0, origin),
        over: { lane: from, index: Math.max(0, origin) },
        mode: "pointer",
        height: box.height,
      });
      announce(`Picked up ${opts.current.describe(id)}.`);
      document.body.classList.add("nx-dragging");
      if (frame.current === null) frame.current = window.requestAnimationFrame(tick);
    },
    [announce, commit, tick],
  );

  /** Pointer handlers for one card. */
  const onPointerDown = (id: string, lane: string) => (event: React.PointerEvent<HTMLElement>) =>
    startPointerGesture({ opts, dragRef, pointer, cleanup, lift, placeGhost, hitTest, settle }, id, lane, event);

  /** Keyboard handler for one card: Space lifts, arrows travel, Space/Enter drops. */
  const onKeyDown = (id: string, lane: string) => (event: React.KeyboardEvent<HTMLElement>) =>
    keyboardStep({ opts, dragRef, commit, announce, position, settle }, id, lane, event);

  /** Everything a card needs to be draggable. */
  const cardProps = (id: string, lane: string) => {
    const carried = drag?.id === id;
    return {
      "data-drag-id": id,
      tabIndex: 0,
      "aria-roledescription": "draggable card",
      "aria-describedby": options.enabled ? hintId : undefined,
      "aria-grabbed": options.enabled ? carried : undefined,
      onPointerDown: onPointerDown(id, lane),
      onKeyDown: onKeyDown(id, lane),
      onBlur: () => {
        if (dragRef.current?.mode === "keyboard" && dragRef.current.id === id) settle(false);
      },
      className: [
        "nx-draggable",
        options.enabled ? "is-movable" : "",
        carried ? (drag.mode === "pointer" ? "is-carried" : "is-lifted") : "",
        landed === id ? "is-landed" : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  };

  /** Marks a lane as a place a card can be dropped. */
  const laneProps = (lane: string) => ({
    "data-drop-lane": lane,
    className:
      drag && drag.over.lane === lane
        ? drag.from === lane && drag.over.index === drag.origin
          ? "is-drop-source"
          : "is-drop-target"
        : "",
  });

  /** A lane's cards with the gap opened where the carried card would land. */
  function renderLane<T>(
    lane: string,
    rows: T[],
    getId: (row: T) => string,
    render: (row: T, index: number) => ReactNode,
    slot: (height: number) => ReactNode,
  ): ReactNode[] {
    return renderLaneItems(drag, lane, rows, getId, render, slot);
  }

  const overlay = createPortal(
    <>
      <span id={hintId} className="nx-sr-only">
        Press Space to pick this card up, the arrow keys to move it, and Space again to drop it.
      </span>
      <span className="nx-sr-only" role="status" aria-live="assertive" data-testid="drag-announcer">
        {announcement}
      </span>
    </>,
    document.body,
  );

  return { drag, cardProps, laneProps, renderLane, overlay, isDragging: drag !== null };
}
