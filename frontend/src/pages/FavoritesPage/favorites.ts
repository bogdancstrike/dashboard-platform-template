import { type Bookmark, type BookmarkList } from "@/api/favorites";
import { formatNumber } from "@/lib/formats";

/**
 * What a resource type is called in a sentence.
 *
 * Derived from the type itself rather than from a lookup table, because the
 * bookmarkable types come from the platform's registry and a hand-kept map
 * would be missing whichever one was added last. `saved_search` becomes
 * "Saved search" — which is all a label has to do.
 */
export function kindLabel(resourceType: string): string {
  const spaced = resourceType.replace(/_/g, " ");
  return spaced.slice(0, 1).toUpperCase() + spaced.slice(1);
}

/**
 * The order a move produces, as ids.
 *
 * Pure so it can be asserted directly, and returning the *whole* order rather
 * than a pair of positions: the server takes one list, because applying a drag
 * as a series of single moves is how two moves end up fighting over one
 * position. A move off either end returns the order unchanged rather than
 * wrapping — wrapping would send the top item to the bottom on a mis-click.
 */
export function movedOrder(items: Bookmark[], id: string, direction: -1 | 1): string[] {
  const ids = items.map((item) => item.id);
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** How full the shortcut bar is, in words rather than a fraction. */
export function capacityNote(list: BookmarkList): string {
  if (list.total === 0) return "Nothing kept yet.";
  const kinds = list.kinds.length;
  const spread =
    kinds === 1
      ? `all of one kind`
      : `across ${kinds} kinds`;
  if (list.total >= list.maximum) {
    return `${formatNumber(list.total)} kept ${spread} — that is the limit. Remove one to keep another.`;
  }
  return `${formatNumber(list.total)} kept ${spread}. Up to ${formatNumber(list.maximum)}.`;
}
