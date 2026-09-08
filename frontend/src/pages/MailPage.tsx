/**
 * `/mail` — a mailbox (§14–§16, §20).
 *
 * Four decisions worth stating.
 *
 * **Three panes, and the page never scrolls.** Folders, conversations, and the
 * one being read. Each pane scrolls inside itself, which is what makes a
 * mailbox usable: a document-level scrollbar means losing the folder rail the
 * moment you read anything. Below the breakpoint the reader takes the whole
 * width and the list becomes the previous screen, because three columns in 360
 * pixels is three unusable ones.
 *
 * **The folder, the search and the open thread are all in the address.**
 * `?folder=ARCHIVE&q=invoice&thread=…` is a link somebody can send and a state
 * the back button steps through (§69).
 *
 * **The bulk bar appears when something is selected and says how many.** A
 * toolbar of permanently-disabled buttons teaches nobody what they do; one
 * that arrives with "3 selected" on it is self-explanatory.
 *
 * **Every count on the page is the server's.** The folder rail's unread
 * numbers, the thread's message count, the snippet — all recomputed from rows
 * when anything changes. A badge this page decremented would drift, and a
 * wrong unread count is the single most irritating bug a mail client has.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Pagination,
  Segmented,
  Skeleton,
  Space,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  FolderOpenOutlined,
  MailFilled,
  MailOutlined,
  PlusOutlined,
  TagOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  mailApi,
  type BulkAction,
  type MailFolder,
  type MailMessage,
  type MailThread,
} from "@/api/mail";
import { ApiError } from "@/api/client";
import { meApi } from "@/api/me";
import { Composer } from "@/components/mail/Composer";
import { FOLDER_META, FolderRail } from "@/components/mail/FolderRail";
import { ThreadList } from "@/components/mail/ThreadList";
import { ThreadReader } from "@/components/mail/ThreadReader";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const { Text } = Typography;

const FOLDERS: MailFolder[] = [
  "INBOX",
  "OUTBOX",
  "SENT",
  "DRAFTS",
  "ARCHIVE",
  "SPAM",
  "TRASH",
];

function asFolder(raw: string | null): MailFolder {
  return FOLDERS.includes(raw as MailFolder) ? (raw as MailFolder) : "INBOX";
}

export default function MailPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();

  const [selected, setSelected] = useState<string[]>([]);
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [composing, setComposing] = useState(false);
  const [replyTo, setReplyTo] = useState<MailThread | null>(null);
  const [editing, setEditing] = useState<MailMessage | null>(null);

  const folder = asFolder(params.get("folder"));
  const label = params.get("label") ?? "";
  const openId = params.get("thread");
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const only = params.get("only") ?? "";
  const debounced = useDebouncedValue(term, 300);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const profile = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => meApi.get(signal),
    staleTime: 300_000,
  });
  const meEmail = profile.data?.user.email ?? null;

  const list = useQuery({
    queryKey: ["mail", folder, debounced, label, only, page],
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
    queryKey: ["mail-thread", openId],
    queryFn: ({ signal }) => mailApi.thread(openId!, {}, signal),
    enabled: Boolean(openId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["mail"] });
    void queryClient.invalidateQueries({ queryKey: ["mail-thread"] });
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
      void queryClient.invalidateQueries({ queryKey: ["mail"] });
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

  if (list.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (list.isError) {
    return (
      <>
        <PageHeader title="Mail" />
        <Alert
          type="error"
          showIcon
          message={
            list.error instanceof ApiError
              ? list.error.message
              : "The mailbox could not be loaded."
          }
          action={
            <Button size="small" onClick={() => void list.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const data = listed!;
  const inbox = data.folders.find((entry) => entry.key === "INBOX");
  const reading = opened.data;

  return (
    <>
      <PageHeader
        title="Mail"
        subtitle="Conversations, drafts and everything the platform has written on your behalf."
        tag={
          inbox && inbox.unread > 0 ? (
            <Text type="secondary">{inbox.unread} unread in the inbox</Text>
          ) : undefined
        }
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder={`Search ${FOLDER_META[folder].label.toLowerCase()}`}
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                set({ q: event.target.value || null, page: null });
              }}
              style={{ width: 240 }}
              aria-label="Search this folder"
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setReplyTo(null);
                setEditing(null);
                setComposing(true);
              }}
              data-testid="compose"
            >
              Write one
            </Button>
          </Space>
        }
      />

      <div className="nu-fill nu-mail">
        <Card size="small" className="nu-pane nu-mail-rail" data-testid="mail-rail">
          <FolderRail
            data={data}
            folder={folder}
            label={label}
            onFolder={(next) =>
              set({ folder: next, thread: null, label: null, page: null })
            }
            onLabel={(next) => set({ label: next, page: null })}
          />
        </Card>

        <Card
          size="small"
          className="nu-pane nu-mail-list"
          data-testid="mail-list"
          title={
            <div className="nu-mail-listbar">
              <Segmented
                size="small"
                aria-label="Show"
                value={only || "all"}
                onChange={(next) =>
                  set({ only: next === "all" ? null : String(next), page: null })
                }
                options={[
                  { value: "all", label: `All (${data.total})` },
                  { value: "unread", label: "Unread" },
                  { value: "starred", label: "Starred" },
                ]}
              />
              {/* Arrives when something is selected, with the count on it. A
                  toolbar of permanently-disabled buttons teaches nobody. */}
              {selected.length > 0 && (
                <Space size={4} data-testid="bulk-bar">
                  <Text type="secondary">{selected.length} selected</Text>
                  <Button
                    size="small"
                    icon={<MailOutlined />}
                    loading={act.isPending}
                    onClick={() => act.mutate({ action: "READ" })}
                    data-testid="bulk-read"
                  >
                    Read
                  </Button>
                  {/* Both directions, because "I have read this and want to
                      come back to it" is half of what the flag is for — and a
                      mailbox that can only mark read is one where that
                      intention has nowhere to go. */}
                  <Button
                    size="small"
                    icon={<MailFilled />}
                    loading={act.isPending}
                    onClick={() => act.mutate({ action: "UNREAD" })}
                    data-testid="bulk-unread"
                  >
                    Unread
                  </Button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: data.movable
                        .filter((item) => item !== folder)
                        .map((item) => ({
                          key: item,
                          label: `Move to ${FOLDER_META[item].label}`,
                          onClick: () => act.mutate({ action: "MOVE", folder: item }),
                        })),
                    }}
                  >
                    <Button size="small" icon={<FolderOpenOutlined />} data-testid="bulk-move">
                      Move
                    </Button>
                  </Dropdown>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items:
                        data.labels.length > 0
                          ? data.labels.map((item) => ({
                              key: item.key,
                              label: `Label ${item.key}`,
                              onClick: () =>
                                act.mutate({ action: "LABEL", label: item.key }),
                            }))
                          : [{ key: "none", label: "No labels in use yet", disabled: true }],
                    }}
                  >
                    <Button size="small" icon={<TagOutlined />} data-testid="bulk-label">
                      Label
                    </Button>
                  </Dropdown>
                  <Button size="small" onClick={() => setSelected([])}>
                    Clear
                  </Button>
                </Space>
              )}
            </div>
          }
        >
          {data.items.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                debounced
                  ? `Nothing in ${FOLDER_META[folder].label.toLowerCase()} matches “${debounced}”`
                  : `${FOLDER_META[folder].label} is empty`
              }
            />
          ) : (
            <>
              <ThreadList
                items={data.items}
                openId={openId}
                selected={selected}
                meEmail={meEmail}
                onOpen={(thread) => set({ thread: thread.id })}
                onSelect={setSelected}
                onStar={(thread) => star.mutate(thread)}
              />
              {data.pages > 1 && (
                <Pagination
                  className="nu-mail-pages"
                  simple
                  current={data.page}
                  pageSize={data.page_size}
                  total={data.total}
                  onChange={(next) => set({ page: String(next) })}
                />
              )}
            </>
          )}
        </Card>

        <Card
          size="small"
          className="nu-pane nu-mail-reader"
          data-testid="mail-reader"
          title={
            reading ? (
              <div className="nu-mail-readerbar">
                <Text ellipsis>{reading.subject}</Text>
                <Space size={4}>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: data.movable
                        .filter((item) => item !== reading.folder)
                        .map((item) => ({
                          key: item,
                          label: `Move to ${FOLDER_META[item].label}`,
                          onClick: () =>
                            mailApi
                              .updateThread(reading.id, { folder: item })
                              .then(refresh)
                              .catch(() => message.error("That move was refused.")),
                        })),
                    }}
                  >
                    <Button size="small" icon={<FolderOpenOutlined />} data-testid="move-thread">
                      Move
                    </Button>
                  </Dropdown>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    loading={bin.isPending}
                    onClick={() =>
                      reading.folder === "TRASH"
                        ? modal.confirm({
                            title: `Delete ${reading.subject} for good?`,
                            content:
                              "It is already in the bin. This removes it from the database.",
                            okText: "Delete",
                            okButtonProps: { danger: true },
                            onOk: () => bin.mutateAsync(reading),
                          })
                        : bin.mutate(reading)
                    }
                    data-testid="bin-thread"
                  >
                    {reading.folder === "TRASH" ? "Delete" : "Bin"}
                  </Button>
                </Space>
              </div>
            ) : undefined
          }
        >
          {!openId ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Choose a conversation to read it"
            />
          ) : opened.isLoading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : opened.isError ? (
            <Alert
              type="error"
              showIcon
              message={
                opened.error instanceof ApiError
                  ? opened.error.message
                  : "That conversation could not be opened."
              }
            />
          ) : reading ? (
            <ThreadReader
              thread={reading}
              onReply={() => {
                setReplyTo(reading);
                setEditing(null);
                setComposing(true);
              }}
              onEditDraft={(draft) => {
                setEditing(draft);
                setReplyTo(null);
                setComposing(true);
              }}
              onDiscardDraft={(draft) =>
                modal.confirm({
                  title: "Discard this draft?",
                  content: "It has not been sent, and nothing keeps a copy.",
                  okText: "Discard",
                  okButtonProps: { danger: true },
                  onOk: () => discard.mutateAsync(draft),
                })
              }
            />
          ) : null}
        </Card>
      </div>

      <Composer
        open={composing}
        thread={replyTo}
        draft={editing}
        meEmail={meEmail}
        priorities={data.priorities}
        onClose={() => {
          setComposing(false);
          setReplyTo(null);
          setEditing(null);
        }}
        onSaved={(saved) => {
          setComposing(false);
          setReplyTo(null);
          setEditing(null);
          // Straight to what was just written, in the folder it landed in —
          // otherwise a reply vanishes from the list it was sent from and
          // reads as having failed.
          set({ folder: saved.folder, thread: saved.id, page: null });
          refresh();
        }}
      />
    </>
  );
}
