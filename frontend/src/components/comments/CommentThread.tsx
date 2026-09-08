/**
 * The conversation on a record (§36).
 *
 * Written once and addressed by `resource_type` + `resource_id`, because the
 * comments table is polymorphic and a component per entity would be five
 * copies of the same threading, editing and permission logic.
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Empty,
  Input,
  Skeleton,
  Space,
  Tooltip,
  Typography,
} from "antd";
import { CommentOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { commentsApi, type RecordComment } from "@/api/comments";
import { absoluteTime, relativeTime } from "@/lib/time";
import { PersonAvatar } from "@/components/PersonAvatar";

const { Text, Paragraph } = Typography;

export function CommentThread({
  resourceType,
  resourceId,
}: {
  resourceType: string;
  resourceId: string;
}) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  const key = ["comments", resourceType, resourceId];
  const thread = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => commentsApi.list(resourceType, resourceId, signal),
    enabled: Boolean(resourceId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const post = useMutation({
    mutationFn: (body: string) =>
      commentsApi.create({
        resource_type: resourceType,
        resource_id: resourceId,
        body,
        ...(replyTo ? { parent_id: replyTo } : {}),
      }),
    onSuccess: () => {
      setDraft("");
      setReplyTo(null);
      void refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That comment was not saved."),
  });

  const amend = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => commentsApi.update(id, body),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That edit was not saved."),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => commentsApi.remove(id),
    onSuccess: () => void refresh(),
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That comment was not removed."),
  });

  /** Top-level comments, each with the replies that answer it. */
  const conversation = useMemo(() => {
    const items = thread.data?.items ?? [];
    const replies = new Map<string, RecordComment[]>();
    for (const item of items) {
      if (!item.parent_id) continue;
      replies.set(item.parent_id, [...(replies.get(item.parent_id) ?? []), item]);
    }
    return items
      .filter((item) => !item.parent_id)
      .map((item) => ({ comment: item, replies: replies.get(item.id) ?? [] }));
  }, [thread.data]);

  if (thread.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;

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

  const canComment = thread.data?.can_comment ?? false;

  return (
    <div data-testid="comment-thread">
      {conversation.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<Text type="secondary">No comments yet</Text>}
        />
      ) : (
        <ul className="nu-comments">
          {conversation.map(({ comment, replies }) => (
            <li key={comment.id}>
              <CommentLine
                comment={comment}
                editing={editing?.id === comment.id ? editing.body : null}
                onEditChange={(body) => setEditing({ id: comment.id, body })}
                onEditStart={() => setEditing({ id: comment.id, body: comment.body })}
                onEditCancel={() => setEditing(null)}
                onEditSave={() =>
                  editing && amend.mutate({ id: comment.id, body: editing.body })
                }
                onReply={canComment ? () => setReplyTo(comment.id) : undefined}
                onDelete={() => withdraw.mutate(comment.id)}
                saving={amend.isPending}
              />
              {replies.length > 0 && (
                <ul className="nu-comments nu-comments--replies">
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentLine
                        comment={reply}
                        editing={editing?.id === reply.id ? editing.body : null}
                        onEditChange={(body) => setEditing({ id: reply.id, body })}
                        onEditStart={() => setEditing({ id: reply.id, body: reply.body })}
                        onEditCancel={() => setEditing(null)}
                        onEditSave={() =>
                          editing && amend.mutate({ id: reply.id, body: editing.body })
                        }
                        onDelete={() => withdraw.mutate(reply.id)}
                        saving={amend.isPending}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {canComment ? (
        <div className="nu-comment-composer">
          {replyTo && (
            <Space size={6} className="nu-block">
              <Text type="secondary">Replying to a comment</Text>
              <Button size="small" type="link" onClick={() => setReplyTo(null)}>
                Cancel
              </Button>
            </Space>
          )}
          <Input.TextArea
            rows={3}
            value={draft}
            aria-label="Add a comment"
            placeholder="Add a comment — @name to mention somebody"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            type="primary"
            icon={<CommentOutlined />}
            className="nu-block"
            disabled={!draft.trim()}
            loading={post.isPending}
            onClick={() => post.mutate(draft.trim())}
            data-testid="post-comment"
          >
            Comment
          </Button>
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

/** One line of the conversation, and the controls its author gets. */
function CommentLine({
  comment,
  editing,
  onEditChange,
  onEditStart,
  onEditCancel,
  onEditSave,
  onReply,
  onDelete,
  saving,
}: {
  comment: RecordComment;
  /** The draft body while this one is being edited, else null. */
  editing: string | null;
  onEditChange: (body: string) => void;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onReply?: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  return (
    <article className="nu-comment">
      <PersonAvatar
        size={28}
        src={comment.author.avatar_url}
        initials={initials(comment.author.name)}
      />
      <div className="nu-comment-body">
        <Space size={8} wrap className="nu-comment-head">
          <Text strong>{comment.author.name}</Text>
          <Tooltip title={absoluteTime(comment.created_at)}>
            <Text type="secondary">{relativeTime(comment.created_at)}</Text>
          </Tooltip>
          {comment.edited_at && (
            <Tooltip title={`Edited ${absoluteTime(comment.edited_at)}`}>
              <Text type="secondary">· edited</Text>
            </Tooltip>
          )}
        </Space>

        {editing === null ? (
          <Paragraph className="nu-comment-text">{comment.body}</Paragraph>
        ) : (
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Input.TextArea
              rows={3}
              value={editing}
              aria-label={`Edit comment by ${comment.author.name}`}
              onChange={(event) => onEditChange(event.target.value)}
            />
            <Space size={6}>
              <Button size="small" type="primary" loading={saving} onClick={onEditSave}>
                Save
              </Button>
              <Button size="small" onClick={onEditCancel}>
                Cancel
              </Button>
            </Space>
          </Space>
        )}

        {editing === null && (
          <Space size={4}>
            {onReply && (
              <Button size="small" type="link" onClick={onReply}>
                Reply
              </Button>
            )}
            {comment.can_edit && (
              <>
                <Button size="small" type="link" onClick={onEditStart}>
                  Edit
                </Button>
                <Button size="small" type="link" danger onClick={onDelete}>
                  Delete
                </Button>
              </>
            )}
          </Space>
        )}
      </div>
    </article>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
