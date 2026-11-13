/**
 * `/assistant` — the chatbot, with the history of past conversations (§41).
 *
 * The conversation open is a *place*, so it lives in the path
 * (`/assistant/<id>`) and is pushed: back walks to the previous one. The rail
 * search is a filter on the list, so it is local state. On a phone the rail
 * and the chat are one column each — the list until a conversation is chosen,
 * then the chat with a way back to the list.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Grid, Input, Skeleton } from "antd";
import { useNavigate, useParams } from "react-router-dom";

import { assistantApi, type Conversation } from "@/api/assistant";
import { useSmartBack } from "@/app/history";
import { usePageCommands } from "@/commands/CommandContext";
import { AstIcon as AiIcon } from "@/components/icons/AstIcon";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { NameModal } from "@/components/NameModal";
import { PageHeader } from "@/components/PageHeader";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relativeTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

export default function AssistantPage() {
  const { conversationId = null } = useParams();
  const navigate = useNavigate();
  const back = useSmartBack();
  const queryClient = useQueryClient();
  const { modal, message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const phone = !screens.md;
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const q = useDebouncedValue(search.trim(), 250);

  const list = useQuery({
    queryKey: queryKeys.assistantConversations(q),
    queryFn: ({ signal }) => assistantApi.conversations(q, signal),
  });
  const usage = useQuery({ queryKey: queryKeys.assistantUsage(), queryFn: ({ signal }) => assistantApi.usage(signal) });

  const open = (id: string | null) => navigate(id ? `/assistant/${id}` : "/assistant");
  const items = useMemo(() => list.data?.items ?? [], [list.data]);

  usePageCommands("assistant", [
    { id: "assistant.new", label: "Start a new conversation with the assistant", keywords: "ai chat new ask", run: () => open(null) },
  ]);

  const rename = async (convo: Conversation, title: string) => {
    await assistantApi.update(convo.id, { title });
    setRenaming(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversation(convo.id) });
  };

  const remove = (convo: Conversation) =>
    modal.confirm({
      title: `Delete “${convo.title}”?`,
      content: "The conversation and every answer in it are removed for good.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        await assistantApi.remove(convo.id);
        message.success("Conversation deleted");
        if (convo.id === conversationId) navigate("/assistant", { replace: true });
        await queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations() });
      },
    });

  const rail = (
    <aside className="nx-ai-rail nx-glass" data-testid="assistant-rail" aria-label="Conversations">
      <div className="nx-ai-rail-head">
        <Button type="primary" block icon={<AiIcon name="plus" />} onClick={() => open(null)} data-testid="assistant-new">
          New conversation
        </Button>
        <Input.Search
          allowClear
          placeholder="Search conversations"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search conversations"
          data-testid="assistant-search"
        />
      </div>
      <div className="nx-ai-rail-list">
        {list.isLoading && <Skeleton active paragraph={{ rows: 6 }} title={false} />}
        {!list.isLoading && items.length === 0 && (
          <p className="nx-ai-muted nx-ai-rail-empty">{q ? "No conversation matches." : "No conversations yet."}</p>
        )}
        {items.map((convo) => (
          <div
            key={convo.id}
            className={`nx-ai-rail-item${convo.id === conversationId ? " is-active" : ""}`}
            data-testid="assistant-conversation"
          >
            <button type="button" className="nx-ai-rail-open" onClick={() => open(convo.id)}>
              <span className="nx-ai-rail-title">{convo.title}</span>
              <span className="nx-ai-rail-meta">
                <span className={`nx-ai-modetag nx-ai-modetag--${convo.mode}`}>{convo.mode === "data" ? "Data" : "General"}</span>
                {relativeTime(convo.last_message_at ?? convo.created_at)}
              </span>
            </button>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "rename", label: "Rename", icon: <AiIcon name="pen" size={14} /> },
                  { key: "delete", label: "Delete", danger: true, icon: <AiIcon name="trash" size={14} /> },
                ],
                onClick: ({ key }) => {
                  if (key === "rename") setRenaming(convo);
                  else remove(convo);
                },
              }}
            >
              <button type="button" className="nx-ai-iconbtn" aria-label={`Actions for ${convo.title}`}>
                ⋯
              </button>
            </Dropdown>
          </div>
        ))}
      </div>
      {usage.data && (
        <div className="nx-ai-rail-foot" data-testid="assistant-usage">
          {usage.data.tokens.toLocaleString()} tokens in 30 days · {usage.data.real ? usage.data.model : "offline model"}
        </div>
      )}
    </aside>
  );

  const showRail = !phone || !conversationId;
  const showChat = !phone || Boolean(conversationId) || items.length === 0;

  return (
    <div className="nx-ai-page" data-testid="assistant-page">
      <PageHeader
        title={<span>Ask <em>Nucleus</em></span>}
        subtitle="A general assistant, or — in Data mode — one that reads your records and cites them."
        onBack={phone && conversationId ? () => back("/assistant") : undefined}
      />
      <div className="nx-ai-layout">
        {showRail && rail}
        {showChat && (
          <section className="nx-ai-main nx-glass" aria-label="Conversation">
            <AssistantChat
              key={conversationId ?? "new"}
              conversationId={conversationId}
              onConversationChange={(id) => navigate(`/assistant/${id}`, { replace: true })}
            />
          </section>
        )}
      </div>
      <NameModal
        open={Boolean(renaming)}
        title="Rename conversation"
        label="Title"
        initial={renaming?.title ?? ""}
        okText="Rename"
        onClose={() => setRenaming(null)}
        onSubmit={(title) => renaming && void rename(renaming, title)}
      />
    </div>
  );
}
