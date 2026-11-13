export type Appearance = "light" | "dark" | "system";

/** The design's dark accent — lavender on plum — and the ink written on it. */
export const DARK_ACCENT = "#c4b5fd";
export const DARK_ON_ACCENT = "#1b1230";

export function resolveAppearance(appearance: Appearance): "light" | "dark" {
  if (appearance !== "system") return appearance;
  // Server-side rendering has no window, and jsdom has no matchMedia; the DOM
  // types account for neither.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
