import { useState } from "react";

import type { NavGroup } from "@/app/navigation";

const CLOSED_GROUPS_KEY = "nu.nav.closed";

function readClosedGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(CLOSED_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeClosedGroups(value: string[]) {
  try {
    window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(value));
  } catch {
    /* storage disabled */
  }
}

/** The sidebar groups the reader folded away, remembered in this browser. */
export function useClosedGroups(groups: NavGroup[], currentGroupKey: string | undefined) {
  const [closedGroups, setClosedGroups] = useState<string[]>(readClosedGroups);

  const store = (next: string[]) => {
    setClosedGroups(next);
    writeClosedGroups(next);
  };

  const toggleGroup = (key: string) =>
    store(closedGroups.includes(key) ? closedGroups.filter((k) => k !== key) : [...closedGroups, key]);

  const allGroupsClosed =
    groups.length > 1 &&
    groups.every((group) => group.key === currentGroupKey || closedGroups.includes(group.key));

  // Collapsing everything keeps the current page's group open: folding the
  // menu should never hide where the reader is.
  const setAllGroups = (collapse: boolean) =>
    store(collapse ? groups.map((group) => group.key).filter((key) => key !== currentGroupKey) : []);

  return { closedGroups, toggleGroup, allGroupsClosed, setAllGroups };
}
