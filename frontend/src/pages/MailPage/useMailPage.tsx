import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { mailApi, type BulkAction, type MailMessage, type MailThread } from "@/api/mail";
import { ApiError } from "@/api/client";
import { meApi } from "@/api/me";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePreferences } from "@/settings/PreferencesProvider";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";
import { PLACES, asFolder } from "./folders";

/**
 * The mailbox's state: folder, label, page and open thread in the address; the list and the open thread; and every action on them — star, file, bin, discard — plus the palette commands.
 */
export function useMailPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();

  const [selected, setSelected] = useState<string[]>([]);
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [composing, setComposing] = useState(false);
  const [replyTo, setReplyTo] = useState<MailThread | null>(null);
  const [editing, setEditing] = useState<MailMessage | null>(null);

  const { preferences } = usePreferences();
  /** Beside the list, under it, or nowhere — the reader's own choice (§40). */
  const pane = preferences.mail.preview;

  // The reader's default folder, unless the address names one. The URL still
  // owns what is on screen (§69); the preference only decides where somebody
  // lands when they have not said.
  const folder = asFolder(params.get("folder") ?? preferences.mail.default_folder);
  const label = params.get("label") ?? "";
  const openId = params.get("thread");
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const only = params.get("only") ?? "";
  const debounced = useDebouncedValue(term, 300);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => applyParamChanges(current, changes),
      // Where the reader *is* ("thread", "folder", "label") is a place back returns to, so it
      // is pushed; everything else is an adjustment and replaces.
      { replace: !Object.entries(changes).some(([key, value]) => PLACES.has(key) && value) },
    );

  const profile = useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => meApi.get(signal),
    staleTime: STALE.long,
  });
  const meEmail = profile.data?.user.email ?? null;

  const list = useQuery({
    queryKey: queryKeys.mail(folder, debounced, label, only, page),
    queryFn: ({ signal }) =>
      mailApi.threads(
        {
          folder,
          ...(debounced ? { q: debounced } : {}),
          ...(label ? { label } : {}),
          ...(only === "starred" ? { starred: "1" } : {}),
          ...(only === "unread" ? { unread: "1" } : {}),
          page,
        },
        signal,
      ),
  });

  // Read before the early returns, because the effect below compares it.
  const listed = list.data;

  const opened = useQuery({
    queryKey: queryKeys.mailThread(openId),
    queryFn: ({ signal }) => mailApi.thread(openId!, {}, signal),
    enabled: Boolean(openId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.mail() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.mailThread() });
  };

  // Opening a thread marks its messages read *on the server*, so the list and
  // the folder rail beside it are immediately out of date — the row stayed
  // bold and the inbox still claimed two unread while the reader was showing
  // one of them. Refetched when the opened thread comes back with nothing
  // unread and the list still thinks otherwise, which is the only case that
  // needs it: opening an already-read thread changes nothing.
  const openedUnread = opened.data?.unread_count;
  const listedUnread = listed?.items.find((item) => item.id === openId)?.unread_count;
  // `dataUpdatedAt` is in the dependencies, and it is the point. Without it the
  // effect only ran when the *count* changed — and re-opening a thread whose
  // answer was already cached at nought fired it before the request that does
  // the marking had even been sent, so the list refetched a server that had
  // not changed yet and the badge stayed where it was. This timestamp moves
  // whenever the query resolves, so the refetch happens after.
  const settledAt = opened.dataUpdatedAt;
  useEffect(() => {
    if (openedUnread === 0 && (listedUnread ?? 0) > 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mail() });
    }
  }, [settledAt, openedUnread, listedUnread, queryClient]);

  const star = useMutation({
    mutationFn: (thread: MailThread) =>
      mailApi.updateThread(thread.id, { is_starred: !thread.is_starred }),
    onSuccess: refresh,
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That change was refused."),
  });

  const act = useMutation({
    mutationFn: (input: { action: BulkAction; folder?: string; label?: string }) =>
      mailApi.bulk({ ids: selected, ...input }),
    onSuccess: (answer) => {
      message.success(
        `${answer.changed} ${answer.changed === 1 ? "conversation" : "conversations"} updated`,
      );
      setSelected([]);
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That action was refused."),
  });

  const bin = useMutation({
    mutationFn: (thread: MailThread) => mailApi.removeThread(thread.id),
    onSuccess: (answer) => {
      message.success(answer.deleted ? "Deleted for good" : "Moved to the bin");
      if (openId === answer.id) set({ thread: null });
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be removed."),
  });

  const discard = useMutation({
    mutationFn: (draft: MailMessage) => mailApi.discard(draft.id),
    onSuccess: () => {
      message.success("Draft discarded");
      set({ thread: null });
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be discarded."),
  });

  usePageCommands("mail", [
    {
      id: "mail.compose",
      label: "Write a message",
      keywords: "mail email compose new send",
      run: () => {
        setReplyTo(null);
        setEditing(null);
        setComposing(true);
      },
    },
    {
      id: "mail.unread",
      label: "Show only unread mail",
      keywords: "unread inbox",
      run: () => set({ folder: "INBOX", only: "unread", page: null }),
    },
    {
      id: "mail.drafts",
      label: "Open my drafts",
      keywords: "draft unfinished",
      run: () => set({ folder: "DRAFTS", thread: null, page: null }),
    },
  ]);

  return { params, setParams, queryClient, message, modal, selected, setSelected, term, setTerm, composing, setComposing, replyTo, setReplyTo, editing, setEditing, preferences, pane, folder, label, openId, page, only, debounced, set, profile, meEmail, list, listed, opened, refresh, openedUnread, listedUnread, settledAt, star, act, bin, discard };
}

export type MailPageModel = ReturnType<typeof useMailPage>;
