import { Alert, Button, Typography } from "antd";

import { CHAT_RESOURCE } from "@/api/chat";
import type { RecordComment } from "@/api/comments";
import { EmptyState } from "@/components/EmptyState";
import { ConversationView } from "@/components/collab/ConversationView";
import "@/styles/collab.css";

import { ChannelHeader } from "./ChannelHeader";
import type { ChatPageModel } from "./useChatPage";

const { Text } = Typography;

/** The open conversation — or why it cannot be shown, or the invitation to pick one. */
export function ChatPane({ m }: { m: ChatPageModel }) {
  const { channelId, navigate, back, phone, thread, highlight, setSettings, presence, channel, detail, refreshChannel, join, leave, mute } = m;
  return channelId ? (
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
}
