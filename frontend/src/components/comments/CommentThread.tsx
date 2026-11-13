/**
 * The conversation on a record (§36, §47).
 *
 * Written once and addressed by `resource_type` + `resource_id`, because the
 * comments table is polymorphic and a component per entity would be five
 * copies of the same threading, editing and permission logic. Since §47 it is
 * the same conversation a chat channel is: mentions that notify, reactions,
 * files, typing, "seen by", and new lines arriving live — and above it, the
 * wiki pages that link to this record.
 *
 * Three things it is careful about:
 *
 * * **It says whether you may write before you write.** A composer that
 *   accepts four hundred characters and then answers 403 is worse than no
 *   composer at all (§76).
 * * **An edited comment says so.** The server stamps `edited_at`; the page
 *   renders it, because a conversation whose lines can change silently is not
 *   a record of anything.
 * * **A reply belongs under what it answers.** Replies are nested one level —
 *   which is what people use — rather than arbitrarily, because a thread that
 *   can indent forever is a thread nobody can read on a laptop.
 */

import { Alert, App as AntApp, Button, Skeleton, Space, Typography } from "antd";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import type { RecordComment } from "@/api/comments";
import { EmptyState } from "@/components/EmptyState";
import { Composer, type ComposerSend } from "@/components/collab/Composer";
import { MessageItem } from "@/components/collab/MessageItem";
import { RecordBacklinks } from "@/components/collab/RecordBacklinks";
import { SeenBy, TypingLine } from "@/components/collab/ConversationBits";
import { usePresence } from "@/components/collab/presence";
import { useConversation } from "@/components/collab/useConversation";
import { useAuth } from "@/auth/AuthProvider";
import "@/styles/collab.css";

const { Text } = Typography;

/** The kinds of thing a wiki page can link to — the business records. */
const LINKABLE = new Set(["task", "project", "customer", "order", "ticket", "device"]);

export function CommentThread({
  resourceType,
  resourceId,
}: {
  resourceType: string;
  resourceId: string;
}) {
  const { message } = AntApp.useApp();
  const { profile } = useAuth();
  const conversation = useConversation({ resourceType, resourceId, mode: "all" });
  const presence = usePresence();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const { thread, items, canComment, reactions, reads } = conversation;

  /** Top-level comments, each with the replies that answer it. */
  const tree = useMemo(() => {
    const replies = new Map<string, RecordComment[]>();
    for (const item of items) {
      if (!item.parent_id) continue;
      replies.set(item.parent_id, [...(replies.get(item.parent_id) ?? []), item]);
    }
    return items
      .filter((item) => !item.parent_id)
      .map((item) => ({ comment: item, replies: replies.get(item.id) ?? [] }));
  }, [items]);

  const fail = (fallback: string) => (error: unknown) => {
    void message.error(error instanceof ApiError ? error.message : fallback);
  };

  const post = (input: ComposerSend) =>
    conversation.send
      .mutateAsync({ ...input, ...(replyTo ? { parent_id: replyTo } : {}) })
      .then(() => setReplyTo(null))
      .catch((error: unknown) => {
        fail("That comment was not saved.")(error);
        throw error;
      });

  if (thread.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;

  if (thread.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={thread.error instanceof ApiError ? thread.error.message : "The conversation could not be loaded."}
        action={
          <Button size="small" onClick={() => void thread.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const line = (comment: RecordComment, reply: boolean) => (
    <MessageItem
      comment={comment}
      presence={presence[comment.author.id]}
      offered={reactions}
      canWrite={canComment}
      editing={editing === comment.id}
      saving={conversation.edit.isPending}
      onReply={canComment && !reply ? () => setReplyTo(comment.id) : undefined}
      onEditStart={() => setEditing(comment.id)}
      onEditCancel={() => setEditing(null)}
      onEditSave={(body) =>
        conversation.edit
          .mutateAsync({ id: comment.id, body })
          .then(() => setEditing(null))
          .catch((error: unknown) => {
            fail("That edit was not saved.")(error);
            throw error;
          })
      }
      onDelete={() => conversation.remove.mutate(comment.id, { onError: fail("That comment was not removed.") })}
      onReact={(emoji) =>
        conversation.react.mutate({ id: comment.id, emoji }, { onError: fail("That reaction was not saved.") })
      }
    />
  );

  const replying = tree.find((entry) => entry.comment.id === replyTo)?.comment;
  const last = items[items.length - 1];

  return (
    <div data-testid="comment-thread" className="nx-co-thread">
      {LINKABLE.has(resourceType) && <RecordBacklinks resourceType={resourceType} resourceId={resourceId} />}

      {tree.length === 0 ? (
        <EmptyState compact title="No comments yet" />
      ) : (
        <ul className="nu-comments">
          {tree.map(({ comment, replies }) => (
            <li key={comment.id}>
              {line(comment, false)}
              {replies.length > 0 && (
                <ul className="nu-comments nu-comments--replies">
                  {replies.map((reply) => (
                    <li key={reply.id}>{line(reply, true)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {last && <SeenBy reads={reads} after={last.created_at} me={profile?.user.id} />}
      <TypingLine names={conversation.typingNames} />

      {canComment ? (
        <div className="nu-comment-composer">
          {replyTo && (
            <Space size={6} className="nu-block">
              <Text type="secondary">
                Replying to {replying ? replying.author.name : "a comment"}
              </Text>
              <Button size="small" type="text" onClick={() => setReplyTo(null)}>
                Cancel
              </Button>
            </Space>
          )}
          <Composer
            label="Add a comment"
            placeholder="Add a comment — @name to mention somebody"
            sendLabel="Comment"
            sendTestId="post-comment"
            busy={conversation.send.isPending}
            onTyping={conversation.typing}
            onSend={post}
          />
        </div>
      ) : (
        <Alert
          type="info"
          showIcon
          message="You can read this conversation but not add to it"
          description="Commenting needs the records.comment permission."
        />
      )}
    </div>
  );
}
