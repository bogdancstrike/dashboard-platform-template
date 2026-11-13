import type { ThemeConfig } from "antd";

import { ACCENT, DENSITY, FONT, INK, NEUTRAL, PAPER, RADIUS, SEMANTIC, SEMANTIC_INK, SHADOW, SHADOW_DARK, type Density } from "../tokens";
import { DARK_ACCENT } from "./appearance";

/** The global tokens: colours, type, radii, heights and shadows for one mode and density. */
export function globalTokens(mode: "light" | "dark", scale: (typeof DENSITY)[Density]): NonNullable<ThemeConfig["token"]> {
  const dark = mode === "dark";
  return {
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
  };
}
