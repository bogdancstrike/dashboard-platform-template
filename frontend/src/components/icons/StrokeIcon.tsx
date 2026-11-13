import type { CSSProperties } from "react";

export interface StrokeIconProps {
  /** One SVG path on the 24-unit grid. */
  d: string;
  size?: number;
  /** Stroke width; the design's default is a round 1.9. */
  stroke?: number;
  /** Fill the path with the text colour instead of only stroking it. */
  filled?: boolean;
  /** Drop the outline when filled (the explorer's solid glyphs). */
  strokeless?: boolean;
  /** The complete class attribute. */
  className?: string;
  style?: CSSProperties;
  /** `focusable="false"` keeps old Edge from tabbing into the glyph. */
  unfocusable?: boolean;
}

/**
 * The one SVG every icon family in the product draws: a single path on a
 * 24-unit grid, round caps and joins, in the current text colour, hidden from
 * assistive technology because the control around it carries the name.
 *
 * `NxIcon` (the design's set) and the area sets in this folder are thin
 * lookups over it, so they cannot drift apart in stroke or alignment.
 */
export function StrokeIcon({
  d,
  size = 18,
  stroke = 1.9,
  filled = false,
  strokeless = false,
  className,
  style,
  unfocusable = true,
}: StrokeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={strokeless ? "none" : "currentColor"}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={unfocusable ? "false" : undefined}
      className={className}
      style={style}
    >
      <path d={d} />
    </svg>
  );
}

/** `nx-icon`, plus whatever the caller adds. */
export function iconClass(className?: string): string {
  return className ? `nx-icon ${className}` : "nx-icon";
}
