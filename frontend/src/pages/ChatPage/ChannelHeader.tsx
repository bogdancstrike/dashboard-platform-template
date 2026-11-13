import { Avatar, Button, Popover, Space, Tag, Tooltip, Typography } from "antd";
import {
  ArrowLeftOutlined,
  BellOutlined,
  LockOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useMemo } from "react";

import { type ChannelDetail } from "@/api/chat";
import { PersonAvatar } from "@/components/PersonAvatar";
import { MembersPanel } from "@/components/collab/ChatDialogs";
import { initials } from "@/components/collab/MessageItem";
import { PresenceDot } from "@/components/collab/presence";

const { Text } = Typography;

export function ChannelHeader({
  channel,
  presence,
  phone,
  onBack,
  onJoin,
  onLeave,
  onMute,
  onSettings,
  onChanged,
}: {
  channel?: ChannelDetail;
  presence: Record<string, "online" | "away" | "offline">;
  phone: boolean;
  onBack: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onMute: () => void;
  onSettings: () => void;
  onChanged: () => void;
}) {
  const online = useMemo(
    () => channel?.members.filter((member) => presence[member.id] === "online").length ?? 0,
    [channel, presence],
  );
  if (!channel) return <header className="nx-co-head" />;
  const direct = channel.kind === "DIRECT";
  return (
    <header className="nx-co-head" data-testid="chat-head">
      {phone && <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Back to conversations" onClick={onBack} />}
      <div className="nx-co-head-title">
        <h2>
          {direct ? (
            <span className="nx-co-avatar">
              <PersonAvatar size={28} src={channel.other?.avatar_url} initials={initials(channel.name)} />
              <PresenceDot status={presence[channel.other?.id ?? ""] ?? "offline"} className="nx-co-avatar-dot" />
            </span>
          ) : channel.visibility === "PRIVATE" ? (
            <LockOutlined />
          ) : (
            <span className="nx-co-hash">#</span>
          )}
          <span>{channel.name}</span>
          {channel.muted && <Tag bordered={false}>muted</Tag>}
        </h2>
        <Text type="secondary" className="nx-co-head-topic">
          {direct ? (presence[channel.other?.id ?? ""] === "online" ? "Online now" : channel.other?.job_title ?? "Direct message") : channel.topic || `${channel.member_count} members`}
        </Text>
      </div>
      <Space size={4} className="nx-co-head-actions">
        {!direct && (
          <Popover
            trigger="click"
            placement="bottomRight"
            title={`${channel.member_count} members · ${online} online`}
            content={<MembersPanel channel={channel} presence={presence} onChanged={onChanged} />}
          >
            <button type="button" className="nx-co-faces" aria-label="Members" data-testid="chat-members">
              <Avatar.Group size={24} max={{ count: 4 }}>
                {channel.members.slice(0, 5).map((member) => (
                  <PersonAvatar key={member.id} size={24} src={member.avatar_url} initials={initials(member.name)} />
                ))}
              </Avatar.Group>
              <span className="nx-co-online">
                <TeamOutlined /> {channel.member_count}
              </span>
            </button>
          </Popover>
        )}
        {channel.is_member && !direct && (
          <Tooltip title={channel.muted ? "Unmute" : "Mute"}>
            <Button type="text" className="nx-co-hide-phone" icon={<BellOutlined />} aria-label={channel.muted ? "Unmute" : "Mute"} onClick={onMute} />
          </Tooltip>
        )}
        {channel.can_manage && (
          <Tooltip title="Channel settings">
            <Button type="text" icon={<SettingOutlined />} aria-label="Channel settings" onClick={onSettings} />
          </Tooltip>
        )}
        {!direct && !channel.is_member && channel.visibility === "PUBLIC" && (
          <Button type="primary" onClick={onJoin}>
            Join
          </Button>
        )}
        {!direct && channel.is_member && (
          <Button className="nx-co-hide-phone" onClick={onLeave} data-testid="leave-channel">
            Leave
          </Button>
        )}
      </Space>
    </header>
  );
}
