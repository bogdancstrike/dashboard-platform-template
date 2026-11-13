/** Rearranging a dashboard's grid: closing the gaps, and packing the rows. */

import type { DashboardWidget } from "@/api/dashboards";

/**
 * The layout with every gap closed, top to bottom.
 *
 * The same rule `compactType="vertical"` applies during a drag, applied on
 * demand — because a dashboard that has been edited for a while accumulates
 * holes, and "tidy up" is a thing a person wants to press rather than a thing
 * they want to achieve by dragging every card.
 */
export function compacted(
  widgets: DashboardWidget[],
  columns: number,
): { id: string; x: number; y: number; width: number; height: number }[] {
  // The bottom of each column so far. A widget drops to the lowest row where
  // every column it spans is free, which is exactly what vertical compaction
  // means and is stable for a given reading order.
  const floor = new Array<number>(columns).fill(0);
  const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);

  const placed = ordered.map((widget) => {
    const width = Math.min(widget.width, columns);
    const x = Math.min(widget.x, columns - width);
    const y = Math.max(...floor.slice(x, x + width), 0);
    for (let column = x; column < x + width; column += 1) floor[column] = y + widget.height;
    return { id: widget.id, x, y, width, height: widget.height };
  });

  // Returned in reading order, because the server stores the array index as
  // each widget's `position` — and that is the order the one-column phone
  // layout falls back to. Sorting the *result* is also what makes tidying
  // idempotent: the geometry settles on the first pass, and without this the
  // array order kept shuffling underneath it.
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The layout auto-arranged: gaps closed *and* rows packed.
 *
 * `compacted` only pulls cards upwards, which is the rule the grid applies
 * during a drag — so a dashboard whose cards were dropped one under another
 * stays a single column of half-width cards with the right-hand side empty.
 * Tidying that is the thing somebody actually wants when they press a button
 * called auto-arrange: it fills the row before starting a new one.
 *
 * Reading order is preserved, because that is the order the reader put things
 * in and the order the one-column phone layout falls back to. Nothing is
 * resized: a card's size is a decision, and an arranger that shrinks a chart
 * to make it fit has overruled it.
 */
export function autoArranged(
  widgets: DashboardWidget[],
  columns: number,
): { id: string; x: number; y: number; width: number; height: number }[] {
  const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);

  const placed: { id: string; x: number; y: number; width: number; height: number }[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const widget of ordered) {
    const width = Math.min(Math.max(1, widget.width), columns);
    // A card that does not fit in what is left of the row starts the next one,
    // and the row advances by the *tallest* card in it — advancing by the last
    // one is what leaves a dashboard full of the holes this is meant to close.
    if (x + width > columns) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    placed.push({ id: widget.id, x, y, width, height: widget.height });
    rowHeight = Math.max(rowHeight, widget.height);
    x += width;
  }

  // Then the leftover width in each row is given back to the cards in it, so
  // the dashboard reads as full rather than as a page with a ragged right
  // edge. This is the part that makes "auto-arrange" worth pressing: packing
  // alone leaves three quarters of a row of white space whenever the cards in
  // it do not happen to add up to twelve.
  for (const row of groupByRow(placed)) {
    let spare = columns - row.reduce((sum, item) => sum + item.width, 0);
    if (spare <= 0) continue;
    // Widest first, because a wide card absorbing the slack keeps the row's
    // proportions; spreading it evenly turns a 6/3/3 row into 8/2/2 as often
    // as into 6/4/4.
    const order = [...row].sort((a, b) => b.width - a.width);
    for (let index = 0; spare > 0; index = (index + 1) % order.length) {
      const target = order[index];
      if (!target) break;
      target.width += 1;
      spare -= 1;
    }
    // Re-laid left to right, because the widths just changed underneath the
    // x positions that were computed from them.
    let cursor = 0;
    for (const item of row) {
      item.x = cursor;
      cursor += item.width;
    }
  }

  // Finally pulled upwards, so a short card beside a tall one rises into the
  // gap the tall one leaves rather than waiting for the whole row to end.
  return compacted(
    placed.map((item) => {
      const source = widgets.find((widget) => widget.id === item.id);
      return { ...source, ...item } as DashboardWidget;
    }),
    columns,
  );
}

/** The placements grouped by the row they were packed into. */
function groupByRow<T extends { y: number }>(placed: T[]): T[][] {
  const rows = new Map<number, T[]>();
  for (const item of placed) {
    const row = rows.get(item.y);
    if (row) row.push(item);
    else rows.set(item.y, [item]);
  }
  return [...rows.values()];
}
