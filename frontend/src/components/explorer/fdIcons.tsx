import type { CSSProperties } from "react";

/**
 * The Find area's extra stroke icons, drawn on the same 24-unit grid and
 * round stroke as `NxIcon` so they sit beside the shell's icons unnoticed.
 *
 * Separate from `NxIcon` on purpose: that file belongs to the shell, and these
 * are the field-type glyphs and row controls only the condition builder and
 * the find pages use.
 */
export const FD_ICONS = {
  enum: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  date: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  number: "M5 9h14M5 15h14M10 4L8 20M16 4l-2 16",
  text: "M5 7V5h14v2M12 5v14M9 19h6",
  bool: "M3 12a5 5 0 0 1 5-5h8a5 5 0 0 1 0 10H8a5 5 0 0 1-5-5zM16 12h.01",
  rel: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  tag: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
  drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  play: "M7 4l13 8-13 8z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  close: "M6 6l12 12M18 6L6 18",
  warn: "M12 3l10 18H2zM12 10v5M12 18h.01",
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  sort: "M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4",
  columns: "M4 4h16v16H4zM10 4v16M16 4v16",
  rows: "M4 6h16M4 12h16M4 18h16",
  compact: "M4 5h16M4 9.5h16M4 14h16M4 18.5h16",
  table: "M4 4h16v16H4zM4 10h16M10 10v10",
  cards: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  key: "M15 7a4 4 0 1 1-3.5 6L4 20v-3h3v-3h3l1.5-1.5A4 4 0 0 1 15 7zM16 8h.01",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  check: "M5 12l5 5 9-10",
  plus: "M12 5v14M5 12h14",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
} as const;

export type FdIconName = keyof typeof FD_ICONS;

export function FdIcon({
  name,
  size = 15,
  strokeWidth = 2,
  fill = false,
  className,
  style,
}: {
  name: FdIconName;
  size?: number;
  strokeWidth?: number;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={FD_ICONS[name]} />
    </svg>
  );
}
