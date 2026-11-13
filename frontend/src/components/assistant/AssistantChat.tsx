/**
 * One conversation with the assistant: the messages, a General / Data toggle,
 * and a composer that streams the answer in as it is written (§41).
 *
 * Used twice — as the body of `/assistant` and inside the side panel the
 * launcher opens on every page — so it owns everything about a conversation
 * and nothing about where it sits. With no conversation yet, the first message
 * creates one (in the mode showing on the toggle) and reports its id upward.
 *
 * Stop aborts the request; the server saves what had been written, marked as
 * stopped. Regenerate asks the last question again and replaces the answer.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Segmented, Skeleton, Tooltip } from "antd";
import { Link } from "react-router-dom";

import {
  assistantApi,
  streamTurn,
  type AssistantMessage,
  type AssistantMode,
  type AssistantSources,
  type Citation,
  type TurnEvent,
} from "@/api/assistant";
import { ApiError } from "@/api/client";

import { AstIcon as AiIcon } from "@/components/icons/AstIcon";
import { Markdown } from "./Markdown";
import { DEFAULT_SOURCES, SourcePicker } from "./SourcePicker";
import "@/styles/assistant.css";
import { queryKeys } from "@/lib/queryKeys";

const SUGGESTIONS: Record<AssistantMode, string[]> = {
  general: [
    "Draft a polite reminder to a customer about an unpaid invoice",
    "Explain the difference between a saved search and a report",
    "Summarise good practice for writing a ticket",
  ],
  data: [
    "How many open tickets are there, by priority?",
    "Which of my tasks are overdue?",
    "Which customers have the highest lifetime value?",
  ],
};

interface Live {
  text: string;
  steps: { name: string; status: string; summary?: string }[];
  question: string;
}

export interface AssistantChatProps {
  conversationId: string | null;
  /** A conversation was created (the first message of a new chat). */
  onConversationChange?: (id: string) => void;
  compact?: boolean;
  /** Called when a link in an answer is followed — the panel closes itself. */
  onNavigate?: () => void;
  /** The mode a brand-new conversation starts in. */
  initialMode?: AssistantMode;
}

