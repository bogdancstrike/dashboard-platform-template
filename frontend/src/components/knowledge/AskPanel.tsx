import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Dropdown, Input, Tooltip, Typography } from "antd";
import { DeleteOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import { knowledgeApi, type Answer, type Citation, type CollectionDetail } from "@/api/knowledge";
import { EmptyState } from "@/components/EmptyState";
import { KnIcon } from "@/components/icons/KnIcon";
import { MiniMarkdown } from "@/components/knowledge/MiniMarkdown";
import { relativeTime } from "@/lib/time";
import { STALE, queryKeys } from "@/lib/queryKeys";

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
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ question: string; text: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const history = useQuery({
    queryKey: queryKeys.knowledgeHistory(collection.id, threadId),
    queryFn: ({ signal }) => knowledgeApi.history(collection.id, threadId, signal),
  });
  const suggestions = useQuery({
    queryKey: queryKeys.knowledgeSuggestions(collection.id),
    queryFn: ({ signal }) => knowledgeApi.suggestions(collection.id, signal),
    staleTime: STALE.minute,
  });

  const turns: Answer[] = threadId ? (history.data?.items ?? []) : [];
  const threads = history.data?.threads ?? [];
  const ready = collection.counts.ready > 0;

  const ask = useMutation({
    mutationFn: (question: string) =>
      knowledgeApi.ask({ collection_id: collection.id, question, thread_id: threadId }),
    onMutate: (question) => {
      setPending(question);
      setFailure(null);
    },
    onSuccess: (answer) => {
      setDraft("");
      setPending(null);
      queryClient.setQueryData(
        queryKeys.knowledgeHistory(collection.id, answer.thread_id),
        (current: { items: Answer[]; threads: unknown[] } | undefined) => ({
          items: [...(threadId === answer.thread_id ? (current?.items ?? []) : []), answer],
          threads: current?.threads ?? [],
        }),
      );
      if (answer.thread_id !== threadId) onThread(answer.thread_id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeHistory(collection.id) });
    },
    onError: (error: Error, question) => {
      setPending(null);
      const unavailable = error instanceof ApiError && (error.status === 503 || error.status === 429 || error.status === 504);
      setFailure({
        question,
        text: unavailable
          ? "The AI model is not available right now. Your question was kept — try again in a moment."
          : error.message,
      });
    },
  });

  const forget = useMutation({
    mutationFn: (id: string) => knowledgeApi.forgetThread(collection.id, id),
    onSuccess: (_result, id) => {
      message.success("Conversation forgotten");
      if (id === threadId) onThread(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeHistory(collection.id) });
    },
  });

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [turns.length, pending]);

  function submit(question: string) {
    const text = question.trim();
    if (!text || ask.isPending) return;
    ask.mutate(text);
  }

  return (
    <div className="nx-kn-ask" data-testid="ask-panel">
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
                    {thread.turns} question{thread.turns === 1 ? "" : "s"} · {relativeTime(thread.updated_at)}
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
                onClick={() => forget.mutate(threadId)}
              />
            </Tooltip>
          )}
          <Button icon={<PlusOutlined />} onClick={() => onThread(null)} disabled={!threadId} data-testid="ask-new">
            New conversation
          </Button>
        </div>
      </div>

      <div className="nx-kn-thread" aria-live="polite">
        {!turns.length && !pending && (
          <div className="nx-kn-welcome">
            <span className="nx-kn-welcome-mark">
              <KnIcon name="spark" size={22} />
            </span>
            {ready ? (
              <>
                <Text strong className="nx-kn-welcome-title">
                  Ask anything about {collection.name}
                </Text>
                <Text type="secondary">
                  Answers come only from its {collection.counts.ready} document
                  {collection.counts.ready === 1 ? "" : "s"}, and every claim cites the page it came from.
                </Text>
                <div className="nx-kn-chips" data-testid="ask-suggestions">
                  {(suggestions.data?.items ?? []).map((item) => (
                    <button key={item} type="button" className="nx-kn-chip" onClick={() => submit(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                compact
                title="Nothing to ask yet"
                hint="Questions are answered once at least one document has been read. Add files on the Documents tab."
              />
            )}
          </div>
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

function AnswerTurn({ turn, onCite }: { turn: Answer; onCite: (citation: Citation) => void }) {
  const byN = new Map(turn.citations.map((citation) => [citation.n, citation]));
  return (
    <div className="nx-kn-turn" data-testid="answer">
      <div className="nx-kn-q">{turn.question}</div>
      <div className={`nx-kn-a${turn.status === "NO_ANSWER" ? " nx-kn-a--none" : ""}`}>
        <MiniMarkdown
          text={turn.answer}
          cite={(n) => {
            const citation = byN.get(n);
            if (!citation) return null;
            return (
              <button
                type="button"
                className="nx-kn-cite"
                onClick={() => onCite(citation)}
                aria-label={`Source ${n}: ${citation.file_name}${citation.page ? `, page ${citation.page}` : ""}`}
                data-testid="answer-cite"
              >
                {n}
              </button>
            );
          }}
        />
        {turn.citations.length > 0 && (
          <div className="nx-kn-sources">
            {turn.citations.map((citation) => (
              <button
                key={citation.n}
                type="button"
                className="nx-kn-source"
                onClick={() => onCite(citation)}
                data-testid="answer-source"
              >
                <span className="nx-kn-source-n">{citation.n}</span>
                <span className="nx-kn-source-body">
                  <span className="nx-kn-source-file">
                    {citation.file_name}
                    {citation.page ? <span className="nx-kn-source-page"> · p. {citation.page}</span> : null}
                  </span>
                  <span className="nx-kn-source-quote">{citation.quote}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
