/** The notification centre's vocabulary: read states, severity colours, and the read-state helper. */

import type { NotificationPage } from "@/api/notifications";

/** Severity → the AntD tag colour that already means it elsewhere. */
export function severityTag(severity: string): string {
  return severity === "CRITICAL" ? "red" : severity === "WARNING" ? "orange" : "default";
}

export const READ_STATES = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

/**
 * The notification centre (§17).
 *
 * Everything the reader chose is in the URL (§69, §72), so a filtered centre
 * can be pasted to somebody else and back/forward walk the states rather than
 * leaving the page. The list itself is filtered, counted and grouped in
 * PostgreSQL (§71) — a page that groups the twenty-five rows it happens to
 * have downloaded reports "3 of a kind" for something the server would have
 * told it was thirty.
 */
/**
 * One notification's read state, changed in a page of them.
 *
 * A pure function so the guess can be tested without a server, and so the
 * *counts* move with it: a row that greys while the header still says "12
 * unread" is a page disagreeing with itself in front of the reader.
 */
export function withReadState(
  page: NotificationPage,
  id: string,
  isRead: boolean,
): NotificationPage {
  const found = page.items.find((item) => item.id === id);
  if (!found || found.is_read === isRead) return page;

  return {
    ...page,
    items: page.items.map((item) =>
      item.id === id
        ? { ...item, is_read: isRead, read_at: isRead ? new Date().toISOString() : null }
        : item,
    ),
    // Never below zero: a guess that produces "-1 unread" is worse than one
    // that is briefly stale.
    unread: Math.max(0, page.unread + (isRead ? -1 : 1)),
  };
}
