/**
 * Every colour the product writes *text* in clears 4.5:1 (§55, §64).
 *
 * This exists because the same defect kept being found one page at a time.
 * axe in Playwright catches a low-contrast label only on a page some spec
 * happens to visit, in the appearance that spec happens to be in — the last
 * one was a `Descriptions` label at 3.76:1 in dark, found by a ticket-console
 * test three commits after the colour was chosen. The palette is a pure value,
 * so the property belongs here: it holds for every page at once, including the
 * ones nobody has written yet, and it fails in milliseconds rather than after
 * a browser has booted.
 *
 * The grounds are the two a panel is actually painted on: the page background
 * and a card. A colour is checked against *both*, because a token is used on
 * either and the reader cannot be asked which one they are looking at.
 *
 * Fills are not text and are not checked here — `StatusTag` puts its colour on
 * a border and a tint, and the 3:1 threshold that governs those is asserted
 * where those components are.
 */

import { theme } from "antd";
import { PresetColors } from "antd/es/theme/interface";
import { describe, expect, it } from "vitest";

import { ACCENT, AVATAR_GROUND, INK, NEUTRAL, SEMANTIC, SEMANTIC_INK } from "@/theme/tokens";

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const part = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/**
 * The grounds text lands on, per appearance — the page, a card, and a *tint*.
 *
 * The third one is the one that got away twice. A highlighted row — unread,
 * selected, today — is painted with `--nu-accent-soft`, which in dark is the
 * accent at 16% over the card: `#25273f`. An ink asserted on the page and on a
 * card can still fail there, and two did: the tertiary ink at 3.92:1 and the
 * accent at 4.21:1, on an unread notification's meta line. Found by auditing
 * every route rather than by looking at the palette, which is why the ground
 * is named here now.
 *
 * `INK_ON_TINT` below says which inks are allowed on it: the tint classes in
 * `index.css` re-point `--nu-text-tertiary` to the secondary ink for
 * everything inside them, so the quiet end of the ramp is never drawn there.
 */
const GROUNDS = {
  light: { page: NEUTRAL[100], card: "#ffffff", tint: "#eeeefc" },
  dark: { page: INK[900], card: INK[800], tint: "#25273f" },
} as const;

/**
 * The text inks, by the AntD token each one fills.
 *
 * Named by token rather than by shade so a failure says which *role* is
 * illegible — "colorTextTertiary" sends somebody to the right line of
 * `theme/antd.ts`, where "INK 400" sends them to a palette and no further.
 */
const TEXT_INKS = {
  light: {
    colorText: NEUTRAL[900],
    colorTextSecondary: NEUTRAL[600],
    colorTextTertiary: NEUTRAL[500],
    colorTextDescription: NEUTRAL[600],
  },
  dark: {
    colorText: INK[100],
    colorTextSecondary: INK[300],
    colorTextTertiary: INK[400],
    colorTextDescription: INK[300],
  },
} as const;

