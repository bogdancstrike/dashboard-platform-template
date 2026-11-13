import { StrokeIcon, iconClass } from "./StrokeIcon";

/**
 * Collaboration's own stroke icons, drawn to the same grid and stroke as
 * `NxIcon` (24 units, round 1.9) so they sit in the menu beside the design's.
 */

const PATHS = {
  chat: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  docs: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6M4 7v14h3",
  notes: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3M16 2v4M8 2v4",
} as const;

export type CoIconName = keyof typeof PATHS;

export function CoIcon({ name, size = 18 }: { name: CoIconName; size?: number }) {
  return <StrokeIcon d={PATHS[name]} size={size} className={iconClass()} />;
}
