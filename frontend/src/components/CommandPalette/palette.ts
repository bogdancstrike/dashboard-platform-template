import { type GlobalHit } from "@/api/search";
import { RECORD_PAGES } from "@/app/records";

//: Two letters before the server is asked. One matches most of a database,
//: and the answer would be discarded by the next keystroke.
export const MIN_RECORD_TERM = 2;

/**
 * Where selecting a record goes.
 *
 * Its own page when this dataset has one, and the explorer narrowed to it when
 * it does not — `/files` and `/admin/users` list records the router serves no
 * detail route for, and sending somebody to a 404 is worse than sending them
 * to a filtered list.
 */
export function recordAddress(hit: GlobalHit, path: string): string {
  if (RECORD_PAGES.has(hit.resource_type)) return `${path}/${hit.id}`;
  return `/explore?resource=${hit.resource_type}&f.id=${hit.id}`;
}

export const isMacPlatform =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
