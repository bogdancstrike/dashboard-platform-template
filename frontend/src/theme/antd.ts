/**
 * The AntD theme, derived from `tokens.ts`.
 *
 * Nothing here invents a value. Every number and colour comes from the token
 * file, so re-theming the platform is one edit rather than a search for hex
 * codes across a hundred components.
 */

import { theme, type ThemeConfig } from "antd";

import {
  ACCENT,
  DENSITY,
  FONT,
  INK,
  NEUTRAL,
  RADIUS,
  SEMANTIC,
  SHADOW,
  SHADOW_DARK,
  type Density,
} from "./tokens";

export type Appearance = "light" | "dark" | "system";

export function resolveAppearance(appearance: Appearance): "light" | "dark" {
  if (appearance !== "system") return appearance;
  // Server-side rendering has no window, and jsdom has no matchMedia; the DOM
  // types account for neither.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function buildTheme(appearance: Appearance, density: Density): ThemeConfig {
  const mode = resolveAppearance(appearance);
  const scale = DENSITY[density];
  const dark = mode === "dark";

  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      // Lighter in dark mode: #5b5bd6 on charcoal is legible but heavy, and
      // an accent that has to be hunted for stops being an accent.
      colorPrimary: dark ? ACCENT[400] : ACCENT[500],
      // Links are the accent itself, not the tint AntD derives from it.
      // The derived value (#6666d4) measures 4.47:1 against the off-white a
      // drawer body paints — just under the 4.5:1 body-text threshold (§55),
      // which axe reports as a serious violation on the record preview. The
      // token itself is 5.05:1 there and 5.37:1 on white.
      colorLink: dark ? ACCENT[300] : ACCENT[500],
      colorLinkHover: dark ? ACCENT[200] : ACCENT[600],
      colorLinkActive: dark ? ACCENT[400] : ACCENT[700],
      colorInfo: SEMANTIC.info,
      colorSuccess: SEMANTIC.success,
      colorWarning: SEMANTIC.warning,
      colorError: SEMANTIC.danger,

      colorBgLayout: dark ? INK[900] : NEUTRAL[100],
      colorBgContainer: dark ? INK[800] : "#ffffff",
      colorBgElevated: dark ? INK[750] : "#ffffff",
      colorBorder: dark ? INK[600] : NEUTRAL[200],
      colorBorderSecondary: dark ? INK[650] : NEUTRAL[100],
      colorText: dark ? INK[100] : NEUTRAL[900],
      colorTextSecondary: dark ? INK[300] : NEUTRAL[600],
      colorTextTertiary: dark ? INK[400] : NEUTRAL[500],

      fontFamily: FONT.family,
      fontFamilyCode: FONT.mono,
      fontSize: scale.fontSize,

      borderRadius: RADIUS.control,
      borderRadiusLG: RADIUS.card,
      borderRadiusSM: RADIUS.control,

      controlHeight: scale.controlHeight,

      boxShadow: dark ? SHADOW_DARK.md : SHADOW.md,
      boxShadowSecondary: dark ? SHADOW_DARK.lg : SHADOW.lg,

      // AntD's defaults are tuned for consumer apps. This is an operational
      // tool: less air, more rows.
      lineHeight: 1.5,
      wireframe: false,
    },
    components: {
      Layout: {
        headerBg: dark ? INK[850] : "#ffffff",
        headerHeight: 56,
        headerPadding: "0 16px",
        siderBg: dark ? INK[850] : "#ffffff",
        bodyBg: dark ? INK[900] : NEUTRAL[100],
      },
      Menu: {
        itemHeight: scale.controlHeight + 4,
        itemMarginInline: 8,
        itemBorderRadius: RADIUS.control,
        subMenuItemBg: "transparent",
      },
      Table: {
        cellPaddingBlock: (scale.rowHeight - scale.fontSize * 1.5) / 2,
        cellPaddingInline: scale.padding,
        headerBg: dark ? INK[750] : NEUTRAL[50],
        headerSplitColor: "transparent",
        rowHoverBg: dark ? INK[700] : ACCENT[50],
        borderColor: dark ? INK[650] : NEUTRAL[200],
      },
      Card: { paddingLG: scale.padding + 4 },
      Descriptions: { itemPaddingBottom: scale.padding },
      Tabs: {
        horizontalMargin: "0 0 12px 0",
        // The selected tab is named explicitly rather than left to the dark
        // algorithm's derivation, which lands on #6c6cd3 — 3.75:1 against a
        // charcoal panel, under the 4.5:1 body-text threshold at 13px (§55).
        // Named, it is 6.5:1 in dark and 5.4:1 in light.
        itemSelectedColor: dark ? ACCENT[300] : ACCENT[500],
        itemHoverColor: dark ? ACCENT[200] : ACCENT[600],
        inkBarColor: dark ? ACCENT[300] : ACCENT[500],
      },
      Tooltip: { colorBgSpotlight: dark ? INK[700] : NEUTRAL[800] },
      Modal: { borderRadiusLG: RADIUS.modal },
      Drawer: { paddingLG: 16 },
    },
  };
}

