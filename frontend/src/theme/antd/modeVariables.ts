import { ACCENT, INK, NEUTRAL, PAPER, SHADOW, SHADOW_DARK } from "../tokens";

import { DARK_ACCENT, DARK_ON_ACCENT } from "./appearance";

/**
 * The custom properties that differ between the two modes, as two tables
 * rather than a condition per line — a value is looked up, not decided.
 */
export const MODE_VARIABLES: Record<"light" | "dark", Record<string, string>> = {
  light: {
      "--nu-accent": ACCENT[500],
      "--nu-on-accent": PAPER,
      "--nu-glow-rgb": "36, 87, 214",
      "--nu-ink-rgb": "27, 30, 38",
      "--nu-glass-rgb": "255, 255, 255",
      "--nu-raised": PAPER,
      "--nu-on-ink": PAPER,
      "--nu-tint": ACCENT[100],
      "--nu-ring": PAPER,
      "--nu-field": "rgba(255, 255, 255, 0.85)",
      "--nu-ok": "#1f6b40",
      "--nu-ok-bg": "rgba(46, 125, 79, 0.12)",
      "--nu-ok-fill": "#3e9b66",
      "--nu-warn": "#8a5208",
      "--nu-warn-bg": "rgba(196, 128, 20, 0.14)",
      "--nu-warn-fill": "#d99a2b",
      "--nu-bad": "#b42318",
      "--nu-bad-bg": "rgba(180, 35, 24, 0.1)",
      "--nu-bad-fill": "#d9483b",
      "--nu-glass": "rgba(255, 255, 255, 0.55)",
      "--nu-glass-strong": "rgba(255, 255, 255, 0.78)",
      "--nu-glass-border": "rgba(255, 255, 255, 0.85)",
      "--nu-glass-shadow": "0 14px 36px rgba(40, 35, 60, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
      "--nu-lift": "0 2px 12px rgba(40, 35, 60, 0.10)",
      "--nu-page-bg": "radial-gradient(ellipse 55% 45% at 88% 0%, #d9e4fa 0%, rgba(217, 228, 250, 0) 70%), radial-gradient(ellipse 45% 50% at 6% 100%, #e7e5f6 0%, rgba(231, 229, 246, 0) 70%), #f6f7f9",
      // The readable half of the accent, for *text* — the same split `SEMANTIC`
      // and `SEMANTIC_INK` have, and for the same reason. The accent as a fill
      // is `#7c7cf5` in dark, which is 5.17:1 on a card and **4.21:1 on the
      // accent-soft tint** an unread row is painted with. A link inside a
      // highlighted row is precisely where accent text appears, so the one
      // ground it has to survive is the one it failed on (§55).
      "--nu-accent-ink": ACCENT[600],
      "--nu-accent-soft": "rgba(36, 87, 214, 0.08)",
      "--nu-bg": NEUTRAL[100],
      "--nu-surface": "rgba(255, 255, 255, 0.72)",
      "--nu-surface-raised": PAPER,
      "--nu-border": "rgba(27, 30, 38, 0.1)",
      "--nu-border-subtle": "rgba(27, 30, 38, 0.06)",
      "--nu-text": NEUTRAL[900],
      "--nu-text-secondary": NEUTRAL[600],
      "--nu-text-tertiary": NEUTRAL[500],
      "--nu-shadow-sm": SHADOW.sm,
      "--nu-shadow-md": SHADOW.md,
      "--nu-shadow-lg": SHADOW.lg,
      // A hand-built surface needs the strong border too — the D3 graphs and the
      // notification rows draw with it.
      "--nu-border-strong": NEUTRAL[300],
      "--nu-hover": "rgba(27, 30, 38, 0.05)",
  },
  dark: {
      "--nu-accent": DARK_ACCENT,
      "--nu-on-accent": DARK_ON_ACCENT,
      "--nu-glow-rgb": "196, 181, 253",
      "--nu-ink-rgb": "243, 231, 210",
      "--nu-glass-rgb": "34, 26, 38",
      "--nu-raised": "rgba(255, 255, 255, 0.12)",
      "--nu-on-ink": "#211019",
      "--nu-tint": "#352b52",
      "--nu-ring": "#221a26",
      "--nu-field": "rgba(34, 26, 38, 0.8)",
      "--nu-ok": "#abd7bc",
      "--nu-ok-bg": "rgba(171, 215, 188, 0.15)",
      "--nu-ok-fill": "#7cc59a",
      "--nu-warn": "#f0c698",
      "--nu-warn-bg": "rgba(240, 198, 152, 0.14)",
      "--nu-warn-fill": "#e3ae6a",
      "--nu-bad": "#f5a5a0",
      "--nu-bad-bg": "rgba(245, 165, 160, 0.14)",
      "--nu-bad-fill": "#e9776f",
      "--nu-glass": "linear-gradient(140deg, rgba(255, 255, 255, 0.138) 0%, rgba(255, 255, 255, 0.042) 100%), rgba(20, 14, 26, 0.475)",
      "--nu-glass-strong": "linear-gradient(140deg, rgba(255, 255, 255, 0.17) 0%, rgba(255, 255, 255, 0.05) 100%), rgba(20, 14, 26, 0.6)",
      "--nu-glass-border": "rgba(255, 255, 255, 0.16)",
      "--nu-glass-shadow": "0 18px 44px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.22)",
      "--nu-lift": "0 2px 12px rgba(0, 0, 0, 0.4)",
      "--nu-page-bg": "radial-gradient(ellipse 55% 45% at 88% 0%, rgba(196, 181, 253, 0.32) 0%, rgba(196, 181, 253, 0) 70%), radial-gradient(ellipse 45% 50% at 6% 100%, rgba(36, 87, 214, 0.30) 0%, rgba(36, 87, 214, 0) 70%), #120e14",
      "--nu-accent-ink": DARK_ACCENT,
      "--nu-accent-soft": "rgba(196, 181, 253, 0.14)",
      "--nu-bg": INK[900],
      "--nu-surface": "rgba(30, 24, 34, 0.72)",
      "--nu-surface-raised": INK[750],
      "--nu-border": "rgba(243, 231, 210, 0.14)",
      "--nu-border-subtle": "rgba(243, 231, 210, 0.08)",
      "--nu-text": INK[100],
      "--nu-text-secondary": INK[300],
      "--nu-text-tertiary": INK[400],
      "--nu-shadow-sm": SHADOW_DARK.sm,
      "--nu-shadow-md": SHADOW_DARK.md,
      "--nu-shadow-lg": SHADOW_DARK.lg,
      "--nu-border-strong": INK[600],
      "--nu-hover": "rgba(243, 231, 210, 0.07)",
  },
};
