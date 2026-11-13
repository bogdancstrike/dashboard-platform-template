import type { PageLayout } from "./types";

/** The problem page and the redirect: what a route is when it is not a page. */
export const EDGE_LAYOUTS: readonly PageLayout[] = [
  {
    key: "problem",
    name: "Problem page",
    shape:
      "One centred explanation: what happened, what to do about it, and the reference that makes it findable.",
    when:
      "The page cannot be shown at all — a wrong address, a missing permission, a fault, an API that is not answering.",
    unless:
      "The *data* is missing rather than the page — an empty list is a normal answer to a reasonable question, and dressing it as a failure teaches a reader to ignore both.",
    wireframe: [
      [{ label: "What happened", span: 12, primary: true }],
      [{ label: "What to do next", span: 12 }],
      [{ label: "The reference to quote", span: 12 }],
    ],
    pieces: ["ProblemPage", "The correlation id", "A retry, where retrying can work"],
    url: "The status, so the page is addressable and can be looked at before it is needed.",
    // Addressable on purpose: two of the six cannot be reached by asking, so
    // without a route they would be screens nobody could look at until the day
    // they mattered (§34).
    routes: [
      "errors/401",
      "errors/403",
      "errors/404",
      "errors/500",
      "errors/maintenance",
      "errors/session-expired",
      // A feature switched off, which is not a permission refusal: the shell
      // shows it in place, and it is addressable so it can be looked at (§27).
      "errors/switched-off",
    ],
  },
  {
    key: "redirect",
    name: "Not a layout",
    shape: "A route that resolves to another one.",
    when:
      "An address has to keep working — a bookmark, an old link, a shortcut somebody typed.",
    unless: "Never: these exist so links do not rot, and they carry what they were given.",
    wireframe: [[{ label: "→ somewhere else", span: 12 }]],
    pieces: ["Navigate, replace"],
    url: "The address that used to work, kept working.",
    routes: ["system"],
  },
];
