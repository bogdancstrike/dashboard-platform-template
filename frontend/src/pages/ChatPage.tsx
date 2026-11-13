/**
 * `/chat` — team chat (§47).
 *
 * Four decisions worth stating.
 *
 * **The channel is the address.** `/chat/<id>` is a place, pushed; the search
 * box is a filter, replaced; an open thread is `?thread=<id>`, pushed, so the
 * back button — and a phone's back gesture — closes it before it leaves the
 * channel.
 *
 * **Two panes, then one.** The list and the conversation side by side on a
 * desk; on a phone the list *is* `/chat` and a conversation is the next screen,
 * with back returning to the list.
 *
 * **Everything live is a hint.** A new line, a reaction, somebody typing,
 * somebody coming online — the socket says so and the page re-reads what it
 * shows. Nothing on this screen is a copy the server could disagree with.
 *
 * **Unread is the server's number.** The counts beside each channel and on
 * the menu item are counted in SQL from the reader's marker, which is moved
 * by reading — so two tabs, or a phone and a laptop, agree.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Avatar, Button, Card, Drawer, Grid, Popover, Space, Tag, Tooltip, Typography } from "antd";
import { ArrowLeftOutlined, BellOutlined, LockOutlined, SettingOutlined, TeamOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { CHAT_RESOURCE, chatApi, type ChannelDetail } from "@/api/chat";
import type { RecordComment } from "@/api/comments";
import { URL_OVERLAY, useSmartBack } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import { EmptyState } from "@/components/EmptyState";
import { ChannelRail } from "@/components/collab/ChannelRail";
import { ChannelSettingsModal, MembersPanel, NewChannelModal, NewDirectModal } from "@/components/collab/ChatDialogs";
import { ConversationView } from "@/components/collab/ConversationView";
import { MessageItem, initials } from "@/components/collab/MessageItem";
import { PresenceDot, usePresence } from "@/components/collab/presence";
import { conversationKey } from "@/components/collab/useConversation";
import { useLiveEvents } from "@/live/LiveProvider";
import "@/styles/collab.css";
import { queryKeys } from "@/lib/queryKeys";


const { Text } = Typography;

export default function ChatPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const back = useSmartBack();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const phone = !screens.md;
  const wide = Boolean(screens.xl);
  const [params, setParams] = useSearchParams();
  const thread = useUrlOverlay("thread");
  const query = params.get("q") ?? "";
  const highlight = params.get("m");
  const [creating, setCreating] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [settings, setSettings] = useState(false);
  const presence = usePresence();

  const channels = useQuery({
    queryKey: queryKeys.chatChannels(),
    queryFn: ({ signal }) => chatApi.channels(signal),
  });
  const channel = useQuery({
    queryKey: queryKeys.chatChannel(channelId),
    queryFn: ({ signal }) => chatApi.get(channelId!, signal),
    enabled: Boolean(channelId),
    retry: false,
  });

  // A conversation somewhere else changed: its unread count did too.
  useLiveEvents((event) => {
    if (event.type === "thread" && event["resource_type"] === CHAT_RESOURCE) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
    } else if (event.type === "chat.channel") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
      if (event["channel_id"] === channelId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannel(channelId) });
      }
    }
  });

  // On a desk, `/chat` opens the first conversation rather than an empty pane.
  const first = channels.data?.items.find((item) => item.is_member);
  useEffect(() => {
    if (!channelId && !phone && first) navigate(`/chat/${first.id}`, { replace: true });
  }, [channelId, phone, first, navigate]);

  const open = (id: string) => navigate(`/chat/${id}`);
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    next.delete("m");
    setParams(next, { replace: true });
  };

  usePageCommands("chat", [
    { id: "chat.new-channel", label: "Create a chat channel", keywords: "chat channel new create", run: () => setCreating(true) },
    { id: "chat.direct", label: "Send a direct message", keywords: "chat dm direct message person", run: () => setDirecting(true) },
  ]);

  const detail = channel.data;
  const refreshChannel = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannel(channelId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
  };

  const join = async () => {
    try {
      await chatApi.join(channelId!);
      refreshChannel();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : "You could not join that channel.");
    }
  };
  const leave = async () => {
    try {
      await chatApi.leave(channelId!);
      refreshChannel();
      navigate("/chat");
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : "You could not leave that channel.");
    }
  };
  const mute = async () => {
    if (!detail) return;
    try {
      await chatApi.update(detail.id, { muted: !detail.muted });
      refreshChannel();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : "That was not saved.");
    }
  };

  const rail = (
    <ChannelRail
      channels={channels.data?.items ?? []}
      loading={channels.isLoading}
      activeId={channelId}
      presence={presence}
      query={query}
      onQuery={setQuery}
      onOpen={open}
      onOpenHit={(id, messageId, parentId) => {
        const next = new URLSearchParams();
        next.set("m", messageId);
        if (parentId) next.set("thread", parentId);
        navigate(`/chat/${id}?${next.toString()}`);
      }}
      onNewChannel={channels.data?.can_create ? () => setCreating(true) : undefined}
      onNewDirect={channels.data?.can_create ? () => setDirecting(true) : undefined}
    />
  );

  const pane = channelId ? (
    channel.isError ? (
      <div className="nx-co-pane-empty">
        <Alert
          type="warning"
          showIcon
          message="That conversation does not exist, or you are not in it."
          action={<Button onClick={() => navigate("/chat")}>All conversations</Button>}
        />
      </div>
    ) : (
      <section className="nx-co-pane" aria-label="Conversation" data-testid="chat-pane">
        <ChannelHeader
          channel={detail}
          presence={presence}
          phone={phone}
          onBack={() => back("/chat")}
          onJoin={join}
          onLeave={leave}
          onMute={mute}
          onSettings={() => setSettings(true)}
          onChanged={refreshChannel}
        />
        {detail && (
          <ConversationView
            key={detail.id}
            resourceType={CHAT_RESOURCE}
            resourceId={detail.id}
            presence={presence}
            canPost={detail.can_post && detail.is_member}
            highlight={highlight}
            composerLabel={`Message ${detail.kind === "DIRECT" ? detail.name : `#${detail.name}`}`}
            placeholder={
              detail.kind === "DIRECT"
                ? `Message ${detail.name}`
                : `Message #${detail.name} — **bold**, *italic*, \`code\`, @name`
            }
            emptyTitle={detail.kind === "DIRECT" ? "Say hello" : "Nobody has said anything here yet"}
            onOpenThread={(item: RecordComment) => thread.open(item.id)}
            footer={
              detail.archived ? (
                <Alert type="info" showIcon message="This channel is archived. It can be read but not written in." />
              ) : (
                <div className="nx-co-join">
                  <Text>You are reading #{detail.name}.</Text>
                  <Button type="primary" onClick={() => void join()} data-testid="join-channel">
                    Join channel
                  </Button>
                </div>
              )
            }
          />
        )}
      </section>
    )
  ) : (
    <div className="nx-co-pane-empty">
      <EmptyState title="Pick a conversation" hint="Or start one — a channel for a topic, or a message to one person." />
    </div>
  );

  const threadPanel =
    detail && thread.value ? (
      <ThreadPanel channel={detail} parentId={thread.value} presence={presence} onClose={thread.close} />
    ) : null;

  return (
    <div className={`nx-co-page${phone ? " is-phone" : ""}`}>
      {!(phone && channelId) && (
        <PageHeader
          title={
            <>
              Team <em>chat</em>
            </>
          }
          subtitle="Channels, direct messages and every record's thread — live, with mentions and reactions."
          actions={
            channels.data?.can_create && (
              <Space wrap>
                <Button onClick={() => setDirecting(true)} data-testid="chat-new-direct">
                  New message
                </Button>
                <Button type="primary" onClick={() => setCreating(true)} data-testid="chat-new-channel">
                  New channel
                </Button>
              </Space>
            )
          }
        />
      )}

      {phone ? (
        <Card className="nx-co-shell is-single" styles={{ body: { padding: 0 } }}>
          {channelId ? pane : rail}
        </Card>
      ) : (
        <Card
          className={`nx-co-shell${threadPanel && wide ? " has-thread" : ""}`}
          styles={{ body: { padding: 0 } }}
        >
          {rail}
          {pane}
          {threadPanel && wide && <aside className="nx-co-thread-side">{threadPanel}</aside>}
        </Card>
      )}

      {!wide && (
        <Drawer
          open={Boolean(threadPanel)}
          onClose={thread.close}
          width={phone ? "100%" : 420}
          title="Thread"
          rootClassName={URL_OVERLAY}
          styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
        >
          {threadPanel}
        </Drawer>
      )}

      <NewChannelModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          open(created.id);
        }}
      />
      <NewDirectModal
        open={directing}
        onClose={() => setDirecting(false)}
        onOpened={(created) => {
          setDirecting(false);
          open(created.id);
        }}
      />
      {detail && detail.can_manage && (
        <ChannelSettingsModal
          channel={detail}
          open={settings}
          onClose={() => setSettings(false)}
          onSaved={refreshChannel}
          onArchived={() => {
            setSettings(false);
            void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
            navigate("/chat");
          }}
        />
      )}
    </div>
  );
}

function ChannelHeader({
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

function ThreadPanel({
  channel,
  parentId,
  presence,
  onClose,
}: {
  channel: ChannelDetail;
  parentId: string;
  presence: Record<string, "online" | "away" | "offline">;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // The parent line, from whatever window of the channel is loaded — or, for a
  // line further back than that (a search hit), from its own small read.
  const cached = queryClient
    .getQueriesData<{ items: RecordComment[] }>({ queryKey: conversationKey(CHAT_RESOURCE, channel.id).slice(0, 3) })
    .flatMap(([, data]) => data?.items ?? [])
    .find((item) => item.id === parentId);

  return (
    <div className="nx-co-threadpanel" data-testid="thread-panel">
      <div className="nx-co-threadpanel-head">
        <strong>Thread</strong>
        <Text type="secondary">{channel.kind === "DIRECT" ? channel.name : `#${channel.name}`}</Text>
        <Button type="text" onClick={onClose} aria-label="Close thread">
          Close
        </Button>
      </div>
      <ConversationView
        resourceType={CHAT_RESOURCE}
        resourceId={channel.id}
        parentId={parentId}
        presence={presence}
        canPost={channel.can_post && channel.is_member}
        composerLabel="Reply in thread"
        placeholder="Reply…"
        emptyTitle="No replies yet"
        head={
          cached ? (
            <div className="nx-co-thread-parent">
              <MessageItem
                comment={{ ...cached, reply_count: 0, can_edit: false }}
                offered={[]}
                canWrite={false}
                editing={false}
                saving={false}
                presence={presence[cached.author.id]}
                onEditStart={() => undefined}
                onEditCancel={() => undefined}
                onEditSave={() => Promise.resolve()}
                onDelete={() => undefined}
                onReact={() => undefined}
              />
              <div className="nx-co-day">
                <span>Replies</span>
              </div>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
