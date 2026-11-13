import { Avatar, Button, Card, Tag, Tooltip, Typography } from "antd";
import { CheckCircleOutlined, PushpinFilled } from "@ant-design/icons";
import { Link } from "react-router-dom";

import type { Announcement } from "@/api/announcements";
import { absoluteTime, relativeTime } from "@/lib/time";

import { SEVERITY_COLOUR } from "../model";

const { Paragraph, Text, Title } = Typography;

/**
 * One notice, as prose.
 *
 * Not a table row: what a maintenance notice *says* is the reason somebody
 * opened the page, and a title truncated into a column with the body behind a
 * click is a page that has hidden its content.
 */
export function Notice({
  notice,
  acknowledging,
  onAcknowledge,
}: {
  notice: Announcement;
  acknowledging: boolean;
  onAcknowledge: () => void;
}) {
  const needsAgreement = notice.requires_acknowledgement && notice.acknowledged_at === null;

  return (
    <Card
      size="small"
      className={`nu-announce nu-announce--${notice.severity.toLowerCase()}${
        notice.read_at === null ? " is-unread" : ""
      }${notice.is_pinned ? " nx-ov-pinned" : ""}`}
      data-testid="announcement"
    >
      {/* Compact: one heading line with the notice's kind and age, two lines
          of what it says (expandable), and one line of facts. A noticeboard
          where each notice is a screen tall is one nobody reads to the end. */}
      <div className="nx-ov-notice">
        <div className="nx-ov-notice-head">
          <Tag color={SEVERITY_COLOUR[notice.severity]} bordered={false}>
            {notice.severity}
          </Tag>
          <Title level={4} className="nu-announce-title">
            {notice.is_pinned && (
              <Tooltip title="Pinned to the top of the board">
                <PushpinFilled className="nu-announce-pin" aria-label="Pinned" />
              </Tooltip>
            )}
            {notice.title}
          </Title>
          <Tooltip title={absoluteTime(notice.publish_at ?? notice.created_at)}>
            <Text type="secondary" className="nu-announce-when">
              {relativeTime(notice.publish_at ?? notice.created_at)}
            </Text>
          </Tooltip>
        </div>
        <Paragraph
          className="nu-announce-body"
          ellipsis={{
            rows: notice.is_pinned ? 3 : 2,
            expandable: "collapsible",
            symbol: (open) => (open ? "Less" : "More"),
          }}
        >
          {notice.body}
        </Paragraph>

        <div className="nx-ov-notice-foot">
          <span className="nx-ov-notice-facts">
            <span>{notice.category_label}</span>
            {notice.is_expired && <span>Expired</span>}
            {notice.expires_at && (
              <Tooltip title={absoluteTime(notice.expires_at)}>
                <span>
                  {notice.is_expired ? "Ran out" : "Until"} {relativeTime(notice.expires_at)}
                </span>
              </Tooltip>
            )}
            <span>
              {notice.audience_roles.length === 0 ? (
                "Everybody"
              ) : (
                <Tooltip title={notice.audience_roles.join(", ")}>
                  <span>{notice.audience_roles.length} roles</span>
                </Tooltip>
              )}
            </span>
            {notice.author.name && (
              <span className="nu-announce-author">
                <Avatar size={18} className="nu-announce-avatar">
                  {notice.author.initials}
                </Avatar>
                {notice.author.name}
              </span>
            )}
          </span>
          <span className="nu-announce-actions">
            {notice.link && <Link to={notice.link}>Open what this is about</Link>}
            {/* Agreeing is a decision, so it is a button — and it says what it
                commits the reader to rather than "OK". */}
            {needsAgreement && (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={acknowledging}
                onClick={onAcknowledge}
                data-testid="acknowledge"
              >
                I have read and understood this
              </Button>
            )}
            {notice.requires_acknowledgement && notice.acknowledged_at !== null && (
              <Tooltip title={absoluteTime(notice.acknowledged_at)}>
                <Tag color="success" bordered={false} icon={<CheckCircleOutlined />}>
                  Acknowledged
                </Tag>
              </Tooltip>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}
