/**
 * Moving a card between two lanes' cached pages by hand, so a drop lands
 * exactly where the gap was drawn before the round trip.
 */

import type { TaskRow } from "./types";

/** A lane's cached page, without one card. */
export function withoutTask(current: unknown, id: string) {
  const page = current as { items?: TaskRow[] } | undefined;
  if (!page?.items) return current;
  return { ...page, items: page.items.filter((item) => item.id !== id) };
}

/** A lane's cached page, with one card at `index` in it. */
export function withTask(current: unknown, task: TaskRow, index: number) {
  const page = current as { items?: TaskRow[] } | undefined;
  if (!page?.items) return current;
  const rest = page.items.filter((item) => item.id !== task.id);
  const at = Math.min(Math.max(0, index), rest.length);
  return { ...page, items: [...rest.slice(0, at), task, ...rest.slice(at)] };
}
