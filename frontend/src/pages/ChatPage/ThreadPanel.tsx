import { useQueryClient } from "@tanstack/react-query";
import { Button, Typography } from "antd";

import { CHAT_RESOURCE, type ChannelDetail } from "@/api/chat";
import type { RecordComment } from "@/api/comments";
import { ConversationView } from "@/components/collab/ConversationView";
import { MessageItem } from "@/components/collab/MessageItem";
import { conversationKey } from "@/components/collab/useConversation";

const { Text } = Typography;

export function ThreadPanel({
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
