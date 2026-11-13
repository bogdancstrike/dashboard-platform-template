import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { knowledgeApi, type Answer, type CollectionDetail } from "@/api/knowledge";
import { STALE, queryKeys } from "@/lib/queryKeys";

/**
 * One collection's conversation as data: the thread's turns and the other
 * threads, the suggested questions, and asking and forgetting — with the
 * question in flight and the last failure kept so it can be retried.
 */
export function useAsk(
  collection: CollectionDetail,
  threadId: string | null,
  onThread: (threadId: string | null) => void,
  /** Called once an answer has arrived, to clear the composer. */
  onAnswered: () => void,
) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ question: string; text: string } | null>(null);

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
      onAnswered();
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
      const unavailable =
        error instanceof ApiError &&
        (error.status === 503 || error.status === 429 || error.status === 504);
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

  const submit = (question: string) => {
    const text = question.trim();
    if (!text || ask.isPending) return;
    ask.mutate(text);
  };

  return {
    turns,
    threads,
    suggestions: suggestions.data?.items ?? [],
    ready,
    pending,
    failure,
    ask,
    forget,
    submit,
  };
}
