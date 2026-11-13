import type { CSSProperties } from "react";

import { StrokeIcon, iconClass } from "./StrokeIcon";

/**
 * Icons the Time & decisions pages need and the shared set does not have,
 * drawn the same way as `NxIcon` — one path on a 24-unit grid, a round 1.9
 * stroke — so they sit beside it as one family.
 */
const TD_ICONS = {
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  play: "M8 5.5v13l10.5-6.5z",
  stop: "M7.5 7.5h9v9h-9z",
  pause: "M9 6v12M15 6v12",
  stamp: "M5 21h14M6 17h12v-2.5a2.5 2.5 0 0 0-2.5-2.5H14V8.5a2 2 0 1 0-4 0V12H8.5A2.5 2.5 0 0 0 6 14.5z",
  form: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h3",
  key: "M14.5 9.5a4 4 0 1 0-1.2 2.9L20 19v2h-2v-2h-2v-2h-1.7M7.5 7.5h.01",
  hourglass: "M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4",
  drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  x: "M6 6l12 12M18 6L6 18",
  up: "M12 19V5M6 11l6-6 6 6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  copy: "M9 9h10v12H9zM5 15V3h10",
} as const;

export type TdIconName = keyof typeof TD_ICONS;

export function TdIcon({
  name,
  size = 18,
  stroke = 1.9,
  className,
  style,
}: {
  name: TdIconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <StrokeIcon
      d={TD_ICONS[name]}
      size={size}
      stroke={stroke}
      // The transport controls are solid, the rest outlined.
      filled={name === "play" || name === "stop"}
      className={iconClass(className)}
      style={style}
    />
  );
}
