/**
 * The list of conversations (§47): channels, then direct messages, each with
 * its unread count — and, while somebody is searching, the messages that
 * matched instead.
 */

import { useQuery } from "@tanstack/react-query";
import { Button, Input, Skeleton, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";

import { chatApi, type ChannelSummary, type PresenceStatus } from "@/api/chat";
import { HighlightedText } from "@/components/HighlightedText";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relativeTime } from "@/lib/time";

import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

import { ChannelRow } from "./ChannelRow";

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
    queryKey: queryKeys.chatSearch(term),
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
            <EmptyState compact title={`Nothing says “${term}”`} />
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
