import type { AssistantMode, AssistantSources } from "@/api/assistant";
import { AstIcon as AiIcon } from "@/components/icons/AstIcon";

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

/** A conversation with nothing in it yet: what to ask, by mode. */
export function EmptyThread({
  mode,
  sources,
  onAsk,
}: {
  mode: AssistantMode;
  sources: AssistantSources;
  onAsk: (text: string) => void;
}) {
  return (
    <div className="nx-ai-empty" data-testid="assistant-empty">
      <span className="nx-ai-empty-mark">
        <AiIcon name="spark" size={22} />
      </span>
      <b>{mode === "data" ? "Ask about your data" : "How can I help?"}</b>
      <p>
        {mode === "data"
          ? sources.collections.length
            ? "Answers cite the records and the document pages they used."
            : "Answers cite the records they used, with links."
          : "Switch to Data to ask about your records."}
      </p>
      <div className="nx-ai-suggest">
        {SUGGESTIONS[mode].map((text) => (
          <button key={text} type="button" className="nx-ai-chip" onClick={() => onAsk(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
