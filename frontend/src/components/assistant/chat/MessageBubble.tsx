import { Alert, Tooltip } from "antd";
import { Link } from "react-router-dom";

import type { AssistantMessage, Citation } from "@/api/assistant";
import { AstIcon as AiIcon } from "@/components/icons/AstIcon";

import { Markdown } from "../Markdown";

function CitationChips({
  citations,
  onNavigate,
}: {
  citations: Citation[];
  onNavigate?: () => void;
}) {
  if (!citations.length) return null;
  return (
    <div className="nx-ai-cites" data-testid="assistant-citations">
      <span className="nx-ai-cites-label">Sources</span>
      {citations.map((c) => (
        <Link
          key={`${c.resource_type}:${c.id}`}
          to={c.path}
          onClick={onNavigate}
          className="nx-ai-cite"
          title={c.dataset}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}

export function MessageBubble({
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
      <span className="nx-ai-avatar">
        <AiIcon name="spark" size={14} />
      </span>
      <div className="nx-ai-bubble">
        {message.steps.length > 0 && (
          <details className="nx-ai-steps">
            <summary>
              <AiIcon name="tool" size={13} /> Used {message.steps.length} lookup
              {message.steps.length === 1 ? "" : "s"}
            </summary>
            {message.steps.map((s, n) => (
              <div key={n} className="nx-ai-step">
                <AiIcon name="check" size={13} /> {s.summary}
              </div>
            ))}
          </details>
        )}
        {message.content ? (
          <Markdown text={message.content} onNavigate={onNavigate} />
        ) : (
          <p className="nx-ai-muted">(no answer)</p>
        )}
        {message.status === "stopped" && <p className="nx-ai-muted">Stopped.</p>}
        {message.status === "error" && (
          <Alert
            type="error"
            showIcon
            message={message.error ?? "The assistant could not answer."}
          />
        )}
        <CitationChips citations={message.citations} onNavigate={onNavigate} />
        <div className="nx-ai-actions">
          <Tooltip title="Copy">
            <button
              type="button"
              className="nx-ai-iconbtn"
              aria-label="Copy answer"
              onClick={onCopy}
            >
              <AiIcon name="copy" size={14} />
            </button>
          </Tooltip>
          {onRegenerate && (
            <Tooltip title="Answer again">
              <button
                type="button"
                className="nx-ai-iconbtn"
                aria-label="Regenerate"
                data-testid="assistant-regenerate"
                onClick={onRegenerate}
              >
                <AiIcon name="retry" size={14} />
              </button>
            </Tooltip>
          )}
          {message.usage.total_tokens > 0 && (
            <span
              className="nx-ai-usage"
              title={`${message.usage.prompt_tokens} in · ${message.usage.completion_tokens} out`}
            >
              {message.usage.total_tokens.toLocaleString()} tokens
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
