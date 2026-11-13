/**
 * One line of a conversation (§36, §47) — a chat message or a record comment.
 *
 * The author, the time, the body in markdown-lite, the files, the reactions,
 * and the controls this reader gets: reply and react for anybody who may write,
 * edit and delete for the author alone. An edited line says so.
 */

import { Button, Space, Tooltip, Typography } from "antd";
import { MessageOutlined } from "@ant-design/icons";

import type { RecordComment } from "@/api/comments";
import type { PresenceStatus } from "@/api/chat";
import { PersonAvatar } from "@/components/PersonAvatar";
import { absoluteTime, relativeTime } from "@/lib/time";

import { Composer } from "../Composer";
import { MarkdownLite } from "../MarkdownLite";
import { PresenceDot } from "../presence";

import { AttachmentList } from "./AttachmentList";
import { ReactionBar, ReactionPicker } from "./Reactions";
import { clockTime, initials } from "./format";

export { AttachmentList } from "./AttachmentList";
export { clockTime, initials } from "./format";

const { Text } = Typography;

export function MessageItem({
  comment,
  compact = false,
  presence,
  offered,
  editing,
  saving,
  canWrite,
  onReply,
  onOpenThread,
  onEditStart,
  onEditCancel,
  onEditSave,
  onDelete,
  onReact,
  className = "",
}: {
  comment: RecordComment;
  /** A follow-on line from the same person: no avatar or name again. */
  compact?: boolean;
  presence?: PresenceStatus;
  offered: string[];
  editing: boolean;
  saving: boolean;
  canWrite: boolean;
  onReply?: () => void;
  onOpenThread?: () => void;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditSave: (body: string) => Promise<unknown>;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  className?: string;
}) {
  const reactions = comment.reactions ?? [];
  const replies = comment.reply_count ?? 0;
  return (
    <article
      className={`nu-comment nx-co-msg${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}
      data-comment-id={comment.id}
    >
      <div className="nx-co-msg-gutter">
        {compact ? (
          <Tooltip title={absoluteTime(comment.created_at)}>
            <span className="nx-co-msg-clock">{clockTime(comment.created_at)}</span>
          </Tooltip>
        ) : (
          <span className="nx-co-avatar">
            <PersonAvatar size={32} src={comment.author.avatar_url} initials={initials(comment.author.name)} />
            {presence && <PresenceDot status={presence} className="nx-co-avatar-dot" />}
          </span>
        )}
      </div>
      <div className="nu-comment-body nx-co-msg-body">
        {!compact && (
          <Space size={8} wrap className="nu-comment-head nx-co-msg-head">
            <Text strong>{comment.author.name}</Text>
            <Tooltip title={absoluteTime(comment.created_at)}>
              <Text type="secondary" className="nx-co-msg-time">
                {relativeTime(comment.created_at)}
              </Text>
            </Tooltip>
            {comment.edited_at && (
              <Tooltip title={`Edited ${absoluteTime(comment.edited_at)}`}>
                <Text type="secondary">· edited</Text>
              </Tooltip>
            )}
          </Space>
        )}

        {editing ? (
          <Composer
            initial={comment.body}
            label={`Edit comment by ${comment.author.name}`}
            sendLabel="Save"
            sendTestId="save-edit"
            busy={saving}
            allowFiles={false}
            autoFocus
            compact
            onCancel={onEditCancel}
            onSend={({ body }) => onEditSave(body)}
          />
        ) : (
          <>
            {comment.body && <MarkdownLite text={comment.body} className="nu-comment-text" />}
            {compact && comment.edited_at && <Text type="secondary">· edited</Text>}
          </>
        )}
        <AttachmentList files={comment.attachments ?? []} />
        <ReactionBar reactions={reactions} offered={offered} onReact={onReact} disabled={!canWrite} />

        {onOpenThread && replies > 0 && (
          <button type="button" className="nx-co-replies" onClick={onOpenThread} data-testid="open-thread">
            <MessageOutlined /> {replies} {replies === 1 ? "reply" : "replies"}
            {comment.last_reply_at && (
              <span className="nx-co-muted"> · last {relativeTime(comment.last_reply_at)}</span>
            )}
          </button>
        )}

        {!editing && (
          <div className="nx-co-msg-actions">
            {canWrite && offered.length > 0 && <ReactionPicker offered={offered} onReact={onReact} />}
            {onReply && (
              <Button size="small" type="text" onClick={onReply}>
                Reply
              </Button>
            )}
            {comment.can_edit && (
              <>
                <Button size="small" type="text" onClick={onEditStart}>
                  Edit
                </Button>
                {/* Withdrawn straight away, without a dialog: a message is a
                    sentence rather than a record, and the audit trail keeps it. */}
                <Button size="small" type="text" danger onClick={onDelete}>
                  Delete
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
