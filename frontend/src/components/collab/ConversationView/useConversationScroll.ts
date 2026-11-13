import { useEffect, useLayoutEffect, type MutableRefObject } from "react";

import type { RecordComment } from "@/api/comments";

/**
 * Stay at the bottom while the reader is at the bottom, keep their place when
 * they have scrolled up, and bring a highlighted line (a search hit) into view.
 */
export function useConversationScroll({
  scroller,
  pinned,
  items,
  resourceId,
  parentId,
  highlight,
  typing,
}: {
  scroller: MutableRefObject<HTMLDivElement | null>;
  pinned: MutableRefObject<boolean>;
  items: RecordComment[];
  resourceId: string;
  parentId?: string;
  highlight?: string | null;
  /** How many people are typing — the line under the messages moves the bottom. */
  typing: number;
}) {
  // Stay at the bottom while the reader is at the bottom; keep their place
  // when they have scrolled up to read something older.
  const count = items.length;
  const lastId = items[items.length - 1]?.id;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !pinned.current || highlight) return;
    node.scrollTop = node.scrollHeight;
  }, [count, lastId, resourceId, highlight, typing]);

  useEffect(() => {
    pinned.current = true;
  }, [resourceId, parentId]);

  useEffect(() => {
    if (!highlight) return;
    const node = scroller.current?.querySelector(
      `[data-comment-id="${highlight}"]`,
    );
    if (node && "scrollIntoView" in node)
      (node as HTMLElement).scrollIntoView({ block: "center" });
  }, [highlight, count]);
}
