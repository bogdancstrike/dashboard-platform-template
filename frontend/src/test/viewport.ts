/**
 * A pretend window width, for the tests that are about a layout.
 *
 * jsdom answers every media query with "no", which is a desktop to AntD's
 * `Grid.useBreakpoint()` (no breakpoint matches) and something else again to
 * code that asks `(max-width: …)`. This answers `min-width` and `max-width`
 * queries for a real width, so a page renders the phone or tablet layout it
 * would render on the device the design draws.
 *
 * Call `viewport(...)` before rendering, and `afterEach(restoreViewport)` in
 * the file, so the next test is back at jsdom's default.
 */
import { vi } from "vitest";

export const WIDTHS = { phone: 390, tablet: 1194, pc: 1440 } as const;

const original = window.matchMedia.bind(window);

function matches(query: string, width: number): boolean {
  const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
  const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
  if (!min && !max) return false;
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}

/** Pretend the window is `width` pixels wide — or one of the design's devices. */
export function viewport(device: keyof typeof WIDTHS | number): void {
  const width = typeof device === "number" ? device : WIDTHS[device];
  window.matchMedia = ((query: string) => ({
    matches: matches(query, width),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  }));
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

export function restoreViewport(): void {
  window.matchMedia = original;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
}
