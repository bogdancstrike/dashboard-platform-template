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
  AVATAR_GROUND,
  DENSITY,
  DENSITY_ZOOM,
  FONT,
  INK,
  NEUTRAL,
  PAPER,
  RADIUS,
  SEMANTIC,
  SEMANTIC_INK,
  SHADOW,
  SHADOW_DARK,
  type Density,
} from "./tokens";

export type Appearance = "light" | "dark" | "system";

/** The design's dark accent — lavender on plum — and the ink written on it. */
export const DARK_ACCENT = "#c4b5fd";
const DARK_ON_ACCENT = "#1b1230";

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
      colorPrimary: dark ? DARK_ACCENT : ACCENT[500],
      // Links are the accent itself, not the tint AntD derives from it.
      // The derived value (#6666d4) measures 4.47:1 against the off-white a
      // drawer body paints — just under the 4.5:1 body-text threshold (§55),
      // which axe reports as a serious violation on the record preview. The
      // token itself is 5.05:1 there and 5.37:1 on white.
      colorLink: dark ? DARK_ACCENT : ACCENT[600],
      colorLinkHover: dark ? "#ddd3fe" : ACCENT[700],
      colorLinkActive: dark ? "#a996f7" : ACCENT[800],
      colorInfo: SEMANTIC.info,
      colorSuccess: SEMANTIC.success,
      colorWarning: SEMANTIC.warning,
      colorError: SEMANTIC.danger,

      colorBgLayout: "transparent",
      colorBgContainer: dark ? INK[800] : PAPER,
      colorBgElevated: dark ? INK[750] : PAPER,
      colorBorder: dark ? "rgba(243, 231, 210, 0.16)" : "rgba(27, 30, 38, 0.14)",
      colorBorderSecondary: dark ? "rgba(243, 231, 210, 0.09)" : "rgba(27, 30, 38, 0.07)",
      colorText: dark ? INK[100] : NEUTRAL[900],
      colorTextSecondary: dark ? INK[300] : NEUTRAL[600],
      colorTextTertiary: dark ? INK[400] : NEUTRAL[500],
      // Named rather than left to AntD's derivation, which lands on
      // `NEUTRAL[500]` — 4.34:1 against the page background, just under the
      // bar. `Typography type="secondary"` is the most-used text style in the
      // product, so being a tenth of a point short of legible there is short
      // everywhere at once (§55).
      colorTextDescription: dark ? INK[300] : NEUTRAL[600],
      // The ink of every placeholder in the product — a Select with nothing
      // chosen, an empty search box, a date that has not been picked. AntD's
      // default is `#bfbfbf`, which is **1.83:1** on white: the lowest score
      // anywhere in this application, and it went unseen because no single
      // page's audit is about a placeholder. Found by auditing every route at
      // once. The tertiary ink is the quietest one measured (§55).
      colorTextPlaceholder: dark ? INK[400] : NEUTRAL[500],

      // Text on a *tinted* semantic ground — an `Alert type="error"`, a
      // `Typography.Text type="warning"`. AntD derives these from the fill,
      // which is tuned for a fill: amber on its own pale amber is 2.82:1, and
      // the labels that fail worst are the ones a reader most needs (§55).
      //
      // AntD's *preset-coloured tags* take their text from the base
      // `colorWarning` rather than from this, so they are named in the
      // stylesheet instead — see `.ant-tag-warning` in the global stylesheet (`styles/global`).
      colorSuccessText: SEMANTIC_INK[mode].success,
      colorWarningText: SEMANTIC_INK[mode].warning,
      colorErrorText: SEMANTIC_INK[mode].danger,
      colorInfoText: SEMANTIC_INK[mode].info,

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
      fontWeightStrong: 600,
      colorFillAlter: dark ? "rgba(243, 231, 210, 0.05)" : "rgba(27, 30, 38, 0.035)",
      colorFillTertiary: dark ? "rgba(243, 231, 210, 0.07)" : "rgba(27, 30, 38, 0.05)",
      colorFillSecondary: dark ? "rgba(243, 231, 210, 0.09)" : "rgba(27, 30, 38, 0.07)",
      controlItemBgActive: dark ? "#352b52" : ACCENT[100],
      controlItemBgHover: dark ? "rgba(243, 231, 210, 0.07)" : "rgba(27, 30, 38, 0.05)",
      controlOutline: dark ? "rgba(196, 181, 253, 0.25)" : "rgba(36, 87, 214, 0.18)",
    },
    components: {
      Layout: {
        headerBg: "transparent",
        headerHeight: 56,
        headerPadding: "0 8px 0 20px",
        siderBg: "transparent",
        bodyBg: "transparent",
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
        headerBg: "transparent",
        headerColor: dark ? INK[300] : NEUTRAL[500],
        headerSplitColor: "transparent",
        rowHoverBg: dark ? "rgba(255, 255, 255, 0.07)" : "rgba(255, 255, 255, 0.85)",
        rowSelectedBg: dark ? "rgba(196, 181, 253, 0.16)" : "rgba(36, 87, 214, 0.12)",
        rowSelectedHoverBg: dark ? "rgba(196, 181, 253, 0.22)" : "rgba(36, 87, 214, 0.16)",
        borderColor: "transparent",
        colorBgContainer: "transparent",
        headerBorderRadius: 0,
        // Derived from the container colour, which is transparent here — and a
        // transparent colour darkened is black. Named so a sorted column reads
        // as the faint tint the design gives it.
        bodySortBg: dark ? "rgba(255, 255, 255, 0.03)" : "rgba(27, 30, 38, 0.025)",
        headerSortActiveBg: "transparent",
        headerSortHoverBg: "transparent",
        fixedHeaderSortActiveBg: "transparent",
        headerFilterHoverBg: "transparent",
      },
      Button: {
        // Two colours the dark algorithm derives to just under legible, which
        // is worth naming because these are the two buttons on every record
        // page (§55).
        //
        // A solid primary is white on the derived indigo `#6c6cd3` — 4.45:1,
        // a hundredth under the bar. The accent one step darker carries the
        // same white at 5.37:1 and reads as the same button.
        colorPrimary: dark ? DARK_ACCENT : ACCENT[500],
        primaryColor: dark ? DARK_ON_ACCENT : PAPER,
        // Hover and press go *darker* in light (white text stays >= 4.5:1;
        // AntD's derived #4b7be3 was 4.0:1) and lighter in dark, where the
        // label is dark ink on lavender.
        colorPrimaryHover: dark ? "#d6ccfe" : ACCENT[600],
        colorPrimaryActive: dark ? "#b3a1fb" : ACCENT[700],
        primaryShadow: dark ? "0 10px 22px rgba(196, 181, 253, 0.28)" : "0 10px 22px rgba(36, 87, 214, 0.3)",
        defaultShadow: "none",
        dangerShadow: "none",
        fontWeight: 600,
        borderRadius: 999,
        borderRadiusLG: 999,
        borderRadiusSM: 999,
        paddingInline: 18,
        defaultBg: dark ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.7)",
        defaultBorderColor: dark ? "rgba(255, 255, 255, 0.16)" : "rgba(27, 30, 38, 0.1)",
        // The *fill* of a solid danger button, in both appearances.
        //
        // This was the dark ink (`#f87171`) to fix the outlined button's
        // label, which was the derived `#be2323` at 2.94:1 on a charcoal
        // panel — a Delete nobody can read. But one token was carrying two
        // roles: AntD also paints `type="primary" danger` with it and writes
        // **white** on top, and white on a light red is 2.76:1. So every
        // solid Delete in the dark appearance was illegible — including the
        // OK button of every delete confirmation in the product, which no
        // axe test had opened in dark until the bulk dialog.
        //
        // The fill stays fill-strength here (white on `#dc2626` is 4.83:1),
        // and the outlined button's *ink* is named in the stylesheet instead —
        // `.ant-btn-dangerous:not(.ant-btn-primary)` in the global stylesheet (`styles/global`), the same
        // way the preset tags are. Asserted in `contrast.test.ts`.
        colorError: SEMANTIC.danger,
      },
      // An initials avatar's default ground is `#bfbfbf`, which carries white
      // text at 1.84:1 — every avatar in the product without a photograph was
      // illegible, and axe only found it on the first page that shows a column
      // of them. Slate at 7.6:1 (§55, §64), asserted in `contrast.test.ts`.
      Avatar: { colorTextPlaceholder: AVATAR_GROUND },
      Card: {
        paddingLG: scale.padding + 6,
        colorBgContainer: "transparent",
        headerFontSize: 15,
        headerBg: "transparent",
      },
      Descriptions: { itemPaddingBottom: scale.padding },
      Tabs: {
        horizontalMargin: "0 0 12px 0",
        // The selected tab is named explicitly rather than left to the dark
        // algorithm's derivation, which lands on #6c6cd3 — 3.75:1 against a
        // charcoal panel, under the 4.5:1 body-text threshold at 13px (§55).
        // Named, it is 6.5:1 in dark and 5.4:1 in light.
        itemSelectedColor: dark ? INK[100] : NEUTRAL[900],
        itemColor: dark ? INK[200] : NEUTRAL[600],
        itemHoverColor: dark ? INK[100] : NEUTRAL[900],
        inkBarColor: dark ? DARK_ACCENT : ACCENT[500],
        titleFontSize: 14,
      },
      Tooltip: { colorBgSpotlight: dark ? INK[600] : NEUTRAL[900], borderRadius: 10 },
      Modal: {
        borderRadiusLG: RADIUS.modal,
        contentBg: dark ? "rgba(30, 24, 34, 0.92)" : "rgba(255, 255, 255, 0.86)",
        headerBg: "transparent",
        footerBg: "transparent",
        titleFontSize: 22,
      },
      Drawer: { paddingLG: 20, colorBgElevated: dark ? "rgba(30, 24, 34, 0.92)" : "rgba(255, 255, 255, 0.86)" },
      Input: { borderRadius: 999, borderRadiusLG: 999, borderRadiusSM: 999, paddingInline: 14, activeShadow: "none" },
      InputNumber: { borderRadius: 999, borderRadiusLG: 999, borderRadiusSM: 999, activeShadow: "none" },
      Select: { borderRadius: 999, borderRadiusLG: 999, borderRadiusSM: 999, optionSelectedBg: dark ? "#352b52" : ACCENT[100], optionSelectedFontWeight: 600 },
      // The field is a pill; the calendar that opens from it is a panel with soft
      // corners — AntD paints the popup with `borderRadiusLG` and its cells and
      // footer buttons with `borderRadiusSM`, so only the field's own radius is
      // the pill (set in the stylesheet on `.ant-picker`).
      DatePicker: { borderRadius: 999, borderRadiusLG: 16, borderRadiusSM: 8, borderRadiusXS: 6, activeShadow: "none" },
      Segmented: {
        borderRadius: 999,
        borderRadiusLG: 999,
        borderRadiusSM: 999,
        trackBg: dark ? "rgba(243, 231, 210, 0.07)" : "rgba(27, 30, 38, 0.06)",
        itemSelectedBg: dark ? INK[100] : NEUTRAL[900],
        itemSelectedColor: dark ? "#211019" : PAPER,
        itemColor: dark ? INK[200] : NEUTRAL[600],
        trackPadding: 3,
      },
      Tag: { borderRadiusSM: 999, defaultBg: dark ? "rgba(243, 231, 210, 0.08)" : "rgba(27, 30, 38, 0.06)" },
      Dropdown: { borderRadiusLG: 20, borderRadiusSM: 12, paddingBlock: 8, controlItemBgHover: dark ? "rgba(243, 231, 210, 0.07)" : "rgba(27, 30, 38, 0.05)" },
      Popover: { borderRadiusLG: 22 },
      Pagination: { borderRadius: 999, itemActiveBg: dark ? INK[100] : NEUTRAL[900] },
      Badge: { colorError: dark ? "#e9776f" : ACCENT[500], textFontWeight: 700 },
      Checkbox: { borderRadiusSM: 6 },
      Progress: { remainingColor: dark ? "rgba(243, 231, 210, 0.1)" : "rgba(27, 30, 38, 0.08)" },
      Alert: { borderRadiusLG: 20 },
      Collapse: { borderRadiusLG: 22, headerBg: "transparent" },
      Steps: { dotSize: 10 },
      Statistic: { contentFontSize: 32 },
      Message: { contentBg: dark ? "rgba(30, 24, 34, 0.94)" : "rgba(255, 255, 255, 0.94)", borderRadiusLG: 999 },
      Notification: { borderRadiusLG: 22 },
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
    "--nu-accent": dark ? DARK_ACCENT : ACCENT[500],
    "--nu-on-accent": dark ? DARK_ON_ACCENT : PAPER,
    "--nu-glow-rgb": dark ? "196, 181, 253" : "36, 87, 214",
    "--nu-ink-rgb": dark ? "243, 231, 210" : "27, 30, 38",
    "--nu-glass-rgb": dark ? "34, 26, 38" : "255, 255, 255",
    "--nu-raised": dark ? "rgba(255, 255, 255, 0.12)" : PAPER,
    "--nu-on-ink": dark ? "#211019" : PAPER,
    "--nu-tint": dark ? "#352b52" : ACCENT[100],
    "--nu-ring": dark ? "#221a26" : PAPER,
    "--nu-field": dark ? "rgba(34, 26, 38, 0.8)" : "rgba(255, 255, 255, 0.85)",
    "--nu-ok": dark ? "#abd7bc" : "#1f6b40",
    "--nu-ok-bg": dark ? "rgba(171, 215, 188, 0.15)" : "rgba(46, 125, 79, 0.12)",
    "--nu-ok-fill": dark ? "#7cc59a" : "#3e9b66",
    "--nu-warn": dark ? "#f0c698" : "#8a5208",
    "--nu-warn-bg": dark ? "rgba(240, 198, 152, 0.14)" : "rgba(196, 128, 20, 0.14)",
    "--nu-warn-fill": dark ? "#e3ae6a" : "#d99a2b",
    "--nu-bad": dark ? "#f5a5a0" : "#b42318",
    "--nu-bad-bg": dark ? "rgba(245, 165, 160, 0.14)" : "rgba(180, 35, 24, 0.1)",
    "--nu-bad-fill": dark ? "#e9776f" : "#d9483b",
    "--nu-glass": dark
      ? "linear-gradient(140deg, rgba(255, 255, 255, 0.138) 0%, rgba(255, 255, 255, 0.042) 100%), rgba(20, 14, 26, 0.475)"
      : "rgba(255, 255, 255, 0.55)",
    "--nu-glass-strong": dark
      ? "linear-gradient(140deg, rgba(255, 255, 255, 0.17) 0%, rgba(255, 255, 255, 0.05) 100%), rgba(20, 14, 26, 0.6)"
      : "rgba(255, 255, 255, 0.78)",
    "--nu-glass-border": dark ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.85)",
    "--nu-glass-shadow": dark
      ? "0 18px 44px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.22)"
      : "0 14px 36px rgba(40, 35, 60, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
    "--nu-lift": dark ? "0 2px 12px rgba(0, 0, 0, 0.4)" : "0 2px 12px rgba(40, 35, 60, 0.10)",
    "--nu-page-bg": dark
      ? "radial-gradient(ellipse 55% 45% at 88% 0%, rgba(196, 181, 253, 0.32) 0%, rgba(196, 181, 253, 0) 70%), radial-gradient(ellipse 45% 50% at 6% 100%, rgba(36, 87, 214, 0.30) 0%, rgba(36, 87, 214, 0) 70%), #120e14"
      : "radial-gradient(ellipse 55% 45% at 88% 0%, #d9e4fa 0%, rgba(217, 228, 250, 0) 70%), radial-gradient(ellipse 45% 50% at 6% 100%, #e7e5f6 0%, rgba(231, 229, 246, 0) 70%), #f6f7f9",
    // The readable half of the accent, for *text* — the same split `SEMANTIC`
    // and `SEMANTIC_INK` have, and for the same reason. The accent as a fill
    // is `#7c7cf5` in dark, which is 5.17:1 on a card and **4.21:1 on the
    // accent-soft tint** an unread row is painted with. A link inside a
    // highlighted row is precisely where accent text appears, so the one
    // ground it has to survive is the one it failed on (§55).
    "--nu-accent-ink": dark ? DARK_ACCENT : ACCENT[600],
    "--nu-accent-soft": dark ? "rgba(196, 181, 253, 0.14)" : "rgba(36, 87, 214, 0.08)",
    "--nu-bg": dark ? INK[900] : NEUTRAL[100],
    "--nu-surface": dark ? "rgba(30, 24, 34, 0.72)" : "rgba(255, 255, 255, 0.72)",
    "--nu-surface-raised": dark ? INK[750] : PAPER,
    "--nu-border": dark ? "rgba(243, 231, 210, 0.14)" : "rgba(27, 30, 38, 0.1)",
    "--nu-border-subtle": dark ? "rgba(243, 231, 210, 0.08)" : "rgba(27, 30, 38, 0.06)",
    "--nu-text": dark ? INK[100] : NEUTRAL[900],
    "--nu-text-secondary": dark ? INK[300] : NEUTRAL[600],
    "--nu-text-tertiary": dark ? INK[400] : NEUTRAL[500],
    "--nu-success": SEMANTIC.success,
    "--nu-warning": SEMANTIC.warning,
    "--nu-danger": SEMANTIC.danger,
    "--nu-info": SEMANTIC.info,
    // The readable half of the same four meanings, for text rather than fills
    // — see `SEMANTIC_INK`. Published as variables because the pages that need
    // them are styled in CSS, and a component resolving the theme in
    // JavaScript to pick a hex is a second place the mode can be got wrong.
    "--nu-success-ink": SEMANTIC_INK[mode].success,
    "--nu-warning-ink": SEMANTIC_INK[mode].warning,
    "--nu-danger-ink": SEMANTIC_INK[mode].danger,
    "--nu-info-ink": SEMANTIC_INK[mode].info,
    "--nu-zoom": String(DENSITY_ZOOM[density]),
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
    "--nu-hover": dark ? "rgba(243, 231, 210, 0.07)" : "rgba(27, 30, 38, 0.05)",
  };
}
