import type { ChartKind } from "@/api/dashboard";

/**
 * A small line drawing of each chart kind, in the design's stroke style.
 *
 * The gallery used to draw a real chart in each tile, which at tile size was a
 * smear of colour — and, for a kind the question could not feed, a sentence
 * squeezed into a thumbnail. A clean glyph and a name reads at a glance; the
 * big chart beside the gallery is where the reader's own data is drawn.
 */
const PATHS: Partial<Record<ChartKind, string>> = {
  bar: "M5 20V11M10 20V6M15 20V13M20 20V9M3 20h18",
  hbar: "M4 5h9M4 10h15M4 15h6M4 20h12M4 3v18",
  line: "M3 17l5-6 4 3 5-7 4 4M3 21h18",
  area: "M3 17l5-6 4 3 5-7 4 4v8H3zM3 21h18",
  "multi-line": "M3 16l5-5 4 3 5-6 4 3M3 19l5-2 4 1 5-4 4 2M3 21h18",
  "stacked-area": "M3 14l5-4 4 2 5-5 4 3v11H3zM3 18l5-2 4 1 5-3 4 1",
  "stacked-bar": "M5 20v-6M5 14v-3M11 20v-8M11 12V6M17 20v-5M17 15v-5M3 20h18",
  "stacked-hbar": "M4 5h6M10 5h5M4 11h9M13 11h6M4 17h4M8 17h7M4 3v17",
  pie: "M12 3a9 9 0 1 0 9 9h-9zM14 2.5A9 9 0 0 1 21.5 10H14z",
  treemap: "M3 4h11v9H3zM14 4h7v5h-7zM14 9h7v11h-7zM3 13h11v7H3z",
  funnel: "M3 4h18l-5 7v0H8zM8 11h8l-2 5h-4zM10 16h4l-1 4h-2z",
  radar: "M12 3l8 6-3 10H7L4 9zM12 8l4 3-1.5 5h-5L8 11z",
  heatmap: "M3 4h5v5H3zM10 4h5v5h-5zM17 4h4v5h-4zM3 11h5v5H3zM10 11h5v5h-5zM17 11h4v5h-4zM3 18h5v2H3zM10 18h5v2h-5z",
  scatter: "M6 16h.01M9 11h.01M13 14h.01M15 7h.01M18 10h.01M4 4v16h16",
  gauge: "M4 16a8 8 0 1 1 16 0M12 16l4-5M3 20h18",
};

export function ChartKindIcon({ kind, size = 22 }: { kind: ChartKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={kind === "scatter" ? 3.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[kind] ?? PATHS.bar} />
    </svg>
  );
}
