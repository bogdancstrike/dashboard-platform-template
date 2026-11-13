/** What the engine reads from and writes to the page: lanes, cards, scrolling edges, the lifted copy. */

import type { BoardDrag, BoardDragOptions, DropTarget } from "./types";

export const MOUSE_SLOP = 4;
export const TOUCH_HOLD_MS = 220;
export const TOUCH_SLOP = 8;
export const EDGE = 64;
export const MAX_SPEED = 18;

export function inLane(lane: string) {
  return `[data-drop-list="${CSS.escape(lane)}"] [data-drag-id]`;
}

export /**
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

/** Where the pointer is, as a lane and an index — or nothing when it is over no lane. */
export function findDropTarget(
  x: number,
  y: number,
  current: BoardDrag,
  options: BoardDragOptions,
): DropTarget | null {
  const element = document.elementFromPoint(x, y);
  const laneElement = element?.closest<HTMLElement>("[data-drop-lane]");
  const lane = laneElement?.dataset.dropLane;
  if (!lane) return null;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(inLane(lane))).filter(
    (card) => card.dataset.dragId !== current.id,
  );
  let index = cards.findIndex((card) => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
  if (index < 0) index = cards.length;
  const resolved = options.resolveIndex
    ? options.resolveIndex(lane, current.id, index, current.from)
    : index;
  return { lane, index: resolved };
}

/** Scrolls whatever the pointer is near the edge of; true when anything moved. */
export function scrollEdges(x: number, y: number): boolean {
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
  return moved;
}

/** A tilted copy of the card that follows the pointer, appended to the page. */
export function createGhost(card: HTMLElement, width: number): HTMLDivElement {
  const copy = document.createElement("div");
  copy.className = "nx-drag-ghost";
  copy.style.width = `${width}px`;
  const clone = card.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-drag-id");
  clone.removeAttribute("data-testid");
  clone.removeAttribute("id");
  copy.appendChild(clone);
  document.body.appendChild(copy);
  return copy;
}

/** The click that follows a drag is not a request to open the card. */
export function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}
