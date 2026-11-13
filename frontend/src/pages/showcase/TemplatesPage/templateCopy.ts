

import { LAYOUTS, classified, type PageLayout } from "@/pages/showcase/templates";
import { formatNumber } from "@/lib/formats";

/** How a route reads as a link label — the address, which is what somebody types. */
/** Three rows, for the split-view miniature. A shape, not a dataset. */
export const PREVIEW_ROWS = [
  {
    reference: "TIC-00041",
    title: "Printer on fire in the north wing",
    status: "OPEN",
    who: "Lakeside Group",
    body: "Reported this morning. The smoke has stopped, which the reporter considers progress.",
  },
  {
    reference: "TIC-00042",
    title: "Export finishes but the file is empty",
    status: "IN_PROGRESS",
    who: "Northwind Trading",
    body: "Reproduced on a filtered ledger of 40 000 rows. The queue accepted it and wrote nothing.",
  },
  {
    reference: "TIC-00043",
    title: "Login loops on Safari 17",
    status: "RESOLVED",
    who: "Harbour Logistics",
    body: "The redirect kept its own hash. Fixed by reading the token before the router boots.",
  },
];

export function routeLabel(route: string): string {
  return `/${route}`;
}

/**
 * The gallery's own summary: how many shapes, over how many pages.
 *
 * One sentence rather than two counters, and it names the *completeness*
 * because that is the property this page lives or dies on.
 */
export function summary(layouts: PageLayout[] = LAYOUTS): string {
  const shapes = layouts.filter((layout) => layout.key !== "redirect").length;
  const pages = classified().length;
  return `${shapes} page shapes across ${formatNumber(pages)} routes. Every route in the router is classified as exactly one of them, which a test enforces.`;
}
