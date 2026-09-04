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
  NEUTRAL,
  RADIUS,
  SEMANTIC,
  SHADOW,
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
      colorPrimary: ACCENT[500],
      colorInfo: SEMANTIC.info,
      colorSuccess: SEMANTIC.success,
      colorWarning: SEMANTIC.warning,
      colorError: SEMANTIC.danger,

      colorBgLayout: dark ? NEUTRAL[950] : NEUTRAL[100],
      colorBgContainer: dark ? NEUTRAL[900] : "#ffffff",
      colorBgElevated: dark ? NEUTRAL[800] : "#ffffff",
      colorBorder: dark ? NEUTRAL[700] : NEUTRAL[200],
      colorBorderSecondary: dark ? NEUTRAL[800] : NEUTRAL[100],
      colorText: dark ? NEUTRAL[100] : NEUTRAL[900],
      colorTextSecondary: dark ? NEUTRAL[400] : NEUTRAL[600],
      colorTextTertiary: dark ? NEUTRAL[500] : NEUTRAL[500],

      fontFamily: FONT.family,
      fontFamilyCode: FONT.mono,
      fontSize: scale.fontSize,

      borderRadius: RADIUS.control,
      borderRadiusLG: RADIUS.card,
      borderRadiusSM: RADIUS.control,

      controlHeight: scale.controlHeight,

      boxShadow: SHADOW.md,
      boxShadowSecondary: SHADOW.lg,

      // AntD's defaults are tuned for consumer apps. This is an operational
      // tool: less air, more rows.
      lineHeight: 1.5,
      wireframe: false,
    },
    components: {
      Layout: {
        headerBg: dark ? NEUTRAL[900] : "#ffffff",
        headerHeight: 56,
        headerPadding: "0 16px",
        siderBg: dark ? NEUTRAL[900] : "#ffffff",
        bodyBg: dark ? NEUTRAL[950] : NEUTRAL[100],
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
        headerBg: dark ? NEUTRAL[800] : NEUTRAL[50],
        headerSplitColor: "transparent",
        rowHoverBg: dark ? NEUTRAL[800] : ACCENT[50],
        borderColor: dark ? NEUTRAL[800] : NEUTRAL[200],
      },
      Card: { paddingLG: scale.padding + 4 },
      Descriptions: { itemPaddingBottom: scale.padding },
      Tabs: { horizontalMargin: "0 0 12px 0" },
      Tooltip: { colorBgSpotlight: dark ? NEUTRAL[700] : NEUTRAL[800] },
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
    "--nu-accent": ACCENT[500],
    "--nu-accent-soft": dark ? ACCENT[900] : ACCENT[50],
    "--nu-bg": dark ? NEUTRAL[950] : NEUTRAL[100],
    "--nu-surface": dark ? NEUTRAL[900] : "#ffffff",
    "--nu-surface-raised": dark ? NEUTRAL[800] : "#ffffff",
    "--nu-border": dark ? NEUTRAL[700] : NEUTRAL[200],
    "--nu-border-subtle": dark ? NEUTRAL[800] : NEUTRAL[100],
    "--nu-text": dark ? NEUTRAL[100] : NEUTRAL[900],
    "--nu-text-secondary": dark ? NEUTRAL[400] : NEUTRAL[600],
    "--nu-text-tertiary": NEUTRAL[500],
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
    "--nu-shadow-sm": SHADOW.sm,
    "--nu-shadow-md": SHADOW.md,
    "--nu-shadow-lg": SHADOW.lg,
  };
}
