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

export interface DropTarget {
  lane: string;
  /** Position in the lane, counted without the carried card. */
  index: number;
}

export interface BoardDrag {
  id: string;
  from: string;
  /** Where the card started, counted the same way as `over.index`. */
  origin: number;
  over: DropTarget;
  mode: "pointer" | "keyboard";
  /** The lifted card's height, so the gap it leaves is its own size. */
  height: number;
}

export interface BoardDragOptions {
  enabled: boolean;
  /** Lane ids, left to right. */
  lanes: string[];
  /** The card ids in a lane, top to bottom, as drawn. */
  items: (lane: string) => string[];
  /** Where a card would land given where the pointer is; defaults to the pointer's index. */
  resolveIndex?: (lane: string, id: string, pointerIndex: number, from: string) => number;
  /** The move itself. Not called when the card is put back where it was. */
  onDrop: (id: string, from: string, to: DropTarget) => void;
  /** "TSK-00012 Fix the importer", for announcements. */
  describe: (id: string) => string;
  laneName: (lane: string) => string;
}

const MOUSE_SLOP = 4;
const TOUCH_HOLD_MS = 220;
const TOUCH_SLOP = 8;
const EDGE = 64;
const MAX_SPEED = 18;

function inLane(lane: string) {
  return `[data-drop-list="${CSS.escape(lane)}"] [data-drag-id]`;
}

/**
 * Keeps focus on a card that re-mounts in another lane after a keyboard drop.
 *
 * The optimistic move and the refetch that follows can each re-mount it, so
 * this watches for a little while — and stops the moment the reader has put
 * focus somewhere else themselves.
 */
