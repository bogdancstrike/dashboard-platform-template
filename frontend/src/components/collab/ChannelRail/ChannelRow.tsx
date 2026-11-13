import { Badge } from "antd";
import { LockOutlined } from "@ant-design/icons";

import { type ChannelSummary, type PresenceStatus } from "@/api/chat";
import { PersonAvatar } from "@/components/PersonAvatar";
import { relativeTime } from "@/lib/time";

import { initials } from "../MessageItem";
import { PresenceDot } from "../presence";

export function ChannelRow({
  channel,
  active,
  presence,
  onOpen,
}: {
  channel: ChannelSummary;
  active: boolean;
  presence?: PresenceStatus;
  onOpen: () => void;
}) {
  const unread = channel.unread > 0 && !channel.muted;
  return (
    <li>
      <button
        type="button"
        className={`nx-co-row${active ? " is-on" : ""}${unread ? " is-unread" : ""}`}
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        data-testid={`channel-${channel.kind === "DIRECT" ? "dm" : channel.name}`}
      >
        <span className="nx-co-row-icon">
          {channel.kind === "DIRECT" ? (
            <span className="nx-co-avatar">
              <PersonAvatar size={26} src={channel.other?.avatar_url} initials={initials(channel.name)} />
              <PresenceDot status={presence ?? "offline"} className="nx-co-avatar-dot" />
            </span>
          ) : channel.visibility === "PRIVATE" ? (
            <LockOutlined />
          ) : (
            <span className="nx-co-hash">#</span>
          )}
        </span>
        <span className="nx-co-row-text">
          <span className="nx-co-row-name">{channel.name}</span>
          {channel.last_message && (
            <span className="nx-co-row-last">
              {channel.kind === "CHANNEL" ? `${channel.last_message.author.split(" ")[0]}: ` : ""}
              {channel.last_message.body}
            </span>
          )}
        </span>
        <span className="nx-co-row-meta">
          {channel.last_message_at && <span className="nx-co-muted">{relativeTime(channel.last_message_at)}</span>}
          {unread && (
            <Badge
              count={channel.mentions > 0 ? `@${channel.unread}` : channel.unread}
              className={channel.mentions > 0 ? "nx-co-badge is-mention" : "nx-co-badge"}
              aria-label={`${channel.unread} unread`}
            />
          )}
        </span>
      </button>
    </li>
  );
}
