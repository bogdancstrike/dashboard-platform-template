/**
 * The list of conversations (§14, §20).
 *
 * Four decisions worth stating.
 *
 * **A row is a conversation, not a message.** The subject once, the people in
 * it, the snippet of the latest one, and a count when there is more than one.
 * A list of messages makes a five-message thread look like five problems.
 *
 * **Unread is weight, not colour.** A bolder row survives a screenshot, a
 * greyscale printer and a reader who cannot separate the two blues (§64) —
 * and the dot beside it is there for the same reason, as a second carrier.
 *
 * **Selection is for the bulk bar and nothing else.** Clicking a row *opens*
 * it; the checkbox selects it. A list where clicking selects and
 * double-clicking opens is a list people fight.
 *
 * **The snippet is the server's.** It is the first 400 characters of the
 * latest message, recomputed whenever the thread changes — not something
 * assembled here from a `messages` array the list does not have.
 */

import { Badge, Checkbox, Space, Tag, Tooltip, Typography } from "antd";
import { PaperClipOutlined, StarFilled, StarOutlined } from "@ant-design/icons";

import type { MailThread } from "@/api/mail";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

/**
 * Who a thread is *with*, as a mail client says it.
 *
 * Pure and exported. The rule is worth stating once and asserting directly:
 * one other person is their name, two or three are their first names, more
 * than that is the first name and a count — and a thread with nobody but the
 * reader in it says so rather than rendering an empty string.
 */
export function withWhom(
  thread: Pick<MailThread, "participants">,
  meEmail: string | null,
): string {
  const others = thread.participants.filter(
    (person) => person.email.toLowerCase() !== (meEmail ?? "").toLowerCase(),
  );
  if (others.length === 0) return "Only you";
  const first = (person: { name: string; email: string }) =>
    (person.name || person.email).split(/\s+/)[0]!;
  if (others.length === 1) return others[0]!.name || others[0]!.email;
  if (others.length <= 3) return others.map(first).join(", ");
  return `${first(others[0]!)} and ${others.length - 1} others`;
}

export function ThreadList({
  items,
  openId,
  selected,
  meEmail,
  onOpen,
  onSelect,
  onStar,
}: {
  items: MailThread[];
  openId: string | null;
  selected: string[];
  meEmail: string | null;
  onOpen: (thread: MailThread) => void;
  onSelect: (ids: string[]) => void;
  onStar: (thread: MailThread) => void;
}) {
  const chosen = new Set(selected);

  const toggle = (id: string) =>
    onSelect(chosen.has(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  return (
    <div className="nu-threadlist" data-testid="thread-list">
      {items.map((thread) => {
        const unread = thread.unread_count > 0;
        return (
          <div
            key={thread.id}
            className={[
              "nu-thread",
              unread ? "nu-thread--unread" : "",
              thread.id === openId ? "nu-thread--open" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid={`thread-${thread.id}`}
          >
            {/* The checkbox selects; the row opens. A list where clicking does
                both is a list people fight. */}
            <Checkbox
              checked={chosen.has(thread.id)}
              onChange={() => toggle(thread.id)}
              aria-label={`Select ${thread.subject}`}
            />

            <Tooltip title={thread.is_starred ? "Remove the star" : "Star it"}>
              <button
                type="button"
                className="nu-thread-star"
                aria-label={`${thread.is_starred ? "Unstar" : "Star"} ${thread.subject}`}
                aria-pressed={thread.is_starred}
                onClick={() => onStar(thread)}
              >
                {thread.is_starred ? <StarFilled className="nu-thread-starred" /> : <StarOutlined />}
              </button>
            </Tooltip>

            <button
              type="button"
              className="nu-thread-open"
              onClick={() => onOpen(thread)}
              data-testid={`open-${thread.id}`}
            >
              <span className="nu-thread-line">
                <span className="nu-thread-who">{withWhom(thread, meEmail)}</span>
                <span className="nu-thread-when">
                  <Tooltip title={absoluteTime(thread.last_message_at)}>
                    <span>{relativeTime(thread.last_message_at)}</span>
                  </Tooltip>
                </span>
              </span>

              <span className="nu-thread-line">
                <span className="nu-thread-subject">
                  {/* A second carrier for unread, so it is not only weight. */}
                  {unread && (
                    <Badge dot aria-label={`${thread.unread_count} unread`} />
                  )}
                  {thread.subject}
                  {thread.message_count > 1 && (
                    <Text type="secondary" className="nu-thread-count">
                      {thread.message_count}
                    </Text>
                  )}
                </span>
                <Space size={4}>
                  {thread.has_draft && (
                    <Tooltip title="There is an unfinished message in this conversation">
                      <Tag color="warning" bordered={false}>
                        draft
                      </Tag>
                    </Tooltip>
                  )}
                  {thread.has_attachments && (
                    <PaperClipOutlined aria-label="Has attachments" />
                  )}
                </Space>
              </span>

              <span className="nu-thread-snippet">{thread.snippet}</span>

              {thread.labels.length > 0 && (
                <span className="nu-thread-labels">
                  {thread.labels.map((label) => (
                    <Tag key={label} bordered={false}>
                      {label}
                    </Tag>
                  ))}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