function refocus(id: string, tries = 30) {
  window.setTimeout(() => {
    const card = document.querySelector<HTMLElement>(`[data-drag-id="${CSS.escape(id)}"]`);
    const active = document.activeElement;
    const lost = !active || active === document.body;
    if (card && active !== card && lost) card.focus();
    if (tries > 0 && (lost || active === card)) refocus(id, tries - 1);
  }, 60);
}

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
    const { x, y } = pointer.current;
    const element = document.elementFromPoint(x, y);
    const laneElement = element?.closest<HTMLElement>("[data-drop-lane]");
    const lane = laneElement?.dataset.dropLane;
    if (!lane) return;
    const cards = Array.from(document.querySelectorAll<HTMLElement>(inLane(lane))).filter(
      (card) => card.dataset.dragId !== current.id,
    );
    let index = cards.findIndex((card) => {
      const box = card.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    if (index < 0) index = cards.length;
    const resolved = opts.current.resolveIndex
      ? opts.current.resolveIndex(lane, current.id, index, current.from)
      : index;
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
    let moved = false;
    const speed = (distance: number) =>
      Math.ceil(MAX_SPEED * Math.min(1, Math.max(0, (EDGE - distance) / EDGE)));

    const scrollers = new Set<HTMLElement>();
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    let node: HTMLElement | null = under;
    while (node) {
      if (node.dataset.dragScroll !== undefined || node.classList.contains("nx-scroll")) {
        scrollers.add(node);
      }
      node = node.parentElement;
    }
    document.querySelectorAll<HTMLElement>("[data-drag-scroll]").forEach((el) => scrollers.add(el));

    for (const element of scrollers) {
      const box = element.getBoundingClientRect();
      if (y < box.top - EDGE || y > box.bottom + EDGE || x < box.left - EDGE || x > box.right + EDGE) continue;
      if (element.scrollWidth > element.clientWidth) {
        const left = x - box.left;
        const right = box.right - x;
        if (left < EDGE && element.scrollLeft > 0) {
          element.scrollLeft -= speed(left);
          moved = true;
        } else if (right < EDGE && element.scrollLeft + element.clientWidth < element.scrollWidth) {
          element.scrollLeft += speed(right);
          moved = true;
        }
      }
      if (element.scrollHeight > element.clientHeight + 1) {
        const top = y - box.top;
        const bottom = box.bottom - y;
        if (top < EDGE && element.scrollTop > 0) {
          element.scrollTop -= speed(top);
          moved = true;
        } else if (bottom < EDGE && element.scrollTop + element.clientHeight < element.scrollHeight) {
          element.scrollTop += speed(bottom);
          moved = true;
        }
      }
    }
    if (moved) hitTest();
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

      const copy = document.createElement("div");
      copy.className = "nx-drag-ghost";
      copy.style.width = `${box.width}px`;
      const clone = card.cloneNode(true) as HTMLElement;
      clone.removeAttribute("data-drag-id");
      clone.removeAttribute("data-testid");
      clone.removeAttribute("id");
      copy.appendChild(clone);
      document.body.appendChild(copy);
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
  const onPointerDown = (id: string, lane: string) => (event: React.PointerEvent<HTMLElement>) => {
    if (!opts.current.enabled || dragRef.current || event.button !== 0) return;
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
      lift(card, id, lane, x, y);
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
      pointer.current.x = e.clientX;
      pointer.current.y = e.clientY;
      placeGhost();
      hitTest();
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
      // The click that follows a drag is not a request to open the card.
      const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      settle(true);
    };
    const cancel = () => {
      stop();
      if (lifted) settle(false);
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
      cleanup.current = null;
    }

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    document.addEventListener("touchmove", blockScroll, { passive: false });
    window.addEventListener("contextmenu", noMenu, true);
    cleanup.current = stop;
    if (touch) {
      hold = window.setTimeout(() => {
        hold = null;
        if ("vibrate" in navigator) navigator.vibrate(8);
        begin(pointer.current.x || startX, pointer.current.y || startY);
      }, TOUCH_HOLD_MS);
      pointer.current.x = startX;
      pointer.current.y = startY;
    }
  };

  /** Keyboard handler for one card: Space lifts, arrows travel, Space/Enter drops. */
  const onKeyDown = (id: string, lane: string) => (event: React.KeyboardEvent<HTMLElement>) => {
    if (!opts.current.enabled || event.target !== event.currentTarget) return;
    const current = dragRef.current;
    if (!current) {
      if (event.key === " ") {
        event.preventDefault();
        const origin = Math.max(0, opts.current.items(lane).indexOf(id));
        const height = event.currentTarget.getBoundingClientRect().height;
        commit({ id, from: lane, origin, over: { lane, index: origin }, mode: "keyboard", height });
        announce(
          `Picked up ${opts.current.describe(id)}, in ${position(lane, origin, id)}. ` +
            "Use the arrow keys to move it, Space to drop it, Escape to put it back.",
        );
      }
      return;
    }
    if (current.id !== id || current.mode !== "keyboard") return;
    const { lanes, items, resolveIndex } = opts.current;
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
        settle(true);
        return;
      case "Escape":
      case "Tab":
        if (event.key === "Escape") event.preventDefault();
        settle(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next && (next.lane !== current.over.lane || next.index !== current.over.index)) {
      commit({ ...current, over: next });
      announce(`Over ${position(next.lane, next.index, id)}.`);
    }
  };

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

  /**
   * A lane's cards with the gap opened where the carried card would land.
   *
   * The carried card stays in the tree (hidden while a pointer carries it, so
   * the lane closes up behind it) and the gap is counted without it.
   */
  function renderLane<T>(
    lane: string,
    rows: T[],
    getId: (row: T) => string,
    render: (row: T, index: number) => ReactNode,
    slot: (height: number) => ReactNode,
  ): ReactNode[] {
    const out: ReactNode[] = [];
    const showSlot =
      drag !== null &&
      drag.over.lane === lane &&
      !(drag.mode === "keyboard" && drag.from === lane && drag.over.index === drag.origin);
    let visible = 0;
    rows.forEach((row, index) => {
      const id = getId(row);
      const hidden = drag?.mode === "pointer" && drag.id === id;
      if (!hidden && showSlot && visible === drag.over.index) out.push(slot(drag.height));
      out.push(render(row, index));
      // The carried card is not counted: indexes are positions without it.
      if (drag?.id !== id) visible += 1;
    });
    if (showSlot && drag.over.index >= visible) out.push(slot(drag.height));
    return out;
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

/** The gap a carried card will land in. */
export function DropGap({ height, label = "Drop here" }: { height: number; label?: string }) {
  return (
    <li
      className="nx-drop-gap"
      data-drop-slot
      data-testid="drop-slot"
      aria-hidden
      style={{ height: Math.max(48, Math.round(height)) }}
    >
      <span>{label}</span>
    </li>
  );
}
