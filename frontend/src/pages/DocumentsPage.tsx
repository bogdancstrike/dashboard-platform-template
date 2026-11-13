import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { App as AntApp, Button, Grid, Input, Popconfirm, Segmented, Select, Skeleton, Tooltip, Typography } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";

import { filesApi } from "@/api/files";
import {
  isReading,
  knowledgeApi,
  type Citation,
  type Collection,
  type CollectionInput,
  type KnowledgeDocument,
} from "@/api/knowledge";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { FilePreview } from "@/components/files/FilePreview";
import { AskPanel } from "@/components/knowledge/AskPanel";
import { CollectionModal } from "@/components/knowledge/CollectionModal";
import { DocumentsPanel } from "@/components/knowledge/DocumentsPanel";
import { KnIcon } from "@/components/icons/KnIcon";
import { relativeTime } from "@/lib/time";
import "@/styles/knowledge.css";
import { STALE, queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

const SCOPE_LABEL: Record<string, string> = { PRIVATE: "Only me", SHARED: "Shared", PUBLIC: "Everyone" };

/**
 * Ask your documents (§44).
 *
 * The address carries the place: `?collection=` (pushed — it is a different
 * thing to look at), `?thread=` (pushed — a conversation is a place too),
 * `?tab=` (replaced — a view of the same place), and `?passage=` for the
 * citation preview, a URL drawer, so back closes it.
 */
export default function DocumentsPage() {
  const { message } = AntApp.useApp();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const phone = !screens.md;
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const passage = useUrlOverlay("passage");
  const docPreview = useUrlOverlay("doc");

  const selectedId = params.get("collection");
  const threadId = params.get("thread");
  const tab = params.get("tab") === "documents" ? "documents" : "ask";

  const list = useQuery({
    queryKey: queryKeys.knowledgeCollections(),
    queryFn: ({ signal }) => knowledgeApi.list({}, signal),
  });
  const overview = useQuery({
    queryKey: queryKeys.knowledgeOverview(),
    queryFn: ({ signal }) => knowledgeApi.overview(signal),
  });

  const collections = useMemo(() => list.data?.items ?? [], [list.data]);
  const activeId = selectedId ?? collections[0]?.id ?? null;

  const detail = useQuery({
    queryKey: queryKeys.knowledgeCollection(activeId),
    queryFn: ({ signal }) => knowledgeApi.get(activeId!, signal),
    enabled: Boolean(activeId),
    // Poll while anything is being read, so a file's status moves on its own.
    refetchInterval: (query) => (query.state.data?.documents.some(isReading) ? 2500 : false),
  });
  const collection = detail.data ?? null;

  // When the last reading finishes, the counts in the list are stale.
  const reading = collection?.documents.some(isReading) ?? false;
  useEffect(() => {
    if (!reading) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeCollections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeOverview() });
    }
  }, [reading, queryClient]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return needle
      ? collections.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(needle))
      : collections;
  }, [collections, term]);

  const save = useMutation({
    mutationFn: (input: CollectionInput) =>
      modal === "edit" && collection ? knowledgeApi.update(collection.id, input) : knowledgeApi.create(input),
    onSuccess: (saved) => {
      message.success(modal === "edit" ? "Collection saved" : "Collection created — add its files");
      setModal(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeCollections() });
      queryClient.setQueryData(queryKeys.knowledgeCollection(saved.id), saved);
      if (modal === "create") select(saved.id, "documents");
    },
    onError: (error: Error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => knowledgeApi.remove(id),
    onSuccess: () => {
      message.success("Collection removed — its files stay in Files");
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeCollections() });
      const next = new URLSearchParams(params);
      next.delete("collection");
      next.delete("thread");
      setParams(next, { replace: true });
    },
    onError: (error: Error) => message.error(error.message),
  });

  function select(id: string, nextTab?: "ask" | "documents") {
    const next = new URLSearchParams(params);
    next.set("collection", id);
    next.delete("thread");
    if (nextTab) next.set("tab", nextTab);
    else next.delete("tab");
    setParams(next);
  }
  function setTab(value: "ask" | "documents") {
    const next = new URLSearchParams(params);
    if (value === "ask") next.delete("tab");
    else next.set("tab", value);
    setParams(next, { replace: true });
  }
  function setThread(id: string | null) {
    const next = new URLSearchParams(params);
    if (activeId) next.set("collection", activeId);
    if (id) next.set("thread", id);
    else next.delete("thread");
    setParams(next);
  }

  // The citation being previewed: the one just clicked, or — after a reload
  // or from a pasted link — asked for by the passage id in the address.
  const [clicked, setClicked] = useState<Citation | null>(null);
  const fetched = useQuery({
    queryKey: queryKeys.knowledgePassage(activeId, passage.value),
    queryFn: ({ signal }) => knowledgeApi.passage(activeId!, passage.value!, signal),
    enabled: Boolean(activeId && passage.value && clicked?.chunk_id !== passage.value),
  });
  const cited = clicked?.chunk_id === passage.value ? clicked : (fetched.data ?? null);
  const previewDoc = collection?.documents.find((d) => d.id === docPreview.value) ?? null;
  const previewFileId = passage.value ? cited?.file_id : docPreview.value ? previewDoc?.file.id : null;
  const previewFile = useQuery({
    queryKey: queryKeys.knowledgePreviewFile(previewFileId),
    // The inline URL: looking is not downloading, and is not counted as one.
    queryFn: ({ signal }) => filesApi.previewUrl(previewFileId!, signal).then((r) => r.file),
    enabled: Boolean(previewFileId),
    staleTime: STALE.minute,
  });

  function openCitation(citation: Citation) {
    setClicked(citation);
    passage.open(citation.chunk_id);
  }
  function openDocument(document: KnowledgeDocument) {
    docPreview.open(document.id);
  }

  const canCreate = list.data?.can_create ?? can("knowledge.manage");

  usePageCommands("documents", [
    ...(canCreate
      ? [{ id: "documents-new", label: "New document collection", keywords: "knowledge upload files ai", run: () => setModal("create") }]
      : []),
    ...(collection
      ? [
          {
            id: "documents-ask",
            label: `Ask ${collection.name}`,
            keywords: "question documents ai",
            run: () => {
              setTab("ask");
              window.setTimeout(() => document.querySelector<HTMLTextAreaElement>("[data-testid=ask-input]")?.focus(), 50);
            },
          },
        ]
      : []),
  ]);
  const stats = overview.data;

  return (
    <div className="nu-page nx-kn" data-testid="documents-page">
      <PageHeader
        title={
          <>
            Ask your <em>documents</em>
          </>
        }
        subtitle={
          stats
            ? `${stats.collections} collection${stats.collections === 1 ? "" : "s"} · ${stats.documents} documents · ${stats.pages} pages read${stats.pending ? ` · ${stats.pending} being read` : ""}`
            : "Answers from your files, with every claim cited to its page"
        }
        actions={
          canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal("create")} data-testid="collection-new">
              New collection
            </Button>
          )
        }
      />

      <div className={`nx-kn-layout${phone ? " is-phone" : ""}`}>
        {phone ? (
          <Select
            className="nx-kn-picker"
            value={activeId ?? undefined}
            onChange={(id) => select(id)}
            placeholder="Choose a collection"
            aria-label="Collection"
            options={collections.map((c) => ({ value: c.id, label: c.name }))}
            data-testid="collection-picker"
          />
        ) : (
          <aside className="nx-kn-side nx-glass" data-testid="collection-list">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Find a collection"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
            {list.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}
            {!list.isLoading && !visible.length && (
              <EmptyState
                compact
                title={collections.length ? "No collection matches" : "No collections yet"}
                hint={canCreate ? "Create one and drop in the files people ask about." : "Nobody has shared one with you yet."}
              />
            )}
            <ul className="nx-kn-collections">
              {visible.map((item) => (
                <CollectionRow key={item.id} item={item} active={item.id === activeId} onSelect={() => select(item.id)} />
              ))}
            </ul>
          </aside>
        )}

        <section className="nx-kn-main nx-glass" data-testid="collection-detail">
          {!activeId && !list.isLoading && (
            <EmptyState
              title="Pick a collection, or make one"
              hint="A collection is a set of files with one audience. Questions are answered only from its files."
              action={
                canCreate && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal("create")}>
                    New collection
                  </Button>
                )
              }
            />
          )}
          {activeId && !collection && <Skeleton active paragraph={{ rows: 8 }} />}
          {collection && (
            <>
              <header className="nx-kn-head">
                <span className="nx-kn-head-mark" style={{ background: collection.color }}>
                  <KnIcon name="documents" size={18} />
                </span>
                <div className="nx-kn-head-text">
                  <h2 className="nx-kn-title" data-testid="collection-title">
                    {collection.name}
                  </h2>
                  <Text type="secondary" className="nx-kn-sub">
                    {[
                      SCOPE_LABEL[collection.scope],
                      collection.owner.name ? `owned by ${collection.owner.name}` : null,
                      `${collection.counts.ready} of ${collection.counts.documents} documents ready`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  {collection.description && <Text className="nx-kn-desc">{collection.description}</Text>}
                </div>
                {collection.can_edit && (
                  <div className="nx-kn-head-actions">
                    <Tooltip title="Edit name and audience">
                      <Button
                        shape="circle"
                        icon={<EditOutlined />}
                        aria-label="Edit collection"
                        onClick={() => setModal("edit")}
                        data-testid="collection-edit"
                      />
                    </Tooltip>
                    <Popconfirm
                      title="Remove this collection?"
                      description="Its conversations go with it; the files stay in Files."
                      okText="Remove"
                      onConfirm={() => remove.mutate(collection.id)}
                    >
                      <Button shape="circle" danger icon={<DeleteOutlined />} aria-label="Remove collection" />
                    </Popconfirm>
                  </div>
                )}
              </header>

              <Segmented
                className="nx-kn-tabs"
                value={tab}
                onChange={(value) => setTab(value as "ask" | "documents")}
                options={[
                  { value: "ask", label: "Ask" },
                  { value: "documents", label: `Documents · ${collection.counts.documents}` },
                ]}
                data-testid="collection-tabs"
              />

              {tab === "ask" ? (
                <AskPanel collection={collection} threadId={threadId} onThread={setThread} onCite={openCitation} />
              ) : (
                <DocumentsPanel
                  collection={collection}
                  supported={list.data?.supported_extensions ?? []}
                  maxBytes={list.data?.max_document_bytes}
                  onPreview={openDocument}
                />
              )}
            </>
          )}
        </section>
      </div>

      <CollectionModal
        open={modal !== null}
        initial={modal === "edit" ? collection : null}
        saving={save.isPending}
        onCancel={() => setModal(null)}
        onSubmit={(input) => save.mutate(input)}
      />

      <FilePreview
        open={Boolean((passage.value || docPreview.value) && previewFile.data)}
        file={(previewFile.data) ?? null}
        onClose={passage.value ? passage.close : docPreview.close}
        onDownload={(file) =>
          void filesApi.downloadUrl(file.id).then(({ download }) => window.open(download.url, "_blank"))
        }
        focus={
          passage.value && cited
            ? { page: cited.page, quote: cited.quote, boxes: cited.boxes }
            : null
        }
      />
    </div>
  );
}

function CollectionRow({ item, active, onSelect }: { item: Collection; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        className={`nx-kn-coll${active ? " is-active" : ""}`}
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        data-testid="collection-row"
      >
        <span className="nx-kn-coll-dot" style={{ background: item.color }} />
        <span className="nx-kn-coll-body">
          <span className="nx-kn-coll-name">{item.name}</span>
          <span className="nx-kn-coll-meta">
            {item.counts.documents} doc{item.counts.documents === 1 ? "" : "s"} · {SCOPE_LABEL[item.scope]}
            {item.last_asked_at ? ` · asked ${relativeTime(item.last_asked_at)}` : ""}
          </span>
        </span>
        {item.counts.pending > 0 && <span className="nx-kn-coll-busy" title="Being read" />}
      </button>
    </li>
  );
}