/**
 * The tokens the stylesheet needs as CSS custom properties.
 *
 * Anything styled outside an AntD component — the shell, the command palette,
 * a chart container — reads these, so it cannot drift from the component theme.
 */
export function cssVariables(appearance: Appearance, density: Density): Record<string, string> {
  const mode = resolveAppearance(appearance);
  const scale = DENSITY[density];
  const dark = mode === "dark";

  return {
    "--nu-accent": dark ? ACCENT[400] : ACCENT[500],
    "--nu-accent-soft": dark ? "rgba(124, 124, 245, 0.16)" : ACCENT[50],
    "--nu-bg": dark ? INK[900] : NEUTRAL[100],
    "--nu-surface": dark ? INK[800] : "#ffffff",
    "--nu-surface-raised": dark ? INK[750] : "#ffffff",
    "--nu-border": dark ? INK[650] : NEUTRAL[200],
    "--nu-border-subtle": dark ? INK[700] : NEUTRAL[100],
    "--nu-text": dark ? INK[100] : NEUTRAL[900],
    "--nu-text-secondary": dark ? INK[300] : NEUTRAL[600],
    "--nu-text-tertiary": dark ? INK[400] : NEUTRAL[500],
    "--nu-success": SEMANTIC.success,
    "--nu-warning": SEMANTIC.warning,
    "--nu-danger": SEMANTIC.danger,
    "--nu-info": SEMANTIC.info,
    "--nu-row-height": `${scale.rowHeight}px`,
    "--nu-control-height": `${scale.controlHeight}px`,
    "--nu-font-size": `${scale.fontSize}px`,
    "--nu-padding": `${scale.padding}px`,
    "--nu-font": FONT.family,
    "--nu-font-mono": FONT.mono,
    // The radii AntD already applies to its own components, published so a
    // hand-built surface (the notification panel, a popover of our own) rounds
    // to the same corner rather than to whichever value somebody typed.
    "--nu-radius-control": `${RADIUS.control}px`,
    "--nu-radius-card": `${RADIUS.card}px`,
    "--nu-radius-modal": `${RADIUS.modal}px`,
    "--nu-shadow-sm": dark ? SHADOW_DARK.sm : SHADOW.sm,
    "--nu-shadow-md": dark ? SHADOW_DARK.md : SHADOW.md,
    "--nu-shadow-lg": dark ? SHADOW_DARK.lg : SHADOW.lg,
    // A hand-built surface needs the strong border too — the D3 graphs and the
    // notification rows draw with it.
    "--nu-border-strong": dark ? INK[600] : NEUTRAL[300],
    "--nu-hover": dark ? INK[700] : NEUTRAL[100],
  };
}
