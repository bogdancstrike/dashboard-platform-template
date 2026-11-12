import type { CSSProperties } from "react";

/**
 * The design's stroke icons (Claude Design "Nucleus app shell").
 *
 * One path per name, drawn on a 24-unit grid with a round 1.9 stroke, so the
 * navigation, the header and the tab bar read as one family rather than as a
 * filled icon set beside an outlined one.
 */
export const NX_ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  gauge: "M4 16a8 8 0 1 1 16 0M12 16l4-5M3 20h18",
  layout: "M4 4h16v16H4zM4 10h16M10 10v10",
  activity: "M2 12h4l3-7 4 14 3-7h6",
  bell: "M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  megaphone: "M3 10v4h4l7 5V5l-7 5zM18 9a4 4 0 0 1 0 6",
  bars: "M6 20V10M12 20V4M18 20v-7",
  area: "M3 18l5-7 4 4 5-8 4 5M3 21h18",
  report: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  globe: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  check: "M4 4h16v16H4zM8 12l3 3 5-6",
  kanban: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z",
  flow: "M4 5h7v5H4zM13 14h7v5h-7zM7.5 10v4a2 2 0 0 0 2 2H13",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  folder: "M3 6h6l2 2h10v11H3z",
  briefcase: "M3 8h18v12H3zM8 8V5h8v3M3 13h18",
  store: "M4 9l1-5h14l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6",
  cart: "M3 4h3l2 11h11l2-8H7M9 20h.01M18 20h.01",
  ticket: "M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM14 6v12",
  device: "M5 4h14v11H5zM9 19h6M12 15v4",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-3.5-3.5",
  graph: "M4 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 6.3l8 1.4M7 7.6l4 8.6M17 9.6l-4 6.6",
  database: "M4 6c0-2.7 16-2.7 16 0v12c0 2.7-16 2.7-16 0zM4 6c0 2.7 16 2.7 16 0M4 12c0 2.7 16 2.7 16 0",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4",
  user: "M12 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21c.8-4 4-6 8-6s7.2 2 8 6",
  team: "M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c2 .6 3.3 2.4 3.6 5.5",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  org: "M9 3h6v5H9zM12 8v4M5 12h14M5 12v3M19 12v3M2 15h6v5H2zM16 15h6v5h-6z",
  audit: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h3",
  logs: "M4 5h16M4 10h16M4 15h10M4 20h7",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  monitor: "M3 4h18v12H3zM8 20h8M7 11h2l2-3 2 5 2-2h2",
  code: "M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9",
  gear: "M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
  quality: "M4 12l5 5L20 6",
  tag: "M3 3h8l10 10-8 8L3 11zM7.5 7.5h.01",
  import: "M12 3v12M7 10l5 5 5-5M4 21h16",
  export: "M12 15V3M7 8l5-5 5 5M4 21h16",
  plus: "M12 5v14M5 12h14",
  filter: "M3 5h18l-7 8v6l-4-2v-4z",
  more: "M4 7h16M4 12h16M4 17h16",
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5",
  moon: "M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  close: "M6 6l12 12M18 6L6 18",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  help: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01",
  sidebar: "M4 4h16v16H4zM9 4v16",
  switchUser: "M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM2 21c.8-4 3.5-6 7-6M16 14l3 3-3 3M22 17h-6",
} as const;

export type NxIconName = keyof typeof NX_ICONS;

export function NxIcon({
  name,
  size = 18,
  stroke = 1.9,
  className,
  style,
}: {
  name: NxIconName;
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
      <path d={NX_ICONS[name]} />
    </svg>
  );
}

/** The mark: two orbits and a core, in the accent. */
export function NxLogo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-22 -22 44 44" aria-hidden="true" className="nx-logo">
      <ellipse rx="19" ry="8" fill="none" stroke="var(--nu-accent)" strokeWidth="2.4" opacity="0.55" transform="rotate(-28)" />
      <ellipse rx="19" ry="8" fill="none" stroke="var(--nu-accent)" strokeWidth="2.4" opacity="0.55" transform="rotate(28)" />
      <circle r="6.5" fill="var(--nu-accent)" />
    </svg>
  );
}
