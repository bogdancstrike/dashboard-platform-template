/**
 * What has to be re-read after a record is written (§9, §73).
 *
 * Every write path used to name the query families it thought it affected —
 * `entity-rows`, `entity-insights`, `task-lane` — and the list was different
 * in three places. That is fine until a *fourth* page reads records: a bulk
 * edit made from the data explorer changed two rows and left the explorer
 * showing the old ones, because `explorer-results` was not on anybody's list.
 * The reader's only recourse was to reload the page, which is the specific
 * failure this module exists to make impossible.
 *
 * So the rule is inverted. After a record write, **everything is stale except
 * the things a record write cannot possibly have changed** — the field
 * catalogues, the permission list, the platform's own name. Those are named
 * here, once, and everything else is re-read.
 *
 * Two objections, answered:
 *
 * * *Is that not a lot of requests?* No. React Query only refetches queries
 *   that are **currently mounted**; the rest are marked stale and re-read the
 *   next time something asks for them. A page has a handful of live queries,
 *   so this costs about what naming them by hand did — and it is right on the
 *   page nobody remembered.
 * * *Why not name the families?* Because that list is a promise the next
 *   feature breaks silently. An allowlist of things that *cannot* change is
 *   short, stable, and fails in the harmless direction: forget an entry and a
 *   catalogue is fetched once more than it needed to be.
 */

import type { QueryClient } from "@tanstack/react-query";

/**
 * Query families a record write cannot invalidate.
 *
 * Each is a *declaration* — a field catalogue, a vocabulary, a role's
 * permissions, the platform's own identity. Adding a row to `orders` does not
 * change what an order's columns are.
 */
const UNAFFECTED = new Set([
  "analysis-catalogue",
  "explorer-catalogue",
  "meta-app",
  "meta-vocabulary",
  "me",
  "roles",
  "permissions",
  "settings",
  "flags",
]);

/**
 * Mark every view of the data stale, after writing some of it.
 *
 * Call it from anywhere a record changes — a form, a bulk action, a drag on a
 * board. It never throws and never awaits: a refresh that failed is a screen
 * one keystroke out of date, and blocking a save on it would be worse.
 */
export function refreshRecordViews(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      // Only the first segment, and only when it is a string: every key in
      // this product starts with a family name, and one that does not is one
      // this cannot classify — so it is refreshed, which is the safe answer.
      const family = query.queryKey[0];
      return typeof family !== "string" || !UNAFFECTED.has(family);
    },
  });
}

/** Exported for the test that asserts the allowlist is what it claims to be. */
export const UNAFFECTED_BY_RECORD_WRITES = UNAFFECTED;
