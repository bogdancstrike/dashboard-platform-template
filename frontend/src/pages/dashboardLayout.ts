/**
 * How the organisation dashboard lays its panels out — kept apart from the
 * page so the arithmetic can be tested without rendering ECharts.
 */

/** Declared panels the front page does not show (the user removed them). */
export const HIDDEN_ON_DASHBOARD = new Set<string>(["fulfilment_funnel", "budget_vs_progress"]);

/**
 * The column count for `count` tiles in `width` pixels: as many as fit at
 * `min` each, capped at `max`, then stepped down until the count divides
 * evenly (or leaves at most one short), so no row ends in a lone tile.
 */
export function balancedColumns(width: number, count: number, min: number, max = 6): number {
  const most = Math.max(1, Math.min(count, max, Math.floor(width / min)));
  for (let columns = most; columns > 1; columns -= 1) {
    const rest = count % columns;
    if (rest === 0 || rest >= columns - 1) return columns;
  }
  return 1;
}

/**
 * Spans for a run of cells in a grid of `columns`, so no row has a hole.
 *
 * `wide` cells take the whole row. The others take one column each, and the
 * last of every run between wide cells widens to close its row — a lone
 * chart becomes a full-width one rather than a half beside nothing.
 */
export function packSpans(wide: boolean[], columns: number): number[] {
  const spans = wide.map((isWide) => (isWide ? columns : 1));
  let runStart = 0;
  const closeRun = (end: number) => {
    const count = end - runStart;
    const rest = count % columns;
    if (count > 0 && rest !== 0) spans[end - 1] = columns - rest + 1;
  };
  wide.forEach((isWide, index) => {
    if (isWide) {
      closeRun(index);
      runStart = index + 1;
    }
  });
  closeRun(wide.length);
  return spans;
}
