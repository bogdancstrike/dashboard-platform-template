/**
 * One line of a conversation (§36, §47) — a chat message or a record comment.
 *
 * The author, the time, the body in markdown-lite, the files, the reactions,
 * and the controls this reader gets: reply and react for anybody who may write,
 * edit and delete for the author alone. An edited line says so.
 */

import { App as AntApp, Button, Popover, Space, Tooltip, Typography } from "antd";
import { MessageOutlined, PaperClipOutlined, SmileOutlined } from "@ant-design/icons";

import type { Attachment, Reaction, RecordComment } from "@/api/comments";
import { filesApi, readableSize } from "@/api/files";
import type { PresenceStatus } from "@/api/chat";
import { PersonAvatar } from "@/components/PersonAvatar";
import { absoluteTime, relativeTime } from "@/lib/time";

import { Composer } from "./Composer";
import { MarkdownLite } from "./MarkdownLite";
import { PresenceDot } from "./presence";

const { Text } = Typography;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AttachmentList({ files }: { files: Attachment[] }) {
  const { message } = AntApp.useApp();
  if (files.length === 0) return null;
  const open = async (file: Attachment) => {
    try {
      const signed = await filesApi.downloadUrl(file.id);
      window.open(signed.download.url, "_blank", "noopener");
    } catch {
      message.error(`${file.name} could not be opened.`);
    }
  };
  return (
    <ul className="nx-co-files" aria-label="Attached files">
      {files.map((file) => (
        <li key={file.id}>
          <button type="button" onClick={() => void open(file)} className="nx-co-file">
            <PaperClipOutlined />
            <span className="nx-co-file-name">{file.name}</span>
            <span className="nx-co-muted">{readableSize(file.size_bytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ReactionBar({
  reactions,
  offered,
  onReact,
  disabled,
}: {
  reactions: Reaction[];
  offered: string[];
  onReact: (emoji: string) => void;
  disabled?: boolean;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className="nx-co-reactions" aria-label="Reactions">
      {reactions.map((reaction) => (
        <Tooltip key={reaction.emoji} title={reaction.people.join(", ")}>
          <button
            type="button"
            className={`nx-co-reaction${reaction.mine ? " is-mine" : ""}`}
            aria-pressed={reaction.mine}
            aria-label={`${reaction.emoji} ${reaction.count}`}
            disabled={disabled || !offered.includes(reaction.emoji)}
            onClick={() => onReact(reaction.emoji)}
          >
            <span>{reaction.emoji}</span>
            <b>{reaction.count}</b>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function ReactionPicker({
  offered,
  onReact,
  disabled,
}: {
  offered: string[];
  onReact: (emoji: string) => void;
  disabled?: boolean;
}) {
  return (
    <Popover
      trigger="click"
      placement="top"
      content={
        <div className="nx-co-emoji" role="group" aria-label="Pick a reaction">
          {offered.map((emoji) => (
            <button key={emoji} type="button" aria-label={`React ${emoji}`} onClick={() => onReact(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      }
    >
      <Button size="small" type="text" icon={<SmileOutlined />} aria-label="Add a reaction" disabled={disabled} />
    </Popover>
  );
}

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
