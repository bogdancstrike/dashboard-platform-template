import "@testing-library/jest-dom/vitest";

import { configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";

// Testing Library waits one second for `findBy*` by default, which is a
// generous budget for a re-render and a thin one for a page that mounts,
// fetches through MSW and settles — while several other files do the same on
// other workers. Every timeout this suite has hit passed in isolation moments
// later, so the number was measuring machine load rather than the component.
configure({ asyncUtilTimeout: 5_000 });

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
  }));
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom throws "not implemented" for the two-argument form, which AntD's table
// calls while measuring the scrollbar. The measurement is meaningless in jsdom
// anyway; this keeps it from filling the output with stack traces.
const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element, pseudoElement?: string | null) =>
  pseudoElement
    ? ({ getPropertyValue: () => "" } as unknown as CSSStyleDeclaration)
    : realGetComputedStyle(element));

// jsdom implements neither half of the object-URL API, and the download helper
// (§30) needs both to hand a blob to the browser. Recording the created URLs
// lets a test assert a save was actually triggered rather than merely attempted.
if (!URL.createObjectURL) {
  const created: string[] = [];
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:nucleus/${created.length}`;
    created.push(url);
    void blob;
    return url;
  };
  URL.revokeObjectURL = () => {};
}

// `error` rather than `warn`: a request the handlers do not cover is a test
// quietly exercising something nobody described, which is worth failing on.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
