import { useEffect, useRef, useState } from "react";
import { Button, Input, Typography } from "antd";

import type { Citation, CollectionDetail } from "@/api/knowledge";
import { KnIcon } from "@/components/icons/KnIcon";

import { AnswerTurn } from "./ask/AnswerTurn";
import { ThreadBar } from "./ask/ThreadBar";
import { useAsk } from "./ask/useAsk";
import { Welcome } from "./ask/Welcome";

const { Text } = Typography;

/**
 * The conversation with one collection (§44): a question, an answer whose
 * every claim carries a numbered citation, and the sources listed beneath it.
 * A citation — the superscript in the text or the card below — opens the file
 * at the cited page with the passage marked.
 */
export function AskPanel({
  collection,
  threadId,
  onThread,
  onCite,
}: {
  collection: CollectionDetail;
  threadId: string | null;
  onThread: (threadId: string | null) => void;
  onCite: (citation: Citation) => void;
}) {
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const { turns, threads, suggestions, ready, pending, failure, ask, forget, submit } = useAsk(
    collection,
    threadId,
    onThread,
    () => setDraft(""),
  );

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [turns.length, pending]);

  return (
    <div className="nx-kn-ask" data-testid="ask-panel">
      <ThreadBar
        threads={threads}
        threadId={threadId}
        onThread={onThread}
        onForget={(id) => forget.mutate(id)}
      />

      <div className="nx-kn-thread" aria-live="polite">
        {!turns.length && !pending && (
          <Welcome collection={collection} ready={ready} suggestions={suggestions} onAsk={submit} />
        )}

        {turns.map((turn) => (
          <AnswerTurn key={turn.id} turn={turn} onCite={onCite} />
        ))}

        {pending && (
          <div className="nx-kn-turn" data-testid="ask-pending">
            <div className="nx-kn-q">{pending}</div>
            <div className="nx-kn-a nx-kn-a--thinking">
              <span className="nx-kn-dots" aria-label="Reading the documents">
                <i />
                <i />
                <i />
              </span>
              <Text type="secondary">Reading the documents…</Text>
            </div>
          </div>
        )}

        {failure && (
          <div className="nx-kn-turn" data-testid="ask-failure">
            <div className="nx-kn-q">{failure.question}</div>
            <div className="nx-kn-a nx-kn-a--failed">
              <Text>{failure.text}</Text>
              <Button onClick={() => submit(failure.question)}>
                Try again
              </Button>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="nx-kn-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <Input.TextArea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
          autoSize={{ minRows: 1, maxRows: 5 }}
          maxLength={2000}
          placeholder={ready ? `Ask ${collection.name}…` : "Add documents first"}
          disabled={!ready}
          aria-label="Your question"
          data-testid="ask-input"
        />
        <Button
          type="primary"
          shape="circle"
          htmlType="submit"
          aria-label="Ask"
          icon={<KnIcon name="send" />}
          loading={ask.isPending}
          disabled={!ready || !draft.trim()}
          data-testid="ask-send"
        />
      </form>
    </div>
  );
}
