import type { CSSProperties } from "react";

import { StrokeIcon, iconClass } from "./StrokeIcon";

/**
 * The planning area's stroke icons, on `NxIcon`'s 24-unit grid and round
 * stroke so they sit in the navigation beside the shell's own.
 */
const PLAN_ICONS = {
  timeline: "M4 5h9M8 12h11M6 19h7M3 3v18",
  sprint: "M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4",
  template: "M5 4h14v6H5zM5 14h6v6H5zM15 14h4M15 17h4M15 20h4",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
} as const;

export type PlanIconName = keyof typeof PLAN_ICONS;

export function PlanIcon({ name, size = 18, style }: { name: PlanIconName; size?: number; style?: CSSProperties }) {
  return <StrokeIcon d={PLAN_ICONS[name]} size={size} className={iconClass()} style={style} />;
}
