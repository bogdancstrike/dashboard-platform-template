/**
 * The navigation (§1): the menu as data (`navGroups.tsx`), its types, and the
 * helpers that resolve a path against it (`navPaths.ts`).
 */
export type { NavGroup, NavItem } from "./types";
export { NAV_GROUPS } from "./navGroups";
export { NAV_ITEMS, selectedKeyFor, trailFor } from "./navPaths";
