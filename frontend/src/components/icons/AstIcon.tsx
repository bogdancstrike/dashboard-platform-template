import type { CSSProperties } from "react";

import { StrokeIcon, iconClass } from "./StrokeIcon";

/**
 * The assistant's stroke icons, on the same 24-unit grid and round stroke as
 * `NxIcon`.
 */
const AST_ICONS = {
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 3v4M17 5h4M5 17v4M3 19h4",
  send: "M4 12l16-8-6 16-2.5-6.5zM11.5 13.5L20 4",
  stop: "M7 7h10v10H7z",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  retry: "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5",
  chat: "M4 5h16v11H9l-5 4z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  plus: "M12 5v14M5 12h14",
  tool: "M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  check: "M5 12l5 5L20 7",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
} as const;

export type AstIconName = keyof typeof AST_ICONS;

export function AstIcon({ name, size = 16, className, style }: { name: AstIconName; size?: number; className?: string; style?: CSSProperties }) {
  return <StrokeIcon d={AST_ICONS[name]} size={size} className={iconClass(className)} style={style} />;
}
