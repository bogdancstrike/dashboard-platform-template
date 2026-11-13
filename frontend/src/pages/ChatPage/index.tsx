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

import { Button, Card, Drawer, Space } from "antd";

import { URL_OVERLAY } from "@/app/history";
import { PageHeader } from "@/components/PageHeader";
import { ChannelRail } from "@/components/collab/ChannelRail";
import { ChannelSettingsModal, NewChannelModal, NewDirectModal } from "@/components/collab/ChatDialogs";
import "@/styles/collab.css";
import { queryKeys } from "@/lib/queryKeys";

import { ThreadPanel } from "./ThreadPanel";

import { ChatPane } from "./ChatPane";
import { useChatPage } from "./useChatPage";

export default function ChatPage() {
  const m = useChatPage();
  const { channelId, navigate, queryClient, phone, wide, thread, query, creating, setCreating, directing, setDirecting, settings, setSettings, presence, channels, open, setQuery, detail, refreshChannel } = m;

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

  const pane = <ChatPane m={m} />;

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
