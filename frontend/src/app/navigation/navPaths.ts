import { NAV_GROUPS } from "./navGroups";
import type { NavItem } from "./types";

/** Flattened, for resolving the selected key and for the command palette. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * The item a path belongs to — the longest matching key.
 *
 * Longest wins so `/admin/users` selects Users rather than the Administration
 * overview it also starts with.
 */
export function selectedKeyFor(pathname: string): string {
  // `/` redirects to `/dashboard`, so it selects the same item.
  if (pathname === "/") return "/dashboard";
  let best: string | undefined;
  for (const item of NAV_ITEMS) {
    if (
      (pathname === item.key || pathname.startsWith(`${item.key}/`)) &&
      (!best || item.key.length > best.length)
    ) {
      best = item.key;
    }
  }
  // A page outside the menu (a profile, a setting, an error) selects nothing:
  // highlighting the dashboard there read as "you are still on the page you
  // came from".
  return best ?? "";
}

/** Pages that live outside the navigation, and the trail each one reads as. */
const OUTSIDE_NAV: { prefix: string; trail: { label: string; key: string }[] }[] = [
  { prefix: "/profile/", trail: [{ label: "People", key: "/admin/users" }, { label: "Profile", key: "" }] },
  { prefix: "/profile", trail: [{ label: "Account", key: "/profile" }, { label: "Profile", key: "/profile" }] },
  { prefix: "/settings/preferences", trail: [{ label: "Account", key: "/profile" }, { label: "Preferences", key: "/settings/preferences" }] },
  { prefix: "/settings/security", trail: [{ label: "Account", key: "/profile" }, { label: "Security", key: "/settings/security" }] },
  { prefix: "/errors/", trail: [{ label: "Nucleus", key: "/home" }, { label: "Error", key: "" }] },
  { prefix: "/compare", trail: [{ label: "Records", key: "/projects" }, { label: "Compare", key: "/compare" }] },
];

export function trailFor(pathname: string): { label: string; key: string }[] {
  const outside = OUTSIDE_NAV.find((entry) => pathname === entry.prefix || pathname.startsWith(entry.prefix));
  if (outside) return outside.trail.map((crumb) => ({ ...crumb, key: crumb.key || pathname }));
  const selected = selectedKeyFor(pathname);
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.key === selected);
    if (item) {
      return group.key === "overview" && item.key === "/dashboard"
        ? [{ label: item.label, key: item.key }]
        : [
            { label: group.label, key: group.items[0]?.key ?? item.key },
            { label: item.label, key: item.key },
          ];
    }
  }
  return [{ label: "Nucleus", key: "/" }];
}