export function AssistantChat({ conversationId, onConversationChange, compact, onNavigate, initialMode = "general" }: AssistantChatProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [newMode, setNewMode] = useState<AssistantMode>(initialMode);
  const [newSources, setNewSources] = useState<AssistantSources>(DEFAULT_SOURCES);
  const [live, setLive] = useState<Live | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const conversation = useQuery({
    queryKey: queryKeys.assistantConversation(conversationId),
    queryFn: ({ signal }) => assistantApi.get(conversationId!, signal),
    enabled: Boolean(conversationId),
  });

  const mode: AssistantMode = conversation.data?.mode ?? newMode;
  const sources: AssistantSources = conversation.data?.sources ?? newSources;
  const messages = conversation.data?.messages ?? [];
  const streaming = live !== null;

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom has no scrollIntoView
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, live?.text, live?.steps.length]);

  useEffect(() => () => abort.current?.abort(), []);

  const refresh = async (id: string) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversation(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations() });
  };

  const changeMode = async (next: AssistantMode) => {
    if (!conversationId) {
      setNewMode(next);
      return;
    }
    queryClient.setQueryData(queryKeys.assistantConversation(conversationId), { ...conversation.data, mode: next });
    await assistantApi.update(conversationId, { mode: next });
    await refresh(conversationId);
  };

  const changeSources = async (next: AssistantSources) => {
    if (!conversationId) {
      setNewSources(next);
      return;
    }
    queryClient.setQueryData(queryKeys.assistantConversation(conversationId), { ...conversation.data, sources: next });
    try {
      await assistantApi.update(conversationId, { sources: next });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Those sources could not be used.");
    }
    await refresh(conversationId);
  };

  const run = async (body: { content?: string; regenerate?: boolean }, question: string) => {
    setFailure(null);
    let id = conversationId;
    // A new conversation is announced only once its first answer is in: the
    // parent moves to its address, which remounts this chat, and a remount
    // mid-stream would stop the answer it is waiting for.
    let createdId: string | null = null;
    try {
      if (!id) {
        const created = await assistantApi.create(mode === "data" ? { mode, sources } : { mode });
        id = created.id;
        queryClient.setQueryData(queryKeys.assistantConversation(id), created);
        createdId = id;
      }
      const controller = new AbortController();
      abort.current = controller;
      setLive({ text: "", steps: [], question });
      const onEvent = (event: TurnEvent) => {
        if (event.type === "delta") setLive((cur) => (cur ? { ...cur, text: cur.text + event.text } : cur));
        else if (event.type === "tool")
          setLive((cur) => {
            if (!cur) return cur;
            const steps = event.status === "done"
              ? cur.steps.map((s, n) => (n === cur.steps.length - 1 && s.name === event.name ? { ...s, status: "done", summary: event.summary } : s))
              : [...cur.steps, { name: event.name, status: "running" }];
            return { ...cur, steps };
          });
        else if (event.type === "error") setFailure(event.message);
      };
      await streamTurn(id, { ...body, mode }, onEvent, controller.signal);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setFailure(error instanceof ApiError || error instanceof Error ? error.message : "The assistant could not answer.");
      }
    } finally {
      abort.current = null;
      if (id) await refresh(id);
      setLive(null);
      if (createdId) onConversationChange?.(createdId);
    }
  };

  const send = (text = draft) => {
    const content = text.trim();
    if (!content || streaming) return;
    setDraft("");
    void run({ content }, content);
  };

  const stop = () => abort.current?.abort();
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("Copied");
    } catch {
      message.error("Could not copy");
    }
  };

  return (
    <div className={`nx-ai-chat${compact ? " nx-ai-chat--compact" : ""}`} data-testid="assistant-chat">
      <div className="nx-ai-chat-bar">
        <Segmented<AssistantMode>
          size={compact ? "small" : "middle"}
          value={mode}
          onChange={(value) => void changeMode(value)}
          disabled={streaming}
          data-testid="assistant-mode"
          aria-label="Assistant mode"
          options={[
            { value: "general", label: <span className="nx-ai-seg"><AiIcon name="chat" size={14} /> General</span> },
            { value: "data", label: <span className="nx-ai-seg"><AiIcon name="data" size={14} /> Data</span> },
          ]}
        />
        {mode === "data" ? (
          <SourcePicker value={sources} onChange={(next) => void changeSources(next)} disabled={streaming} compact={compact} />
        ) : (
          <span className="nx-ai-chat-hint">A general assistant — no access to your records</span>
        )}
      </div>

      <div className="nx-ai-thread" aria-live="polite">
        {conversation.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}
        {!conversation.isLoading && messages.length === 0 && !live && (
          <div className="nx-ai-empty" data-testid="assistant-empty">
            <span className="nx-ai-empty-mark"><AiIcon name="spark" size={22} /></span>
            <b>{mode === "data" ? "Ask about your data" : "How can I help?"}</b>
            <p>{mode === "data" ? (sources.collections.length ? "Answers cite the records and the document pages they used." : "Answers cite the records they used, with links.") : "Switch to Data to ask about your records."}</p>
            <div className="nx-ai-suggest">
              {SUGGESTIONS[mode].map((text) => (
                <button key={text} type="button" className="nx-ai-chip" onClick={() => send(text)}>
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onNavigate={onNavigate}
            onCopy={() => void copy(m.content)}
            onRegenerate={m.id === lastAssistant?.id && !streaming ? () => void run({ regenerate: true }, "") : undefined}
          />
        ))}
        {live && (
          <>
            {live.question && (
              <div className="nx-ai-msg nx-ai-msg--user"><div className="nx-ai-bubble">{live.question}</div></div>
            )}
            <div className="nx-ai-msg nx-ai-msg--assistant" data-testid="assistant-live">
              <span className="nx-ai-avatar"><AiIcon name="spark" size={14} /></span>
              <div className="nx-ai-bubble">
                {live.steps.map((s, n) => (
                  <div key={n} className="nx-ai-step">
                    <AiIcon name={s.status === "done" ? "check" : "tool"} size={13} />
                    {s.summary ?? `Looking up ${s.name.replace(/_/g, " ")}…`}
                  </div>
                ))}
                {live.text ? <Markdown text={live.text} onNavigate={onNavigate} /> : <span className="nx-ai-typing"><i /><i /><i /></span>}
              </div>
            </div>
          </>
        )}
        {failure && <Alert type="error" showIcon message={failure} className="nx-ai-failure" />}
        <div ref={bottom} />
      </div>

      <form
        className="nx-ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Input.TextArea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={mode === "data" ? (sources.collections.length ? (sources.records ? "Ask about your records and documents…" : "Ask about your documents…") : "Ask about your records…") : "Message the assistant…"}
          autoSize={{ minRows: 1, maxRows: compact ? 4 : 8 }}
          aria-label="Message"
          data-testid="assistant-input"
          maxLength={8000}
        />
        {streaming ? (
          <Tooltip title="Stop — what was written so far is kept">
            <Button shape="circle" onClick={stop} aria-label="Stop" data-testid="assistant-stop" icon={<AiIcon name="stop" />} />
          </Tooltip>
        ) : (
          <Button
            type="primary"
            shape="circle"
            htmlType="submit"
            aria-label="Send"
            data-testid="assistant-send"
            disabled={!draft.trim()}
            icon={<AiIcon name="send" />}
          />
        )}
      </form>
    </div>
  );
}

function CitationChips({ citations, onNavigate }: { citations: Citation[]; onNavigate?: () => void }) {
  if (!citations.length) return null;
  return (
    <div className="nx-ai-cites" data-testid="assistant-citations">
      <span className="nx-ai-cites-label">Sources</span>
      {citations.map((c) => (
        <Link key={`${c.resource_type}:${c.id}`} to={c.path} onClick={onNavigate} className="nx-ai-cite" title={c.dataset}>
          {c.label}
        </Link>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  onNavigate,
  onCopy,
  onRegenerate,
}: {
  message: AssistantMessage;
  onNavigate?: () => void;
  onCopy: () => void;
  onRegenerate?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="nx-ai-msg nx-ai-msg--user" data-testid="assistant-message-user">
        <div className="nx-ai-bubble">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="nx-ai-msg nx-ai-msg--assistant" data-testid="assistant-message">
      <span className="nx-ai-avatar"><AiIcon name="spark" size={14} /></span>
      <div className="nx-ai-bubble">
        {message.steps.length > 0 && (
          <details className="nx-ai-steps">
            <summary>
              <AiIcon name="tool" size={13} /> Used {message.steps.length} lookup{message.steps.length === 1 ? "" : "s"}
            </summary>
            {message.steps.map((s, n) => (
              <div key={n} className="nx-ai-step"><AiIcon name="check" size={13} /> {s.summary}</div>
            ))}
          </details>
        )}
        {message.content ? <Markdown text={message.content} onNavigate={onNavigate} /> : <p className="nx-ai-muted">(no answer)</p>}
        {message.status === "stopped" && <p className="nx-ai-muted">Stopped.</p>}
        {message.status === "error" && <Alert type="error" showIcon message={message.error ?? "The assistant could not answer."} />}
        <CitationChips citations={message.citations} onNavigate={onNavigate} />
        <div className="nx-ai-actions">
          <Tooltip title="Copy">
            <button type="button" className="nx-ai-iconbtn" aria-label="Copy answer" onClick={onCopy}>
              <AiIcon name="copy" size={14} />
            </button>
          </Tooltip>
          {onRegenerate && (
            <Tooltip title="Answer again">
              <button type="button" className="nx-ai-iconbtn" aria-label="Regenerate" data-testid="assistant-regenerate" onClick={onRegenerate}>
                <AiIcon name="retry" size={14} />
              </button>
            </Tooltip>
          )}
          {message.usage.total_tokens > 0 && (
            <span className="nx-ai-usage" title={`${message.usage.prompt_tokens} in · ${message.usage.completion_tokens} out`}>
              {message.usage.total_tokens.toLocaleString()} tokens
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
