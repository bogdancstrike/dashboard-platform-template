import { Button, Dropdown, Tooltip, Typography } from "antd";
import { DeleteOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";

import type { ThreadSummary } from "@/api/knowledge";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

/** The conversations of a collection: pick one, forget this one, or start anew. */
export function ThreadBar({
  threads,
  threadId,
  onThread,
  onForget,
}: {
  threads: ThreadSummary[];
  threadId: string | null;
  onThread: (threadId: string | null) => void;
  onForget: (threadId: string) => void;
}) {
  return (
    <div className="nx-kn-ask-bar">
      <Dropdown
        trigger={["click"]}
        disabled={!threads.length}
        menu={{
          items: threads.map((thread) => ({
            key: thread.thread_id,
            label: (
              <span className="nx-kn-thread-item">
                <span className="nx-kn-thread-title">{thread.title}</span>
                <Text type="secondary">
                  {thread.turns} question{thread.turns === 1 ? "" : "s"} ·{" "}
                  {relativeTime(thread.updated_at)}
                </Text>
              </span>
            ),
          })),
          onClick: ({ key }) => onThread(key),
        }}
      >
        <Button icon={<HistoryOutlined />} data-testid="ask-threads">
          Conversations{threads.length ? ` · ${threads.length}` : ""}
        </Button>
      </Dropdown>
      <div className="nx-kn-ask-bar-end">
        {threadId && (
          <Tooltip title="Forget this conversation">
            <Button
              shape="circle"
              icon={<DeleteOutlined />}
              aria-label="Forget this conversation"
              onClick={() => onForget(threadId)}
            />
          </Tooltip>
        )}
        <Button
          icon={<PlusOutlined />}
          onClick={() => onThread(null)}
          disabled={!threadId}
          data-testid="ask-new"
        >
          New conversation
        </Button>
      </div>
    </div>
  );
}
