/**
 * Natural-language filters for the Data Explorer (§23, §42).
 *
 * Two entrances, one result:
 *
 * * `DescribeFilters` sits at the top of the Rules drawer. A description is
 *   compiled by the server into the explorer's own condition tree — validated
 *   against this dataset's fields, repaired where it can be, counted — and
 *   loaded into the builder as the *draft*. Nothing runs until the reader
 *   presses Apply, exactly as with rules built by hand.
 * * `AskData` is the toolbar's "Ask" mode: a question about any dataset. The
 *   server picks the dataset; the answer is handed to the Rules drawer of that
 *   dataset (through session storage, because the page changes dataset by
 *   changing its address) and reviewed there.
 */

import { useEffect, useState } from "react";
import { Alert, Button, Input, Popover } from "antd";

import { assistantApi, type FilterSuggestion } from "@/api/assistant";
import type { QueryNode } from "@/api/explorer";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";

import { AstIcon } from "./AstIcon";
import "@/styles/assistant.css";

const PENDING = "nucleus.assistant.pendingFilter";

export function stashPending(suggestion: FilterSuggestion & { question: string }) {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify(suggestion));
  } catch {
    // Without storage the drawer simply opens empty.
  }
}

export function takePending(resourceType: string): (FilterSuggestion & { question: string }) | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FilterSuggestion & { question: string };
    if (parsed.resource_type !== resourceType) return null;
    sessionStorage.removeItem(PENDING);
    return parsed;
  } catch {
    return null;
  }
}

function failureOf(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : "The description could not be turned into rules.";
}

function SuggestionNote({ suggestion }: { suggestion: FilterSuggestion }) {
  return (
    <div className="nx-ai-suggestion" data-testid="describe-result">
      <p>
        <AstIcon name="spark" size={14} />{" "}
        {suggestion.explanation || "Rules built from your description."}{" "}
        {suggestion.match_count !== null && (
          <b>
            {suggestion.match_count.toLocaleString()} match{suggestion.match_count === 1 ? "" : "es"}.
          </b>
        )}
      </p>
      {suggestion.notes.map((note) => (
        <p key={note} className="nx-ai-muted">{note}</p>
      ))}
      {suggestion.source === "fallback" && (
        <p className="nx-ai-muted">Built from the words alone — the AI model was not available. Check the rules below.</p>
      )}
    </div>
  );
}

export function DescribeFilters({
  resourceType,
  currentTree,
  onLoad,
}: {
  resourceType: string;
  currentTree: QueryNode | null;
  /** Put the compiled tree in the builder as the draft. */
  onLoad: (tree: QueryNode) => void;
}) {
  const { can } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FilterSuggestion | null>(null);

  // A question asked from the toolbar arrives here, already compiled.
  useEffect(() => {
    const pending = takePending(resourceType);
    if (pending) {
      setText(pending.question);
      setResult(pending);
      onLoad(pending.tree);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType]);

  if (!can("ai.use")) return null;

  const describe = async () => {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    try {
      const suggestion = await assistantApi.filters({ resource_type: resourceType, question, current_tree: currentTree });
      setResult(suggestion);
      onLoad(suggestion.tree);
    } catch (failure) {
      setError(failureOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nx-ai-describe" data-testid="describe-filters">
      <label className="nx-ai-describe-label" htmlFor="nx-ai-describe-input">
        <AstIcon name="spark" size={14} /> Describe what you want
      </label>
      <div className="nx-ai-describe-row">
        <Input
          id="nx-ai-describe-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPressEnter={() => void describe()}
          placeholder="e.g. critical tickets of mine opened this month, or anything escalated"
          data-testid="describe-input"
          maxLength={600}
          allowClear
        />
        <Button type="primary" loading={busy} onClick={() => void describe()} disabled={!text.trim()} data-testid="describe-go">
          Build rules
        </Button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {result && <SuggestionNote suggestion={result} />}
    </div>
  );
}

export function AskData({
  onReview,
}: {
  /** Open the Rules drawer of this dataset, where the stashed answer waits. */
  onReview: (resourceType: string) => void;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can("ai.use")) return null;

  const ask = async () => {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    try {
      const suggestion = await assistantApi.filters({ resource_type: "auto", question });
      stashPending({ ...suggestion, question });
      setOpen(false);
      setText("");
      onReview(suggestion.resource_type);
    } catch (failure) {
      setError(failureOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomLeft"
      overlayClassName="nx-ai-askpop"
      content={
        <div className="nx-ai-ask" data-testid="ask-data">
          <b>Ask a question of the data</b>
          <p className="nx-ai-muted">It becomes rules you can check before they run.</p>
          <Input.TextArea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder="Which customers in Germany have overdue orders?"
            data-testid="ask-input"
            maxLength={600}
          />
          {error && <Alert type="error" showIcon message={error} />}
          <Button type="primary" block loading={busy} onClick={() => void ask()} disabled={!text.trim()} data-testid="ask-go">
            Build the rules
          </Button>
        </div>
      }
    >
      <Button className="nx-ai-askbtn" icon={<AstIcon name="spark" size={15} />} data-testid="ask-data-open">
        Ask
      </Button>
    </Popover>
  );
}
