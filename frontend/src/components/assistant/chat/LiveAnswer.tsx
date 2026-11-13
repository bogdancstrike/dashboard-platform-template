import { AstIcon as AiIcon } from "@/components/icons/AstIcon";

import { Markdown } from "../Markdown";
import type { Live } from "./useAssistantChat";

/** The answer being written: the question, the tools it is using, the text so far. */
export function LiveAnswer({ live, onNavigate }: { live: Live; onNavigate?: () => void }) {
  return (
    <>
      {live.question && (
        <div className="nx-ai-msg nx-ai-msg--user">
          <div className="nx-ai-bubble">{live.question}</div>
        </div>
      )}
      <div className="nx-ai-msg nx-ai-msg--assistant" data-testid="assistant-live">
        <span className="nx-ai-avatar">
          <AiIcon name="spark" size={14} />
        </span>
        <div className="nx-ai-bubble">
          {live.steps.map((s, n) => (
            <div key={n} className="nx-ai-step">
              <AiIcon name={s.status === "done" ? "check" : "tool"} size={13} />
              {s.summary ?? `Looking up ${s.name.replace(/_/g, " ")}…`}
            </div>
          ))}
          {live.text ? (
            <Markdown text={live.text} onNavigate={onNavigate} />
          ) : (
            <span className="nx-ai-typing">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      </div>
    </>
  );
}
