import type { ReactNode } from "react";

import type { NxIconName } from "@/components/NxIcon";

/**
 * The navigation, grouped by what somebody came here to do rather than by the
 * data model (§1).
 *
 * Two properties matter beyond the labels:
 *
 * * **Permission-aware.** An item names the permission it needs; the shell
 *   hides what the signed-in role cannot reach, rather than showing it and
 *   answering with a 403. A menu full of dead ends teaches people to distrust
 *   the menu.
 * * **Badge-aware.** An item can name a counter that rides along on the
 *   `/api/me/counts` poll, so "12 waiting on you" is visible without opening
 *   the page.
 * * **Flag-aware.** An item can name a feature flag (§27), and the shell hides
 *   it when that flag is off for this reader. `experimental` used to be a
 *   boolean here with no source of truth behind it — a marking that said "this
 *   is new" and connected to nothing, while a whole flag screen sat in
 *   administration changing nothing at all.
 */
export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** Permission required to see it at all. Absent means everyone. */
  permission?: string;
  /** Which counter from the badge poll rides along. */
  badge?: string;
  /**
   * The feature flag this item is behind (§27).
   *
   * Off means the item is not in the menu *and* the route is not reachable —
   * a menu that hides a page whose address still works is a menu somebody
   * routes around. A flag gates a feature; it never gates administration, so
   * nothing under Administration names one.
   */
  flag?: string;
  /** Marks a feature still behind a flag (§1, §27). */
  experimental?: boolean;
  disabled?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  /** The rail's icon for the whole group (tablet widths). */
  icon: NxIconName;
  items: NavItem[];
}
