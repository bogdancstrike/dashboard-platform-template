/**
 * A conversation's messages, newest at the bottom (§47) — used for a channel
 * and, with `parentId`, for the replies in a thread panel.
 *
 * Lines from the same person within a few minutes are drawn as one block, a
 * day gets a divider, and the first line nobody has read yet gets a "New"
 * rule — placed from the reader's marker as it stood when they opened the
 * conversation, so it does not vanish the moment it is drawn.
 */

import { Alert, App as AntApp, Button, Skeleton } from "antd";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ApiError } from "@/api/client";
import type { RecordComment } from "@/api/comments";
import type { PresenceStatus } from "@/api/chat";
import { useAuth } from "@/auth/AuthProvider";
import { EmptyState } from "@/components/EmptyState";

import { Composer, type ComposerSend } from "./Composer";
import { DayDivider, NewDivider, SeenBy, TypingLine } from "./ConversationBits";
import { MessageItem } from "./MessageItem";
import { useConversation } from "./useConversation";

/** Lines this close together from one person read as one message. */
const GROUP_MS = 5 * 60_000;

export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function ConversationView({
  resourceType,
  resourceId,
  parentId,
  presence,
  canPost,
  composerLabel = "Message",
  placeholder,
  onOpenThread,
  highlight,
  head,
  emptyTitle = "No messages yet",
  footer,
}: {
  resourceType: string;
  resourceId: string;
  parentId?: string;
  presence: Record<string, PresenceStatus>;
  /** Whether the composer is offered at all (membership, archive). */
  canPost: boolean;
  composerLabel?: string;
  placeholder?: string;
  onOpenThread?: (message: RecordComment) => void;
  /** A line to scroll to and mark — from a search hit. */
  highlight?: string | null;
  /** Drawn above the lines, inside the scroller — the parent in a thread. */
  head?: ReactNode;
  emptyTitle?: string;
  /** Drawn instead of the composer when it is not offered. */
  footer?: ReactNode;
}) {
  const { message } = AntApp.useApp();
  const { profile } = useAuth();
  const conversation = useConversation({
    resourceType,
    resourceId,
    mode: parentId ? "all" : "window",
    parentId,
  });
  const { thread, items, reactions, reads, openedAt } = conversation;
  const [editing, setEditing] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const me = profile?.user.id;

  // Stay at the bottom while the reader is at the bottom; keep their place
  // when they have scrolled up to read something older.
  const count = items.length;
  const lastId = items[items.length - 1]?.id;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !pinned.current || highlight) return;
    node.scrollTop = node.scrollHeight;
  }, [count, lastId, resourceId, highlight, conversation.typingNames.length]);

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

  const firstUnread = useMemo(() => {
    if (!openedAt) return null;
    return (
      items.find((item) => item.created_at > openedAt && item.author.id !== me)
        ?.id ?? null
    );
  }, [items, openedAt, me]);

  const fail = (fallback: string) => (error: unknown) => {
    void message.error(error instanceof ApiError ? error.message : fallback);
  };

  const send = (input: ComposerSend) =>
    conversation.send
      .mutateAsync({ ...input, ...(parentId ? { parent_id: parentId } : {}) })
      .catch((error: unknown) => {
        fail("That message was not sent.")(error);
        throw error;
      });

  if (thread.isLoading) {
    return (
      <div className="nx-co-conv">
        <div className="nx-co-scroll">
          <Skeleton active avatar paragraph={{ rows: 3 }} />
          <Skeleton active avatar paragraph={{ rows: 2 }} />
        </div>
      </div>
    );
  }
  if (thread.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={
          thread.error instanceof ApiError
            ? thread.error.message
            : "The conversation could not be loaded."
        }
        action={
          <Button size="small" onClick={() => void thread.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const last = items[items.length - 1];

  return (
    <div className="nx-co-conv">
      <div
        className="nx-co-scroll"
        ref={scroller}
        data-testid="chat-messages"
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {head}
        {conversation.hasMore && (
          <div className="nx-co-older">
            <Button
              size="small"
              onClick={() => conversation.loadOlder()}
              loading={thread.isFetching}
            >
              Load earlier messages
            </Button>
          </div>
        )}
        {items.length === 0 && !head && (
          <EmptyState compact title={emptyTitle} />
        )}
        {items.map((item, index) => {
          const previous = items[index - 1];
          const newDay =
            !previous || !sameDay(previous.created_at, item.created_at);
          const compact =
            !newDay &&
            !!previous &&
            previous.author.id === item.author.id &&
            new Date(item.created_at).getTime() -
              new Date(previous.created_at).getTime() <
              GROUP_MS &&
            item.id !== firstUnread;
          return (
            <div key={item.id}>
              {newDay && <DayDivider iso={item.created_at} />}
              {item.id === firstUnread && <NewDivider />}
              <MessageItem
                comment={item}
                compact={compact}
                presence={presence[item.author.id]}
                offered={reactions}
                canWrite={canPost}
                editing={editing === item.id}
                saving={conversation.edit.isPending}
                className={item.id === highlight ? "is-highlight" : ""}
                onReply={
                  canPost && onOpenThread && !parentId
                    ? () => onOpenThread(item)
                    : undefined
                }
                onOpenThread={
                  onOpenThread && !parentId
                    ? () => onOpenThread(item)
                    : undefined
                }
                onEditStart={() => setEditing(item.id)}
                onEditCancel={() => setEditing(null)}
                onEditSave={(body) =>
                  conversation.edit
                    .mutateAsync({ id: item.id, body })
                    .then(() => setEditing(null))
                    .catch((error: unknown) => {
                      fail("That edit was not saved.")(error);
                      throw error;
                    })
                }
                onDelete={() =>
                  conversation.remove.mutate(item.id, {
                    onError: fail("That message was not removed."),
                  })
                }
                onReact={(emoji) =>
                  conversation.react.mutate(
                    { id: item.id, emoji },
                    { onError: fail("That reaction was not saved.") },
                  )
                }
              />
            </div>
          );
        })}
        {last && <SeenBy reads={reads} after={last.created_at} me={me} />}
      </div>
      <TypingLine names={conversation.typingNames} />
      {canPost ? (
        <div data-testid="chat-composer">
          <Composer
            label={composerLabel}
            placeholder={placeholder}
            busy={conversation.send.isPending}
            onTyping={conversation.typing}
            onSend={send}
            sendTestId={parentId ? "send-reply" : "send-message"}
          />
        </div>
      ) : (
        footer
      )}
    </div>
  );
}
