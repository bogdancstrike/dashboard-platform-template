import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";

import { MOUSE_SLOP, swallowNextClick, TOUCH_HOLD_MS, TOUCH_SLOP } from "./dom";
import type { BoardDrag, BoardDragOptions } from "./types";

/** What a gesture needs from the engine. */
export interface PointerEnv {
  opts: MutableRefObject<BoardDragOptions>;
  dragRef: MutableRefObject<BoardDrag | null>;
  pointer: MutableRefObject<{ x: number; y: number; offX: number; offY: number }>;
  cleanup: MutableRefObject<(() => void) | null>;
  lift: (card: HTMLElement, id: string, from: string, x: number, y: number) => void;
  placeGhost: () => void;
  hitTest: () => void;
  settle: (drop: boolean) => void;
}

/**
 * A press on a card: a mouse becomes a drag after a few pixels of travel, a
 * finger after a short hold (a swipe before it is a scroll). Window listeners
 * follow the pointer until it is released, cancelled or Escape is pressed.
 */
export function startPointerGesture(env: PointerEnv, id: string, lane: string, event: ReactPointerEvent<HTMLElement>) {
  if (!env.opts.current.enabled || env.dragRef.current || event.button !== 0) return;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable=true], [data-no-drag]")) return;
  const card = event.currentTarget;
  const startX = event.clientX;
  const startY = event.clientY;
  const touch = event.pointerType !== "mouse";
  let lifted = false;
  let hold: number | null = null;

  const begin = (x: number, y: number) => {
    lifted = true;
    env.lift(card, id, lane, x, y);
  };

  const move = (e: PointerEvent) => {
    if (!lifted) {
      const travelled = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (touch) {
        // A finger that moves before the hold is a scroll, not a drag.
        if (travelled > TOUCH_SLOP) stop();
        return;
      }
      if (travelled < MOUSE_SLOP) return;
      begin(e.clientX, e.clientY);
    }
    e.preventDefault();
    env.pointer.current.x = e.clientX;
    env.pointer.current.y = e.clientY;
    env.placeGhost();
    env.hitTest();
  };
  const blockScroll = (e: TouchEvent) => {
    if (lifted) e.preventDefault();
  };
  const noMenu = (e: Event) => {
    if (lifted || hold !== null) e.preventDefault();
  };
  const up = () => {
    stop();
    if (!lifted) return;
    swallowNextClick();
    env.settle(true);
  };
  const cancel = () => {
    stop();
    if (lifted) env.settle(false);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && lifted) {
      e.preventDefault();
      cancel();
    }
  };
  function stop() {
    if (hold !== null) window.clearTimeout(hold);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    document.removeEventListener("touchmove", blockScroll);
    window.removeEventListener("contextmenu", noMenu, true);
    document.body.classList.remove("nx-dragging");
    env.cleanup.current = null;
  }

  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
  document.addEventListener("touchmove", blockScroll, { passive: false });
  window.addEventListener("contextmenu", noMenu, true);
  env.cleanup.current = stop;
  if (touch) {
    hold = window.setTimeout(() => {
      hold = null;
      if ("vibrate" in navigator) navigator.vibrate(8);
      begin(env.pointer.current.x || startX, env.pointer.current.y || startY);
    }, TOUCH_HOLD_MS);
    env.pointer.current.x = startX;
    env.pointer.current.y = startY;
  }
}
