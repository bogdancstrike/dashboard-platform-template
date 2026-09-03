/**
 * The design tokens. One source, three consumers.
 *
 * The AntD theme, the CSS custom properties and the ECharts theme are all
 * derived from this file. That is the whole point: a platform where the table
 * is themed by one system and the chart beside it by another is a platform
 * where the two drift, and the drift is always visible precisely where a
 * reader is comparing them.
 *
 * Rules this encodes:
 *
 * - **Colour means something.** Status, severity and health get colour;
 *   nothing else does. There is one accent, and it is the logo's core.
 * - **Density is a first-class axis.** Enterprise users compare rows. The
 *   compact scale is not an afterthought bolted on for mobile.
 * - **Status colours are fixed per vocabulary**, so one status is one colour on
 *   the board, in the table and in the chart.
 */

export const NEUTRAL = {
  50: "#f8fafc",
  100: "#f1f5f9",
  200: "#e2e8f0",
  300: "#cbd5e1",
  400: "#94a3b8",
  500: "#64748b",
  600: "#475569",
  700: "#334155",
  800: "#1e293b",
  900: "#0f172a",
  950: "#020617",
} as const;

export const ACCENT = {
  50: "#eeeefc",
  100: "#dcdcf9",
  200: "#bcbcf3",
  300: "#9a9aec",
  400: "#7c7cf5",
  500: "#5b5bd6",
  600: "#4a4ac0",
  700: "#4338ca",
  800: "#332f96",
  900: "#272470",
} as const;

export const SEMANTIC = {
  success: "#16a34a",
  warning: "#ca8a04",
  danger: "#dc2626",
  info: "#0891b2",
  neutral: NEUTRAL[500],
} as const;

/**
 * The categorical series palette for charts.
 *
 * Ordered so that adjacent series are distinguishable by hue *and* by
 * lightness — a chart read in greyscale, or by a reader with deuteranopia,
 * still separates the first four series, which is as many as most charts have.
 */
export const SERIES = [
  "#5b5bd6",
  "#0891b2",
  "#16a34a",
  "#ca8a04",
  "#db2777",
  "#7c3aed",
  "#0d9488",
  "#ea580c",
  "#64748b",
  "#4338ca",
] as const;

/**
 * Status → colour, per domain vocabulary.
 *
 * Keyed by the exact strings the API returns, so a component never has to map
 * a status to a colour itself and two components can never disagree.
 */
export const STATUS_COLORS: Record<string, string> = {
  // lifecycle
  ACTIVE: SEMANTIC.success,
  INACTIVE: NEUTRAL[400],
  SUSPENDED: SEMANTIC.warning,
  LOCKED: SEMANTIC.danger,
  INVITED: SEMANTIC.info,
  ARCHIVED: NEUTRAL[400],
  BLOCKED: SEMANTIC.danger,

  // work
  NEW: SEMANTIC.info,
  ASSIGNED: "#7c3aed",
  IN_PROGRESS: ACCENT[500],
  IN_REVIEW: "#0d9488",
  DONE: SEMANTIC.success,
  COMPLETED: SEMANTIC.success,
  CANCELLED: NEUTRAL[400],
  ON_HOLD: SEMANTIC.warning,
  PLANNING: NEUTRAL[500],

  // support
  OPEN: SEMANTIC.info,
  WAITING_CUSTOMER: SEMANTIC.warning,
  ESCALATED: SEMANTIC.danger,
  RESOLVED: SEMANTIC.success,
  CLOSED: NEUTRAL[400],

  // commerce
  PENDING: SEMANTIC.warning,
  CONFIRMED: SEMANTIC.info,
  PROCESSING: ACCENT[500],
  SHIPPED: "#0d9488",
  DELIVERED: SEMANTIC.success,
  REFUNDED: NEUTRAL[500],
  PAID: SEMANTIC.success,
  UNPAID: SEMANTIC.warning,
  PARTIAL: SEMANTIC.warning,
  OVERDUE: SEMANTIC.danger,

  // operations
  QUEUED: NEUTRAL[500],
  RUNNING: ACCENT[500],
  SUCCEEDED: SEMANTIC.success,
  FAILED: SEMANTIC.danger,
  RETRYING: SEMANTIC.warning,
  HEALTHY: SEMANTIC.success,
  DEGRADED: SEMANTIC.warning,
  UNAVAILABLE: SEMANTIC.danger,
  UNKNOWN: NEUTRAL[400],
  ONLINE: SEMANTIC.success,
  OFFLINE: NEUTRAL[400],
  MAINTENANCE: SEMANTIC.info,
  DECOMMISSIONED: NEUTRAL[400],

  // health / severity
  ON_TRACK: SEMANTIC.success,
  AT_RISK: SEMANTIC.warning,
  OFF_TRACK: SEMANTIC.danger,
  LOW: NEUTRAL[400],
  NORMAL: SEMANTIC.info,
  HIGH: SEMANTIC.warning,
  CRITICAL: SEMANTIC.danger,
  MINOR: NEUTRAL[400],
  MODERATE: SEMANTIC.info,
  MAJOR: SEMANTIC.warning,

  // log levels
  TRACE: NEUTRAL[400],
  DEBUG: NEUTRAL[400],
  INFO: SEMANTIC.info,
  WARNING: SEMANTIC.warning,
  WARN: SEMANTIC.warning,
  ERROR: SEMANTIC.danger,

  // audit results
  SUCCESS: SEMANTIC.success,
  FAILURE: SEMANTIC.danger,
  DENIED: SEMANTIC.warning,
};

export function statusColor(value: string | null | undefined): string {
  if (!value) return NEUTRAL[400];
  return STATUS_COLORS[value.toUpperCase()] ?? NEUTRAL[400];
}

export const RADIUS = { control: 4, card: 6, modal: 8, pill: 999 } as const;

/** 4px base unit. Anything not on this scale is a mistake, not a nuance. */
export const SPACE = [0, 4, 8, 12, 16, 24, 32, 48] as const;

export const FONT = {
  family:
    "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  sizes: { xs: 12, sm: 13, base: 14, md: 16, lg: 20, xl: 24, xxl: 30 },
} as const;

export type Density = "compact" | "middle" | "comfortable";

/**
 * The three density modes (§1, §40).
 *
 * `compact` fits about forty rows on a laptop screen, which is the point: an
 * operator scanning a queue wants the whole queue, not eight rows and a lot of
 * air.
 */
export const DENSITY: Record<
  Density,
  { rowHeight: number; controlHeight: number; fontSize: number; padding: number }
> = {
  compact: { rowHeight: 32, controlHeight: 28, fontSize: 13, padding: 8 },
  middle: { rowHeight: 40, controlHeight: 32, fontSize: 14, padding: 12 },
  comfortable: { rowHeight: 52, controlHeight: 40, fontSize: 14, padding: 16 },
};

export const LAYOUT = {
  headerHeight: 56,
  sidebarWidth: 240,
  sidebarCollapsedWidth: 64,
  contentMaxWidth: 1680,
  breakpoints: { mobile: 768, tablet: 1024, laptop: 1440 },
} as const;

/**
 * Fast enough to feel immediate, slow enough to be followed. Nothing that
 * happens on every keystroke gets a transition at all.
 */
export const MOTION = {
  fast: "120ms cubic-bezier(0.4, 0, 0.2, 1)",
  base: "180ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "240ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

export const SHADOW = {
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  md: "0 2px 8px rgba(15, 23, 42, 0.08)",
  lg: "0 8px 24px rgba(15, 23, 42, 0.12)",
  xl: "0 16px 48px rgba(15, 23, 42, 0.18)",
} as const;
