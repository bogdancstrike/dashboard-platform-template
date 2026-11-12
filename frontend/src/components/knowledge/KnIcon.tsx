import type { CSSProperties } from "react";

/**
 * Stroke icons for Ask your documents and Insights, drawn on NxIcon's grid with
 * its stroke so they sit in the navigation as one family. A separate file
 * because NxIcon.tsx is the shell's (the brief: add icons beside it, not in it).
 */
export const KN_ICONS = {
  /** Ask your documents: an open book with a spark. */
  documents: "M3 5.5C5.5 4.5 8.5 4.5 12 6.5v13c-3.5-2-6.5-2-9-1zM21 5.5c-2.5-1-5.5-1-9 1v13c3.5-2 6.5-2 9-1zM18 2v3M16.5 3.5h3",
  /** Insights: a chart that grew from a spark. */
  insights: "M4 20h16M7 16v-4M12 16V9M17 16v-6M17 3l.9 1.8 1.8.9-1.8.9L17 8.4l-.9-1.8-1.8-.9 1.8-.9z",
  /** A spark, for anything the model made. */
  spark: "M12 3l1.8 4.6L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.9zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
  /** Send a question. */
  send: "M4 12l16-8-6 16-2.5-6.5zM11.5 13.5L20 4",
  /** A pin, for an insight kept at the top. */
  pin: "M9 4h6l-1 6 3 3H7l3-3zM12 13v8",
  /** Refresh the data. */
  refresh: "M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4",
} as const;

export type KnIconName = keyof typeof KN_ICONS;

export function KnIcon({
  name,
  size = 18,
  stroke = 1.9,
  className,
  style,
}: {
  name: KnIconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `nx-icon ${className}` : "nx-icon"}
      style={style}
    >
      <path d={KN_ICONS[name]} />
    </svg>
  );
}
