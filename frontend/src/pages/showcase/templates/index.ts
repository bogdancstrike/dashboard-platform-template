/**
 * The page layouts this template offers, and which pages use each (§61).
 *
 * A gallery of layouts is worth having only if it is *complete*: the question
 * somebody asks it is "what shapes does this template give me", and a gallery
 * missing two shapes answers it wrongly. So this file is one declaration —
 * every layout, and every route classified under exactly one of them — and
 * `templates.test.ts` asserts it against the router.
 *
 * That assertion is the whole design. A page added to `App.tsx` and not
 * classified here fails a test, which is the only way a gallery like this
 * stays true: the alternative is a hand-kept list that is wrong by the third
 * new page and quietly misleads everybody who reads it afterwards.
 *
 * Kept in its own module rather than in the page for two reasons: the test
 * needs it without rendering anything, and the page is then only a rendering
 * of a declaration rather than the place the declaration lives.
 */

import type { PageLayout } from "./types";
import { COLLECTION_LAYOUTS } from "./collectionLayouts";
import { WORK_LAYOUTS } from "./workLayouts";
import { EDGE_LAYOUTS } from "./edgeLayouts";

export type { PageLayout, Region } from "./types";

/**
 * Every layout, in the order a reader meets them.
 *
 * `unless` is on every one deliberately. A gallery that only says what each
 * layout is *for* invites somebody to reach for the most impressive one; the
 * useful half is knowing when a split view is worse than a table.
 */
export const LAYOUTS: PageLayout[] = [...COLLECTION_LAYOUTS, ...WORK_LAYOUTS, ...EDGE_LAYOUTS];

/** Every route the gallery accounts for, flattened. */
export function classified(): string[] {
  return LAYOUTS.flatMap((layout) => layout.routes).sort();
}

/** Which layout a route is built as, or `undefined` when unclassified. */
export function layoutOf(route: string): PageLayout | undefined {
  return LAYOUTS.find((layout) => layout.routes.includes(route));
}
