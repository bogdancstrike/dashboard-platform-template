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
import { Alert, App, Button, Input, Segmented, Skeleton, Tooltip } from "antd";

import type { AssistantMode } from "@/api/assistant";
import { AstIcon as AiIcon } from "@/components/icons/AstIcon";
import "@/styles/assistant.css";

import { EmptyThread } from "./chat/EmptyThread";
import { LiveAnswer } from "./chat/LiveAnswer";
import { MessageBubble } from "./chat/MessageBubble";
import { useAssistantChat } from "./chat/useAssistantChat";
import { SourcePicker } from "./SourcePicker";

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
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const { conversation, mode, sources, messages, streaming, live, failure, changeMode, changeSources, run, stop } =
    useAssistantChat(conversationId, initialMode, onConversationChange);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom has no scrollIntoView
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, live?.text, live?.steps.length]);

  const send = (text = draft) => {
    const content = text.trim();
    if (!content || streaming) return;
    setDraft("");
    void run({ content }, content);
  };

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
          <EmptyThread mode={mode} sources={sources} onAsk={send} />
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
          <LiveAnswer live={live} onNavigate={onNavigate} />
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
