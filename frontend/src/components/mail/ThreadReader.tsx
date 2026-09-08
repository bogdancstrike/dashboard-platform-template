/**
 * One conversation, read (§15).
 *
 * Three decisions worth stating.
 *
 * **The latest message is open and the earlier ones are collapsed.** A thread
 * is opened to read the newest thing in it; five expanded messages means
 * scrolling past four things somebody has already read to reach the one they
 * came for.
 *
 * **A draft in the thread is offered as a draft, not as a message.** It is the
 * one row in a conversation that can still be changed, so it says so and its
 * controls are Edit and Discard rather than Reply.
 *
 * **The body is plain text, rendered as paragraphs.** The server stores what
 * somebody typed and escapes it for the HTML column; this reads the text one.
 * Rendering a colleague's HTML would make a mailbox a place to run script in
 * somebody's browser, and no amount of sanitising makes that a good trade for
 * a template.
 */

import { Alert, Avatar, Button, Collapse, Space, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, EditOutlined, PaperClipOutlined } from "@ant-design/icons";

import type { MailMessage, MailThread } from "@/api/mail";
import { absoluteTime, relativeTime } from "@/lib/time";
// `readableSize` and not a second byte formatter: the files client already
// decides how many decimals a size gets, and two answers to "how big is
// this" is one too many.
import { readableSize } from "@/api/files";

const { Paragraph, Text, Title } = Typography;

export function ThreadReader({
  thread,
  onReply,
  onEditDraft,
  onDiscardDraft,
}: {
  thread: MailThread;
  onReply: () => void;
  onEditDraft: (message: MailMessage) => void;
  onDiscardDraft: (message: MailMessage) => void;
}) {
  const messages = thread.messages ?? [];
  const last = messages[messages.length - 1];
  const earlier = messages.slice(0, -1);

  return (
    <article className="nu-reader" data-testid="thread-reader">
      <header className="nu-reader-head">
        <Title level={5} className="nu-reader-subject">
          {thread.subject}
        </Title>
        <Space size={6} wrap>
          {thread.labels.map((label) => (
            <Tag key={label} bordered={false}>
              {label}
            </Tag>
          ))}
          <Text type="secondary">
            {thread.message_count} {thread.message_count === 1 ? "message" : "messages"}
          </Text>
        </Space>
      </header>

      {/* Collapsed, because a thread is opened to read the newest thing in it. */}
      {earlier.length > 0 && (
        <Collapse
          ghost
          size="small"
          data-testid="earlier-messages"
          items={earlier.map((message) => ({
            key: message.id,
            label: (
              <span className="nu-reader-collapsed">
                <Text strong>{message.from.name ?? message.from.email}</Text>
                <Text type="secondary">{relativeTime(message.sent_at)}</Text>
              </span>
            ),
            children: <Message message={message} />,
          }))}
        />
      )}

      {last && (
        <div data-testid="latest-message">
          <Message
            message={last}
            onEditDraft={onEditDraft}
            onDiscardDraft={onDiscardDraft}
          />
        </div>
      )}

      {/* Absent for a draft: the control there is Edit, not Reply. */}
      {last && !last.is_draft && (
        <div className="nu-reader-actions">
          <Button type="primary" onClick={onReply} data-testid="reply">
            Reply
          </Button>
        </div>
      )}
    </article>
  );
}

function Message({
  message,
  onEditDraft,
  onDiscardDraft,
}: {
  message: MailMessage;
  onEditDraft?: (message: MailMessage) => void;
  onDiscardDraft?: (message: MailMessage) => void;
}) {
  return (
    <div className="nu-message">
      <div className="nu-message-head">
        <Space size={8} align="start">
          <Avatar size="small">{message.from.initials}</Avatar>
          <div>
            <Text strong>{message.from.name ?? message.from.email}</Text>
            <Text type="secondary" className="nu-message-addresses">
              {message.from.email}
              {message.to.length > 0 && (
                <> → {message.to.map((person) => person.name || person.email).join(", ")}</>
              )}
              {message.cc.length > 0 && (
                <>
                  {" · cc "}
                  {message.cc.map((person) => person.name || person.email).join(", ")}
                </>
              )}
            </Text>
          </div>
        </Space>

        <Space size={8}>
          {message.priority !== "NORMAL" && (
            <Tag color={message.priority === "HIGH" ? "error" : undefined} bordered={false}>
              {message.priority.toLowerCase()} priority
            </Tag>
          )}
          {message.is_draft ? (
            <Tag color="warning" bordered={false}>
              draft
            </Tag>
          ) : (
            <Tooltip title={absoluteTime(message.sent_at)}>
              <Text type="secondary">{relativeTime(message.sent_at)}</Text>
            </Tooltip>
          )}
        </Space>
      </div>

      {/* Text, never the stored HTML. Rendering a colleague's markup would
          make a mailbox a place to run script in somebody's browser. */}
      <Paragraph className="nu-message-body">{message.body}</Paragraph>

      {message.attachments.length > 0 && (
        <div className="nu-message-files">
          {message.attachments.map((file) => (
            <Tag key={file.id} bordered={false} icon={<PaperClipOutlined />}>
              {file.name} · {readableSize(file.size_bytes)}
            </Tag>
          ))}
        </div>
      )}

      {message.is_draft && onEditDraft && onDiscardDraft && (
        <Space size={8}>
          <Button
            icon={<EditOutlined />}
            onClick={() => onEditDraft(message)}
            data-testid="edit-draft"
          >
            Edit
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => onDiscardDraft(message)}
            data-testid="discard-draft"
          >
            Discard
          </Button>
        </Space>
      )}

      {message.folder === "OUTBOX" && !message.is_draft && (
        <Alert
          type="info"
          showIcon
          message="Written, and waiting for a transport"
          description="This template has no mail transport, so nothing has delivered it. The message is stored exactly as it would be sent."
        />
      )}
    </div>
  );
}
