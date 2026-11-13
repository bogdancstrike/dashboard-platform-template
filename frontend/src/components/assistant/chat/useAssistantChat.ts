import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import {
  assistantApi,
  streamTurn,
  type AssistantMode,
  type AssistantSources,
  type TurnEvent,
} from "@/api/assistant";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";

import { DEFAULT_SOURCES } from "../SourcePicker";

export interface Live {
  text: string;
  steps: { name: string; status: string; summary?: string }[];
  question: string;
}

/**
 * One conversation as data: its messages, its mode and sources (held locally
 * until the first message creates it), the answer streaming in, and the
 * actions — send a turn, regenerate, stop, change mode or sources.
 */
export function useAssistantChat(
  conversationId: string | null,
  initialMode: AssistantMode,
  onConversationChange?: (id: string) => void,
) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [newMode, setNewMode] = useState<AssistantMode>(initialMode);
  const [newSources, setNewSources] = useState<AssistantSources>(DEFAULT_SOURCES);
  const [live, setLive] = useState<Live | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const conversation = useQuery({
    queryKey: queryKeys.assistantConversation(conversationId),
    queryFn: ({ signal }) => assistantApi.get(conversationId!, signal),
    enabled: Boolean(conversationId),
  });

  const mode: AssistantMode = conversation.data?.mode ?? newMode;
  const sources: AssistantSources = conversation.data?.sources ?? newSources;
  const messages = conversation.data?.messages ?? [];
  const streaming = live !== null;

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
    queryClient.setQueryData(queryKeys.assistantConversation(conversationId), {
      ...conversation.data,
      mode: next,
    });
    await assistantApi.update(conversationId, { mode: next });
    await refresh(conversationId);
  };

  const changeSources = async (next: AssistantSources) => {
    if (!conversationId) {
      setNewSources(next);
      return;
    }
    queryClient.setQueryData(queryKeys.assistantConversation(conversationId), {
      ...conversation.data,
      sources: next,
    });
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
        if (event.type === "delta")
          setLive((cur) => (cur ? { ...cur, text: cur.text + event.text } : cur));
        else if (event.type === "tool")
          setLive((cur) => {
            if (!cur) return cur;
            const steps =
              event.status === "done"
                ? cur.steps.map((s, n) =>
                    n === cur.steps.length - 1 && s.name === event.name
                      ? { ...s, status: "done", summary: event.summary }
                      : s,
                  )
                : [...cur.steps, { name: event.name, status: "running" }];
            return { ...cur, steps };
          });
        else if (event.type === "error") setFailure(event.message);
      };
      await streamTurn(id, { ...body, mode }, onEvent, controller.signal);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setFailure(
          error instanceof ApiError || error instanceof Error
            ? error.message
            : "The assistant could not answer.",
        );
      }
    } finally {
      abort.current = null;
      if (id) await refresh(id);
      setLive(null);
      if (createdId) onConversationChange?.(createdId);
    }
  };

  const stop = () => abort.current?.abort();
  return {
    conversation,
    mode,
    sources,
    messages,
    streaming,
    live,
    failure,
    changeMode,
    changeSources,
    run,
    stop,
  };
}
