/**
 * One wiki page, read or edited (§48–49).
 *
 * * **Saving is continuous, history is not.** The editor saves a second after
 *   the last keystroke; the server folds a burst of saves by one person into
 *   one revision, so the history reads as edits rather than keystrokes.
 * * **Somebody else's save is not overwritten.** Every save names the version
 *   it was made from; a 409 says another person saved first, and the page
 *   offers to load theirs rather than silently winning.
 * * **Ticking a box is not "editing".** A checklist item or an action item can
 *   be ticked while reading, and is saved at once.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Breadcrumb,
  Button,
  Card,
  Dropdown,
  Input,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  LinkOutlined,
  PlusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { docsApi, type DocBlock, type DocBlockKind, type DocPage } from "@/api/docs";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { PersonAvatar } from "@/components/PersonAvatar";
import { MarkdownLite } from "@/components/collab/MarkdownLite";
import { initials } from "@/components/collab/MessageItem";
import { absoluteTime, relativeTime } from "@/lib/time";

import { BlockEditor } from "./BlockEditor";
import { BlockView } from "./BlockView";
import { DOC_BLOCK_ORDER, DOC_BLOCKS, newDocBlock, recordPath, RECORD_LABELS } from "./blocks";
import { HistoryDrawer } from "./HistoryDrawer";
import { RecordPicker } from "./RecordPicker";
import { FEATURES, useFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";
import { apiMessageToast } from "@/lib/errors";

const { Text } = Typography;
const SAVE_AFTER_MS = 1000;

interface Draft {
  title: string;
  icon: string | null;
  blocks: DocBlock[];
}

function AddBlock({ onAdd, label = "Add a block" }: { onAdd: (kind: DocBlockKind) => void; label?: string }) {
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: DOC_BLOCK_ORDER.map((kind) => ({
          key: kind,
          icon: DOC_BLOCKS[kind].icon,
          label: (
            <span className="nx-dc-add-item">
              <strong>{DOC_BLOCKS[kind].label}</strong>
              <span>{DOC_BLOCKS[kind].hint}</span>
            </span>
          ),
        })),
        onClick: ({ key }) => onAdd(key as DocBlockKind),
      }}
    >
      <Button icon={<PlusOutlined />} className="nx-dc-add" data-testid="add-block">
        {label}
      </Button>
    </Dropdown>
  );
}

export function DocView({ pageId, onDeleted }: { pageId: string; onDeleted: (spaceId: string) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const history = useUrlOverlay("history");
  const editing = params.get("edit") === "1";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [linking, setLinking] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const version = useRef(0);

  const page = useQuery({
    queryKey: queryKeys.docPage(pageId),
    queryFn: ({ signal }) => docsApi.page(pageId, signal),
    // An action item's task moves on without this page knowing; re-read its
    // state while the page is open.
    refetchInterval: (query) => (Object.keys(query.state.data?.tasks ?? {}).length > 0 ? 15_000 : false),
  });
  const data = page.data;

  // Take the server's copy whenever there is nothing unsaved to lose.
  useEffect(() => {
    if (!data || dirty) return;
    setDraft({ title: data.title, icon: data.icon, blocks: data.blocks });
    version.current = data.version;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.version, data?.updated_at]);
  useEffect(() => {
    setSummary(null);
    setConflict(false);
    setDirty(false);
  }, [pageId]);

  const people = useMemo(() => {
    const names: Record<string, string> = {};
    for (const person of data?.event?.participants ?? []) if (person.user_id && person.name) names[person.user_id] = person.name;
    return names;
  }, [data?.event]);

  const accept = (saved: DocPage) => {
    version.current = saved.version;
    queryClient.setQueryData(queryKeys.docPage(pageId), saved);
    void queryClient.invalidateQueries({ queryKey: queryKeys.docTree(saved.space.id) });
  };

  const save = useMutation({
    mutationFn: (next: Draft) =>
      docsApi.save(pageId, { title: next.title, icon: next.icon, blocks: next.blocks, expected_version: version.current }),
    onSuccess: (saved) => {
      setDirty(false);
      accept(saved);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else message.error(error instanceof ApiError ? error.message : "The page was not saved.");
    },
  });

  // A second after the last change, save.
  useEffect(() => {
    if (!dirty || !draft || conflict) return;
    const timer = window.setTimeout(() => save.mutate(draft), SAVE_AFTER_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, conflict]);

  const change = (next: Draft) => {
    setDraft(next);
    setDirty(true);
  };
  const setBlocks = (blocks: DocBlock[]) => draft && change({ ...draft, blocks });

  const createTask = useMutation({
    mutationFn: (blockId: string) => docsApi.createTask(pageId, blockId),
    onSuccess: (saved) => {
      message.success("Task created");
      setDirty(false);
      accept(saved);
      setDraft({ title: saved.title, icon: saved.icon, blocks: saved.blocks });
    },
    onError: apiMessageToast(message, "The task was not created."),
  });
  const runTask = (blockId: string) => {
    // A task is made from what is *saved*: save first if the words just changed.
    if (dirty && draft) save.mutate(draft, { onSuccess: () => createTask.mutate(blockId) });
    else createTask.mutate(blockId);
  };

  const unlink = useMutation({
    mutationFn: (linkId: string) => docsApi.unlink(pageId, linkId),
    onSuccess: () => void page.refetch(),
  });
  const link = useMutation({
    mutationFn: (record: { resource_type: string; id: string }) => docsApi.link(pageId, record.resource_type, record.id),
    onSuccess: () => {
      setLinking(false);
      void page.refetch();
    },
    onError: apiMessageToast(message, "That link was not saved."),
  });
  const summariesOn = useFeature(FEATURES.aiSummaries);
  const summarise = useMutation({
    mutationFn: () => docsApi.summarise(pageId),
    onSuccess: (result) => setSummary(result.summary),
    onError: apiMessageToast(message, "The summary could not be written."),
  });
  const remove = useMutation({
    mutationFn: () => docsApi.remove(pageId),
    onSuccess: () => {
      message.success("Page removed");
      if (data) onDeleted(data.space.id);
    },
  });

  if (page.isError || (!page.isLoading && !data)) {
    return (
      <Alert
        type="warning"
        showIcon
        message={page.error instanceof ApiError ? page.error.message : "That page could not be loaded."}
        action={<Button onClick={() => navigate("/docs")}>All docs</Button>}
      />
    );
  }
  if (!draft || !data) return <Card loading className="nx-dc-card" />;

  const setEditing = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set("edit", "1");
    else next.delete("edit");
    setParams(next, { replace: true });
    if (!on && dirty && draft) save.mutate(draft);
  };

  const move = (index: number, step: number) => {
    const blocks = [...draft.blocks];
    const [item] = blocks.splice(index, 1);
    blocks.splice(index + step, 0, item!);
    setBlocks(blocks);
  };
  const insertAt = (index: number, kind: DocBlockKind) => {
    const blocks = [...draft.blocks];
    blocks.splice(index, 0, newDocBlock(kind));
    setBlocks(blocks);
  };
  const tick = (blocks: DocBlock[]) => {
    const next = { ...draft, blocks };
    setDraft(next);
    save.mutate(next);
  };

  const status = conflict
    ? null
    : save.isPending
      ? "Saving…"
      : dirty
        ? "Unsaved changes"
        : `Saved · v${data.version}`;

  const actions = data.blocks.filter((block) => block.kind === "action" && block.text);

  return (
    <div className="nx-dc-view" data-testid="doc-page">
      <div className="nx-dc-main">
        <Card className="nx-dc-card">
          <div className="nx-dc-topbar">
            <Breadcrumb
              className="nx-dc-crumbs"
              items={[
                { title: <Link to={`/docs?space=${data.space.id}`}>{`${data.space.icon ?? ""} ${data.space.name}`.trim()}</Link> },
                ...data.breadcrumbs.map((crumb) => ({ title: <Link to={`/docs/${crumb.id}`}>{crumb.title}</Link> })),
              ]}
            />
            <Space wrap size={6} className="nx-dc-toolbar">
              {status && <Text type="secondary" className="nx-dc-status" data-testid="save-status">{status}</Text>}
              {data.can_edit && (
                <Button
                  type={editing ? "primary" : "default"}
                  icon={editing ? undefined : <EditOutlined />}
                  onClick={() => setEditing(!editing)}
                  data-testid="toggle-edit"
                >
                  {editing ? "Done" : "Edit"}
                </Button>
              )}
              <Tooltip title="History">
                <Button icon={<HistoryOutlined />} aria-label="History" onClick={() => history.open("1")} data-testid="open-history" />
              </Tooltip>
              {summariesOn && (
                <Tooltip title="Summarise with AI">
                  <Button icon={<RobotOutlined />} aria-label="Summarise" loading={summarise.isPending} onClick={() => summarise.mutate()} />
                </Tooltip>
              )}
              {data.can_edit && (
                <Tooltip title="Delete page">
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Delete page"
                    onClick={() =>
                      modal.confirm({
                        title: `Delete ${data.title}?`,
                        content: "The page and every page under it leave the wiki. Their history is kept.",
                        okText: "Delete",
                        okButtonProps: { danger: true, "data-testid": "confirm-delete" },
                        cancelText: "Keep it",
                        onOk: () => remove.mutateAsync(),
                      })
                    }
                  />
                </Tooltip>
              )}
            </Space>
          </div>
          <div className="nx-dc-titlebar">
            {editing ? (
              <Space.Compact className="nx-dc-title-edit">
                <Input
                  aria-label="Page icon"
                  className="nx-dc-icon-input"
                  maxLength={4}
                  value={draft.icon ?? ""}
                  placeholder="📄"
                  onChange={(event) => change({ ...draft, icon: event.target.value || null })}
                />
                <Input
                  aria-label="Title"
                  className="nx-dc-title-input"
                  value={draft.title}
                  onChange={(event) => change({ ...draft, title: event.target.value })}
                  data-testid="doc-title"
                />
              </Space.Compact>
            ) : (
              <h1 className="nx-dc-title">
                {draft.icon && <span aria-hidden>{draft.icon}</span>} {draft.title}
              </h1>
            )}
          </div>
          <div className="nx-dc-byline">
            {data.updated_by && <PersonAvatar size={20} src={data.updated_by.avatar_url} initials={initials(data.updated_by.name)} />}
            <Text type="secondary" title={absoluteTime(data.updated_at)}>
              Edited by {data.updated_by?.name ?? "somebody"} · {relativeTime(data.updated_at)}
            </Text>
            {data.event && <Tag bordered={false} color="green">meeting notes</Tag>}
          </div>

          {conflict && (
            <Alert
              type="warning"
              showIcon
              className="nu-block"
              message="Somebody else saved this page while you were editing it."
              description="Load their version to keep working — your last change is not saved."
              action={
                <Button
                  onClick={() => {
                    setConflict(false);
                    setDirty(false);
                    void page.refetch();
                  }}
                >
                  Load the latest
                </Button>
              }
            />
          )}

          {summary && (
            <div className="nx-dc-summary" data-testid="doc-summary">
              <div className="nx-dc-summary-head">
                <RobotOutlined /> <strong>Summary</strong>
                <Space size={4}>
                  {data.can_edit && (
                    <Button
                      onClick={() => {
                        setBlocks([{ ...newDocBlock("callout"), tone: "info", text: `**Summary** — ${summary}` }, ...draft.blocks]);
                        setSummary(null);
                      }}
                    >
                      Add to page
                    </Button>
                  )}
                  <Button type="text" onClick={() => setSummary(null)}>
                    Dismiss
                  </Button>
                </Space>
              </div>
              <MarkdownLite text={summary} />
            </div>
          )}

          <div className={`nx-dc-body${editing ? " is-editing" : ""}`} data-testid="doc-body">
            {draft.blocks.length === 0 && !editing && (
              <Text type="secondary">This page is empty.{data.can_edit ? " Press Edit to write something." : ""}</Text>
            )}
            {draft.blocks.map((block, index) =>
              editing ? (
                <div key={block.id} className="nx-dc-edit-block" data-testid={`edit-${block.kind}`}>
                  <div className="nx-dc-edit-rail">
                    <span className="nx-dc-kind">{DOC_BLOCKS[block.kind].icon}</span>
                    <Button type="text" icon={<ArrowUpOutlined />} aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} />
                    <Button type="text" icon={<ArrowDownOutlined />} aria-label="Move down" disabled={index === draft.blocks.length - 1} onClick={() => move(index, 1)} />
                    <Button type="text" danger icon={<DeleteOutlined />} aria-label="Remove block" onClick={() => setBlocks(draft.blocks.filter((item) => item.id !== block.id))} />
                  </div>
                  <div className="nx-dc-edit-main">
                    <BlockEditor
                      block={block}
                      onChange={(next) => setBlocks(draft.blocks.map((item) => (item.id === block.id ? next : item)))}
                    />
                    {block.kind === "action" && block.text && !block.task_id && data.can_create_tasks && (
                      <Button className="nu-block" onClick={() => runTask(block.id)} loading={createTask.isPending && createTask.variables === block.id}>
                        Create task
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div key={block.id} className="nx-dc-block">
                  <BlockView
                    block={block}
                    tasks={data.tasks}
                    people={people}
                    canCreateTasks={data.can_edit && data.can_create_tasks}
                    creatingTask={createTask.isPending ? (createTask.variables ?? null) : null}
                    onCreateTask={data.can_edit ? runTask : undefined}
                    onToggleAction={
                      data.can_edit
                        ? (id, done) => tick(draft.blocks.map((item) => (item.id === id ? { ...item, done } : item)))
                        : undefined
                    }
                    onToggleCheck={
                      data.can_edit
                        ? (id, at, done) =>
                            tick(
                              draft.blocks.map((item) =>
                                item.id === id
                                  ? {
                                      ...item,
                                      items: (item.items ?? []).map((raw, i) =>
                                        i === at ? { text: typeof raw === "string" ? raw : raw.text, done } : raw,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                        : undefined
                    }
                  />
                </div>
              ),
            )}
            {editing && <AddBlock onAdd={(kind) => insertAt(draft.blocks.length, kind)} />}
          </div>
        </Card>
      </div>

      <aside className="nx-dc-side">
        {data.event && (
          <Card className="nx-dc-card is-side" title="Meeting" size="small" data-testid="doc-meeting">
            <strong>{data.event.title}</strong>
            <div className="nx-co-muted">
              {absoluteTime(data.event.starts_at)}
              {data.event.location ? ` · ${data.event.location}` : ""}
            </div>
            <ul className="nx-dc-people">
              {data.event.participants.map((person, index) => (
                <li key={person.user_id ?? index}>
                  <PersonAvatar size={20} initials={initials(person.name ?? "?")} />
                  <span>{person.name ?? "Somebody"}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {actions.length > 0 && (
          <Card className="nx-dc-card is-side" title={`Action items · ${actions.length}`} size="small">
            <ul className="nx-dc-side-list">
              {actions.map((block) => {
                const task = block.task_id ? data.tasks[block.task_id] : undefined;
                return (
                  <li key={block.id}>
                    <span>{block.text}</span>
                    {task ? (
                      <Link to={`/tasks/${task.id}`} className="nx-co-muted">
                        {task.reference} · {task.status.toLowerCase().replace(/_/g, " ")}
                      </Link>
                    ) : (
                      <span className="nx-co-muted">not a task yet</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <Card
          className="nx-dc-card is-side"
          size="small"
          title="Linked records"
          extra={
            data.can_edit && (
              <Button type="text" icon={<LinkOutlined />} onClick={() => setLinking(true)} data-testid="link-record">
                Link
              </Button>
            )
          }
          data-testid="doc-links"
        >
          {data.links.length === 0 ? (
            <Text type="secondary">Nothing linked. A record mentioned in the page is linked by itself.</Text>
          ) : (
            <ul className="nx-dc-side-list">
              {data.links.map((item) => (
                <li key={item.id}>
                  <Link to={recordPath(item.resource_type, item.resource_id)}>
                    <Text type="secondary">{RECORD_LABELS[item.resource_type] ?? item.resource_type}</Text> {item.label}
                  </Link>
                  <span className="nx-dc-link-meta">
                    <Text type="secondary">{item.source === "MANUAL" ? "linked" : item.source === "MENTION" ? "mentioned" : "action"}</Text>
                    {data.can_edit && item.source === "MANUAL" && (
                      <Button type="text" aria-label={`Unlink ${item.label}`} onClick={() => unlink.mutate(item.id)}>
                        ×
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="nx-dc-card is-side" size="small" title="About this page">
          <dl className="nx-dc-about">
            <dt>Created</dt>
            <dd>
              {data.created_by?.name ?? "Somebody"} · {relativeTime(data.created_at)}
            </dd>
            <dt>Version</dt>
            <dd>{data.version}</dd>
            {data.template && (
              <>
                <dt>Template</dt>
                <dd>{data.template}</dd>
              </>
            )}
          </dl>
        </Card>
      </aside>

      <RecordPicker
        open={linking}
        title="Link a record"
        onClose={() => setLinking(false)}
        onPick={(record) => link.mutate(record)}
      />
      <HistoryDrawer
        page={data}
        open={history.value !== null}
        onClose={history.close}
        onRestored={(restored) => {
          setDirty(false);
          accept(restored);
          setDraft({ title: restored.title, icon: restored.icon, blocks: restored.blocks });
          history.close();
        }}
      />
    </div>
  );
}
