/**
 * The list of conversations (§47): channels, then direct messages, each with
 * its unread count — and, while somebody is searching, the messages that
 * matched instead.
 */

import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Empty, Input, Skeleton, Tooltip } from "antd";
import { LockOutlined, PlusOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";

import { chatApi, type ChannelSummary, type PresenceStatus } from "@/api/chat";
import { PersonAvatar } from "@/components/PersonAvatar";
import { HighlightedText } from "@/components/HighlightedText";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relativeTime } from "@/lib/time";

import { initials } from "./MessageItem";
import { PresenceDot } from "./presence";

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

export function ChannelRail({
  channels,
  loading,
  activeId,
  presence,
  query,
  onQuery,
  onOpen,
  onOpenHit,
  onNewChannel,
  onNewDirect,
}: {
  channels: ChannelSummary[];
  loading: boolean;
  activeId?: string;
  presence: Record<string, PresenceStatus>;
  query: string;
  onQuery: (value: string) => void;
  onOpen: (id: string) => void;
  onOpenHit: (channelId: string, messageId: string, parentId: string | null) => void;
  onNewChannel?: () => void;
  onNewDirect?: () => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const term = useDebouncedValue(query.trim(), 250);
  const hits = useQuery({
    queryKey: ["chat-search", term],
    queryFn: ({ signal }) => chatApi.search(term, signal),
    enabled: term.length >= 2,
  });

  const { joined, others, directs } = useMemo(
    () => ({
      joined: channels.filter((item) => item.kind === "CHANNEL" && item.is_member),
      others: channels.filter((item) => item.kind === "CHANNEL" && !item.is_member),
      directs: channels.filter((item) => item.kind === "DIRECT"),
    }),
    [channels],
  );

  const row = (channel: ChannelSummary) => (
    <ChannelRow
      key={channel.id}
      channel={channel}
      active={channel.id === activeId}
      presence={channel.other ? presence[channel.other.id] : undefined}
      onOpen={() => onOpen(channel.id)}
    />
  );

  return (
    <nav className="nx-co-rail" aria-label="Conversations" data-testid="chat-rail">
      <div className="nx-co-rail-search">
        <Input.Search
          allowClear
          value={query}
          placeholder="Search messages"
          aria-label="Search messages"
          onChange={(event) => onQuery(event.target.value)}
          data-testid="chat-search"
        />
      </div>

      {term.length >= 2 ? (
        <div className="nx-co-rail-scroll" data-testid="chat-search-results">
          {hits.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (hits.data?.items ?? []).length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`Nothing says “${term}”`} />
          ) : (
            <ul className="nx-co-hits">
              {hits.data!.items.map((hit) => (
                <li key={hit.id}>
                  <button type="button" onClick={() => onOpenHit(hit.channel_id, hit.id, hit.parent_id)}>
                    <span className="nx-co-hit-where">
                      {hit.channel_kind === "DIRECT" ? hit.channel_name : `#${hit.channel_name}`} · {hit.author} ·{" "}
                      {relativeTime(hit.created_at)}
                    </span>
                    <span className="nx-co-hit-body">
                      <HighlightedText text={hit.body} term={term} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="nx-co-rail-scroll">
          {loading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : (
            <>
              <div className="nx-co-rail-head">
                <span>Channels</span>
                {onNewChannel && (
                  <Tooltip title="New channel">
                    <Button
                      size="small"
                      type="text"
                      icon={<PlusOutlined />}
                      aria-label="New channel"
                      onClick={onNewChannel}
                      data-testid="new-channel"
                    />
                  </Tooltip>
                )}
              </div>
              <ul className="nx-co-rows">{joined.map(row)}</ul>
              {others.length > 0 && (
                <>
                  <button type="button" className="nx-co-more" onClick={() => setBrowsing((value) => !value)}>
                    {browsing ? "Hide" : "Browse"} {others.length} more channel{others.length === 1 ? "" : "s"}
                  </button>
                  {browsing && <ul className="nx-co-rows is-browse">{others.map(row)}</ul>}
                </>
              )}
              <div className="nx-co-rail-head">
                <span>Direct messages</span>
                {onNewDirect && (
                  <Tooltip title="New message">
                    <Button
                      size="small"
                      type="text"
                      icon={<PlusOutlined />}
                      aria-label="New direct message"
                      onClick={onNewDirect}
                      data-testid="new-direct"
                    />
                  </Tooltip>
                )}
              </div>
              <ul className="nx-co-rows">{directs.map(row)}</ul>
              {directs.length === 0 && <p className="nx-co-muted nx-co-pad">No direct messages yet.</p>}
            </>
          )}
        </div>
      )}
    </nav>
  );
}
