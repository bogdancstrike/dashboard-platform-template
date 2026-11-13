import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Button, Popconfirm, Space, Typography } from "antd";
import { useState } from "react";

import { apiMessageToast } from "@/lib/errors";
import { chatApi, type ChannelDetail, type PresenceStatus } from "@/api/chat";
import { PeoplePicker } from "@/components/PeoplePicker";
import { PersonAvatar } from "@/components/PersonAvatar";

import { initials } from "../MessageItem";
import { PresenceDot } from "../presence";

const { Text } = Typography;

export function MembersPanel({
  channel,
  presence,
  onChanged,
}: {
  channel: ChannelDetail;
  presence: Record<string, PresenceStatus>;
  onChanged: () => void;
}) {
  const { message } = AntApp.useApp();
  const [adding, setAdding] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: () => chatApi.addMembers(channel.id, adding),
    onSuccess: () => {
      setAdding([]);
      onChanged();
    },
    onError: apiMessageToast(message, "Those people were not added."),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => chatApi.removeMember(channel.id, userId),
    onSuccess: onChanged,
    onError: apiMessageToast(message, "That person was not removed."),
  });
  const ordered = [...channel.members].sort(
    (a, b) => rank(presence[a.id]) - rank(presence[b.id]) || a.name.localeCompare(b.name),
  );
  return (
    <div className="nx-co-members" data-testid="channel-members">
      <ul>
        {ordered.map((member) => (
          <li key={member.id}>
            <span className="nx-co-avatar">
              <PersonAvatar size={28} src={member.avatar_url} initials={initials(member.name)} />
              <PresenceDot status={presence[member.id] ?? "offline"} className="nx-co-avatar-dot" />
            </span>
            <span className="nx-co-member-name">
              {member.name}
              {member.is_me && <Text type="secondary"> (you)</Text>}
              {member.role === "OWNER" && <Text type="secondary"> · owner</Text>}
            </span>
            {channel.can_manage && !member.is_me && channel.kind === "CHANNEL" && (
              <Popconfirm
                title={`Remove ${member.name} from #${channel.name}?`}
                okText="Remove"
                onConfirm={() => remove.mutate(member.id)}
              >
                <Button type="text" danger>
                  Remove
                </Button>
              </Popconfirm>
            )}
          </li>
        ))}
      </ul>
      {channel.kind === "CHANNEL" && channel.is_member && (
        <Space.Compact className="nu-block">
          <PeoplePicker
            value={adding}
            onChange={(ids) => setAdding(ids)}
            exclude={channel.members.map((member) => member.id)}
            placeholder="Add people…"
            aria-label="Add people"
          />
          <Button type="primary" disabled={adding.length === 0} loading={add.isPending} onClick={() => add.mutate()}>
            Add
          </Button>
        </Space.Compact>
      )}
    </div>
  );
}

export function rank(status?: PresenceStatus): number {
  return status === "online" ? 0 : status === "away" ? 1 : 2;
}
