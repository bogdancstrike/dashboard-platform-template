import type { ReactNode } from "react";

import type { BoardDrag } from "./types";

/**
 * A lane's cards with the gap opened where the carried card would land.
 *
 * The carried card stays in the tree (hidden while a pointer carries it, so
 * the lane closes up behind it) and the gap is counted without it.
 */
export function renderLaneItems<T>(
  drag: BoardDrag | null,
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