describe.each(["light", "dark"] as const)("text is legible in %s", (mode) => {
  const grounds = GROUNDS[mode];

  it.each(Object.entries(TEXT_INKS[mode]))("%s clears 4.5:1 on both grounds", (_token, ink) => {
    expect(contrast(ink, grounds.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, grounds.card)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.entries(SEMANTIC_INK[mode]))(
    "the %s ink clears 4.5:1 on both grounds",
    (_meaning, ink) => {
      expect(contrast(ink, grounds.page)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink, grounds.card)).toBeGreaterThanOrEqual(4.5);
    },
  );

  /**
   * The third ground, and the one that got away: a preset tag's own tint.
   *
   * `<Tag color="success">` is drawn on `colorSuccessBg`, which AntD *derives
   * from our seed* rather than taking from its stock palette — so the tint is
   * not knowable from this file, and the ink chosen against white and a card
   * can still fail on it. It did: `#15803d` scored 3.76:1 on the `#d3e3d6`
   * that `#16a34a` derives, and a Playwright axe run on `/admin/flags` found
   * it, which is exactly the one-page-at-a-time discovery this file exists to
   * end.
   *
   * Derived here through the same algorithm the theme uses, so a change to
   * `SEMANTIC` that darkens a tint fails this rather than a browser.
   */
  type Meaning = keyof (typeof SEMANTIC_INK)["light"];

  it.each(Object.keys(SEMANTIC_INK[mode]) as Meaning[])(
    "the %s ink clears 4.5:1 on the tag tint its own seed derives",
    (meaning) => {
      const algorithm = mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm;
      const derived = algorithm({
        ...theme.defaultSeed,
        colorSuccess: SEMANTIC.success,
        colorWarning: SEMANTIC.warning,
        colorError: SEMANTIC.danger,
        colorInfo: SEMANTIC.info,
      });
      const tint: Record<Meaning, string> = {
        success: derived.colorSuccessBg,
        warning: derived.colorWarningBg,
        danger: derived.colorErrorBg,
        info: derived.colorInfoBg,
      };

      expect(contrast(SEMANTIC_INK[mode][meaning], tint[meaning])).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  /**
   * AntD's *stock hue* presets — `<Tag color="green">`, `color="blue"`.
   *
   * A layer below the four above and broken for exactly as long: AntD takes a
   * preset tag's ink from its own palette (`green7` on `green1`), which our
   * seed does not touch, so fixing `success` left `green` at 3.37:1. Four
   * routes were carrying it — and the tags that fail are labels like "Live"
   * and "Public", which is to say the ones a reader looks for.
   *
   * `index.css` maps each hue onto one of the four measured inks by family,
   * and the two families we have no ink for take the ordinary text colour.
   * This is that map, asserted against the ground AntD actually derives.
   */
  const PRESET_INK: Record<string, string> = {
    green: SEMANTIC_INK[mode].success,
    lime: SEMANTIC_INK[mode].success,
    orange: SEMANTIC_INK[mode].warning,
    gold: SEMANTIC_INK[mode].warning,
    yellow: SEMANTIC_INK[mode].warning,
    red: SEMANTIC_INK[mode].danger,
    volcano: SEMANTIC_INK[mode].danger,
    blue: SEMANTIC_INK[mode].info,
    cyan: SEMANTIC_INK[mode].info,
    geekblue: SEMANTIC_INK[mode].info,
    purple: TEXT_INKS[mode].colorText,
    magenta: TEXT_INKS[mode].colorText,
    pink: TEXT_INKS[mode].colorText,
  };

  it.each(Object.keys(PRESET_INK))(
    "the ink on a %s preset tag clears 4.5:1 on the ground AntD gives it",
    (hue) => {
      const algorithm = mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm;
      const derived = algorithm(theme.defaultSeed) as unknown as Record<string, string>;
      // `${hue}1` is the fill and `${hue}3` the border, per AntD's own
      // `genPresetColor` — so the fill is the ground the label sits on.
      const ground = derived[`${hue}1`]!;
      expect(contrast(PRESET_INK[hue]!, ground)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("every preset AntD ships is covered by that map", () => {
    // A hue with no rule in `index.css` keeps AntD's own ink, which is the
    // defect. `default`/`grey` are the neutral ground the text inks above
    // already cover.
    expect(Object.keys(PRESET_INK).sort()).toEqual([...PresetColors].sort());
  });

  it("carries white text on a solid danger button", () => {
    /**
     * The fill of `<Button danger type="primary">`, which AntD writes white on.
     *
     * This token was the dark *ink* red for a while, to fix the outlined
     * danger button's label — one token doing two jobs, and the solid variant
     * then had white on `#f87171` at 2.76:1. Every solid Delete in the dark
     * appearance, including the OK button of every delete confirmation in the
     * product, was illegible; axe found it on the first dialog a spec opened
     * in dark. The fill stays fill-strength and the outlined button's ink is
     * named in `index.css` instead.
     *
     * Mode-independent on purpose: a fill that carries white text carries it
     * in both appearances, and this is the assertion that stops somebody
     * "fixing" the ink by changing the fill again.
     */
    expect(contrast("#ffffff", SEMANTIC.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it("carries the inks a tinted row is allowed to use", () => {
    /**
     * A highlighted row's own ground, and what may be written on it.
     *
     * The tertiary ink is deliberately absent: it measures 3.92:1 here, and
     * the tint classes re-point it to the secondary one — `test/a11y.test.ts`
     * is what fails when a new tinted surface forgets to. The accent *ink*
     * rather than the accent: the fill is 4.21:1 on this ground, which is
     * where every link inside a highlighted row lives.
     */
    const allowed = {
      colorText: TEXT_INKS[mode].colorText,
      colorTextSecondary: TEXT_INKS[mode].colorTextSecondary,
      accentInk: mode === "dark" ? ACCENT[300] : ACCENT[700],
    };
    for (const [role, ink] of Object.entries(allowed)) {
      expect(contrast(ink, grounds.tint), `${role} on a tinted row`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    // And in dark the fill it replaces is *not* good enough there, which is
    // the whole reason the ink exists. In light the tint is a pale wash rather
    // than a translucent overlay and the fill clears it at 4.67:1 — the ink is
    // used in both anyway, because one rule for accent text beats a rule that
    // holds in one appearance.
    if (mode === "dark") {
      expect(contrast(ACCENT[400], grounds.tint)).toBeLessThan(4.5);
    }
  });

  it("keeps a placeholder legible", () => {
    /**
     * The ink of every "nothing chosen yet" in the product.
     *
     * AntD's default is `#bfbfbf` — **1.83:1** on white, the worst score
     * anywhere in this application, and invisible to a per-page audit because
     * no page's test is about a placeholder. The sweep over every route found
     * it on the first two pages with a `Select` on them.
     *
     * A control is painted on `colorBgContainer`, which is white in light and
     * `INK[800]` in dark — the card ground below.
     */
    const placeholder = mode === "dark" ? INK[400] : NEUTRAL[500];
    expect(contrast(placeholder, grounds.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(placeholder, grounds.page)).toBeGreaterThanOrEqual(4.5);
  });

  it("carries white initials on an avatar", () => {
    // AntD's default ground is #bfbfbf — 1.84:1 with white, which is to say
    // an avatar nobody can read. One value for both appearances, because an
    // identity marker should not change colour with the theme.
    expect(contrast("#ffffff", AVATAR_GROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the ramp a ramp: quieter text is quieter, not merely different", () => {
    // The point of three text colours is a hierarchy. Two that measure the
    // same are two names for one colour, and somebody will "fix" a contrast
    // failure by flattening it — this is what says they did.
    const inks = TEXT_INKS[mode];
    const primary = contrast(inks.colorText, grounds.card);
    const secondary = contrast(inks.colorTextSecondary, grounds.card);
    const tertiary = contrast(inks.colorTextTertiary, grounds.card);

    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(tertiary);
  });
});
