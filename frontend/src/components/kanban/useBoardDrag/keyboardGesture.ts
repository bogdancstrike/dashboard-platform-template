import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from "react";

import type { BoardDrag, BoardDragOptions, DropTarget } from "./types";

export interface KeyboardEnv {
  opts: MutableRefObject<BoardDragOptions>;
  dragRef: MutableRefObject<BoardDrag | null>;
  commit: (next: BoardDrag | null) => void;
  announce: (text: string) => void;
  /** "In review, position 2 of 5". */
  position: (lane: string, index: number, id: string) => string;
  settle: (drop: boolean) => void;
}

/** One key on a focused card: Space lifts, the arrows travel, Space or Enter drops, Escape puts it back. */
export function keyboardStep(env: KeyboardEnv, id: string, lane: string, event: ReactKeyboardEvent<HTMLElement>) {
  if (!env.opts.current.enabled || event.target !== event.currentTarget) return;
  const current = env.dragRef.current;
  if (!current) {
    if (event.key === " ") {
      event.preventDefault();
      const origin = Math.max(0, env.opts.current.items(lane).indexOf(id));
      const height = event.currentTarget.getBoundingClientRect().height;
      env.commit({ id, from: lane, origin, over: { lane, index: origin }, mode: "keyboard", height });
      env.announce(
        `Picked up ${env.opts.current.describe(id)}, in ${env.position(lane, origin, id)}. ` +
          "Use the arrow keys to move it, Space to drop it, Escape to put it back.",
      );
    }
    return;
  }
  if (current.id !== id || current.mode !== "keyboard") return;
  const { lanes, items, resolveIndex } = env.opts.current;
  const resolve = (to: string, index: number) =>
    resolveIndex ? resolveIndex(to, id, index, current.from) : index;
  const size = (to: string) => items(to).filter((item) => item !== id).length;
  let next: DropTarget | null = null;

  switch (event.key) {
    case "ArrowLeft":
    case "ArrowRight": {
      const at = lanes.indexOf(current.over.lane);
      const to = lanes[at + (event.key === "ArrowLeft" ? -1 : 1)];
      if (to) next = { lane: to, index: resolve(to, Math.min(current.over.index, size(to))) };
      break;
    }
    case "ArrowUp":
    case "ArrowDown": {
      const index = current.over.index + (event.key === "ArrowUp" ? -1 : 1);
      if (index >= 0 && index <= size(current.over.lane)) {
        next = { lane: current.over.lane, index: resolve(current.over.lane, index) };
      }
      break;
    }
    case " ":
    case "Enter":
      event.preventDefault();
      env.settle(true);
      return;
    case "Escape":
    case "Tab":
      if (event.key === "Escape") event.preventDefault();
      env.settle(false);
      return;
    default:
      return;
  }
  event.preventDefault();
  if (next && (next.lane !== current.over.lane || next.index !== current.over.index)) {
    env.commit({ ...current, over: next });
    env.announce(`Over ${env.position(next.lane, next.index, id)}.`);
  }
}
