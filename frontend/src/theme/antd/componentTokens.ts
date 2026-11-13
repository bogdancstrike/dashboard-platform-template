import type { ThemeConfig } from "antd";

import { ACCENT, AVATAR_GROUND, DENSITY, INK, NEUTRAL, PAPER, RADIUS, SEMANTIC, type Density } from "../tokens";
import { DARK_ACCENT, DARK_ON_ACCENT } from "./appearance";

type Components = NonNullable<ThemeConfig["components"]>;

/** Layout, navigation, tables and buttons — the components with structural tokens. */
function structural(dark: boolean, scale: (typeof DENSITY)[Density]): Components {
  return {
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
  };
}

/** Everything else: the pill radii, the glass grounds and the small adjustments. */
function surfaces(dark: boolean, scale: (typeof DENSITY)[Density]): Components {
  return {
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
  };
}

/** Per-component tokens, built per family so no one function holds every condition. */
export function componentTokens(dark: boolean, scale: (typeof DENSITY)[Density]): Components {
  return { ...structural(dark, scale), ...surfaces(dark, scale) };
}
