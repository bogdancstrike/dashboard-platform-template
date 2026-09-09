/**
 * The datasets whose *records* have a page of their own (§8).
 *
 * `App.tsx` serves a `:id` route under six list paths; the rest of the
 * catalogue's datasets are reachable only as rows — `/files` opens a preview,
 * `/admin/users` opens a person, and neither is a `<list>/<id>` address.
 *
 * A set rather than a lookup through the router, because React Router's table
 * is JSX and enumerating it means rendering every lazy page. `records.test.ts`
 * reads `App.tsx` and fails when the two disagree, which is the same mechanism
 * the page gallery uses (§61) — the duplication is checked rather than
 * trusted.
 */
export const RECORD_PAGES = new Set([
  "task",
  "project",
  "ticket",
  "customer",
  "order",
  "device",
]);
