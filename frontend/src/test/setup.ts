import "@testing-library/jest-dom/vitest";

import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";

// jsdom implements neither of these, and AntD's responsive observers and the
// appearance provider both reach for them on mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom throws "not implemented" for the two-argument form, which AntD's table
// calls while measuring the scrollbar. The measurement is meaningless in jsdom
// anyway; this keeps it from filling the output with stack traces.
const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element, pseudoElement?: string | null) =>
  pseudoElement
    ? ({ getPropertyValue: () => "" } as unknown as CSSStyleDeclaration)
    : realGetComputedStyle(element)) as typeof window.getComputedStyle;

// `error` rather than `warn`: a request the handlers do not cover is a test
// quietly exercising something nobody described, which is worth failing on.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
