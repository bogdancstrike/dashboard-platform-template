import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Grid } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { CHAT_RESOURCE, chatApi } from "@/api/chat";
import { useSmartBack } from "@/app/history";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import { usePresence } from "@/components/collab/presence";
import { useLiveEvents } from "@/live/LiveProvider";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Chat's state: the channel in the address and its thread overlay, the channel list and the open channel kept live, the search, and joining, leaving and muting.
 */
export function useChatPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const back = useSmartBack();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const phone = !screens.md;
  const wide = Boolean(screens.xl);
  const [params, setParams] = useSearchParams();
  const thread = useUrlOverlay("thread");
  const query = params.get("q") ?? "";
  const highlight = params.get("m");
  const [creating, setCreating] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [settings, setSettings] = useState(false);
  const presence = usePresence();

  const channels = useQuery({
    queryKey: queryKeys.chatChannels(),
    queryFn: ({ signal }) => chatApi.channels(signal),
  });
  const channel = useQuery({
    queryKey: queryKeys.chatChannel(channelId),
    queryFn: ({ signal }) => chatApi.get(channelId!, signal),
    enabled: Boolean(channelId),
    retry: false,
  });

  // A conversation somewhere else changed: its unread count did too.
  useLiveEvents((event) => {
    if (event.type === "thread" && event["resource_type"] === CHAT_RESOURCE) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
    } else if (event.type === "chat.channel") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
      if (event["channel_id"] === channelId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannel(channelId) });
      }
    }
  });

  // On a desk, `/chat` opens the first conversation rather than an empty pane.
  const first = channels.data?.items.find((item) => item.is_member);
  useEffect(() => {
    if (!channelId && !phone && first) navigate(`/chat/${first.id}`, { replace: true });
  }, [channelId, phone, first, navigate]);

  const open = (id: string) => navigate(`/chat/${id}`);
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    next.delete("m");
    setParams(next, { replace: true });
  };

  usePageCommands("chat", [
    { id: "chat.new-channel", label: "Create a chat channel", keywords: "chat channel new create", run: () => setCreating(true) },
    { id: "chat.direct", label: "Send a direct message", keywords: "chat dm direct message person", run: () => setDirecting(true) },
  ]);

  const detail = channel.data;
  const refreshChannel = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannel(channelId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
  };

  const join = async () => {
    try {
      await chatApi.join(channelId!);
      refreshChannel();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : "You could not join that channel.");
    }
  };
  const leave = async () => {
    try {
      await chatApi.leave(channelId!);
      refreshChannel();
      navigate("/chat");
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : "You could not leave that channel.");
    }
  };
  const mute = async () => {
    if (!detail) return;
    try {
      await chatApi.update(detail.id, { muted: !detail.muted });
      refreshChannel();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : "That was not saved.");
    }
  };

  return { channelId, navigate, back, queryClient, message, screens, phone, wide, params, setParams, thread, query, highlight, creating, setCreating, directing, setDirecting, settings, setSettings, presence, channels, channel, first, open, setQuery, detail, refreshChannel, join, leave, mute };
}

export type ChatPageModel = ReturnType<typeof useChatPage>;
