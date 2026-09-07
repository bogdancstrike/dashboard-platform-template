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

import { describe, expect, it } from "vitest";

import { INK, NEUTRAL, SEMANTIC_INK } from "@/theme/tokens";

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

/** The two grounds text lands on, per appearance — the page, and a card. */
const GROUNDS = {
  light: { page: NEUTRAL[100], card: "#ffffff" },
  dark: { page: INK[900], card: INK[800] },
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
