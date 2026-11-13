import type { CSSProperties, ReactNode } from "react";

/**
 * The heading row of a glass panel: a title on the left, and whatever acts on
 * or counts the panel's content (a segmented filter, a "12 in total", an
 * Attach button) on the right, wrapping under it when the panel is narrow.
 *
 * One component rather than a `*-head` class per area, so every panel's
 * heading has the same size, weight and spacing.
 */
export function PanelHeader({
  title,
  extra,
  className,
  style,
}: {
  title: ReactNode;
  extra?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className ? `nu-panel-head ${className}` : "nu-panel-head"} style={style}>
      <h2>{title}</h2>
      {extra}
    </div>
  );
}
