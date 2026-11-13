/**
 * One conversation — a channel's or a record's — as the page sees it (§36, §47).
 *
 * Reading, writing and live updates in one place, so the chat page, the
 * thread panel and the record thread behave the same way:
 *
 * * **A live hint re-reads; it never patches.** The socket says "something
 *   changed in this conversation", and the listing is fetched again through
 *   the endpoint that checks who may see it.
 * * **Opening is reading.** The reader's marker moves when the conversation is
 *   shown and when a line arrives while it is on screen — but the "new"
 *   divider keeps the marker as it was when the page opened, or it would
 *   vanish the moment it was drawn.
 * * **Typing is a few seconds of truth.** A name is shown for six seconds
 *   after the last hint, and the hint is sent at most every three.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commentsApi, type CommentThread, type ListOptions } from "@/api/comments";
import { useLiveEvents } from "@/live/LiveProvider";

export interface Typist {
  id: string;
  name: string;
}

const TYPING_SHOWN_MS = 6_000;
const TYPING_EVERY_MS = 3_000;
const WINDOW = 50;

export function conversationKey(resourceType: string, resourceId: string, scope = "all") {
  return ["comments", resourceType, resourceId, scope] as const;
}

export function useConversation({
  resourceType,
  resourceId,
  mode = "all",
  parentId,
  markRead = true,
}: {
  resourceType: string;
  resourceId: string;
  /** `window`: newest lines, top-level only (chat). `all`: the whole thread (a record). */
  mode?: "window" | "all";
  /** The replies to one line (a thread panel). */
  parentId?: string;
  markRead?: boolean;
}) {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(WINDOW);
  const [typists, setTypists] = useState<Record<string, Typist & { until: number }>>({});
  const opened = useRef<string | null | undefined>(undefined);

  const scope = parentId ? `replies:${parentId}` : mode === "window" ? `window:${limit}` : "all";
  const key = conversationKey(resourceType, resourceId, scope);
  const options: ListOptions = parentId ? { parent_id: parentId } : mode === "window" ? { limit } : {};

  const thread = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => commentsApi.list(resourceType, resourceId, signal, options),
    enabled: Boolean(resourceId),
    placeholderData: (previous) => previous,
  });

  // The marker as it stood when this conversation was opened, for the divider.
  useEffect(() => {
    opened.current = undefined;
    setLimit(WINDOW);
    setTypists({});
  }, [resourceType, resourceId]);
  if (opened.current === undefined && thread.data && !thread.isPlaceholderData) {
    opened.current = thread.data.my_last_read_at ?? null;
  }

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["comments", resourceType, resourceId] }),
    [queryClient, resourceType, resourceId],
  );

  const read = useMutation({
    mutationFn: () => commentsApi.read(resourceType, resourceId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["chat-channels"] }),
  });
  const newest = thread.data?.items[thread.data.items.length - 1]?.created_at;
  useEffect(() => {
    if (!markRead || !resourceId || !thread.data || parentId) return;
    read.mutate();
    // Once per conversation and once per newest line — not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType, resourceId, newest, markRead, Boolean(thread.data)]);

  useLiveEvents((message) => {
    if (message["resource_type"] !== resourceType || message["resource_id"] !== resourceId) return;
    if (message.type === "thread") {
      void refresh();
      setTypists((current) => {
        const author = typeof message["author_id"] === "string" ? message["author_id"] : "";
        if (!(author in current)) return current;
        const next = { ...current };
        delete next[author];
        return next;
      });
    } else if (message.type === "thread.read") {
      void refresh();
    } else if (message.type === "typing") {
      const user = message["user"] as Typist | undefined;
      if (!user?.id) return;
      setTypists((current) => ({ ...current, [user.id]: { ...user, until: Date.now() + TYPING_SHOWN_MS } }));
    }
  });

  // Typists fade out on their own.
  useEffect(() => {
    const ids = Object.keys(typists);
    if (ids.length === 0) return;
    const soonest = Math.min(...ids.map((id) => typists[id]!.until));
    const timer = window.setTimeout(() => {
      const moment = Date.now();
      setTypists((current) =>
        Object.fromEntries(Object.entries(current).filter(([, value]) => value.until > moment)),
      );
    }, Math.max(50, soonest - Date.now()));
    return () => window.clearTimeout(timer);
  }, [typists]);

  const lastTyped = useRef(0);
  const typing = useCallback(() => {
    const moment = Date.now();
    if (moment - lastTyped.current < TYPING_EVERY_MS) return;
    lastTyped.current = moment;
    void commentsApi.typing(resourceType, resourceId).catch(() => undefined);
  }, [resourceType, resourceId]);

  const send = useMutation({
    mutationFn: (input: { body: string; parent_id?: string; mention_ids?: string[]; attachment_ids?: string[] }) =>
      commentsApi.create({ resource_type: resourceType, resource_id: resourceId, ...input }),
    onSuccess: () => {
      lastTyped.current = 0;
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
    },
  });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => commentsApi.update(id, body),
    onSuccess: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => commentsApi.remove(id),
    onSuccess: () => void refresh(),
  });
  const react = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) => commentsApi.react(id, emoji),
    onSuccess: (updated) => {
      // The server answered with the line as it now is; put it in place at
      // once so the chip does not flicker back while the listing is re-read.
      queryClient.setQueriesData<CommentThread>(
        { queryKey: ["comments", resourceType, resourceId] },
        (old) =>
          old
            ? { ...old, items: old.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)) }
            : old,
      );
      void refresh();
    },
  });

  const loadOlder = useCallback(() => setLimit((current) => current + WINDOW), []);

  const typingNames = useMemo(() => Object.values(typists).map((typist) => typist.name), [typists]);

  return {
    thread,
    items: (thread.data?.items ?? []),
    canComment: thread.data?.can_comment ?? false,
    hasMore: thread.data?.has_more ?? false,
    reads: thread.data?.reads ?? [],
    reactions: thread.data?.reactions ?? [],
    openedAt: opened.current ?? null,
    loadOlder,
    typing,
    typingNames,
    send,
    edit,
    remove,
    react,
    refresh,
  };
}

export type Conversation = ReturnType<typeof useConversation>;
