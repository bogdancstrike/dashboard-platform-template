/** What the page reads, what it keeps in the address, and what it derives. */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { App as AntApp, Grid } from "antd";

import { filesApi } from "@/api/files";
import {
  isReading,
  knowledgeApi,
  type Citation,
  type CollectionInput,
  type KnowledgeDocument,
} from "@/api/knowledge";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** The page's state, queries and actions. */
export function useDocumentsPage() {
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
      modal === "edit" && collection
        ? knowledgeApi.update(collection.id, input)
        : knowledgeApi.create(input),
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
  const previewFileId = passage.value
    ? cited?.file_id
    : docPreview.value
      ? previewDoc?.file.id
      : null;
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
      ? [
          {
            id: "documents-new",
            label: "New document collection",
            keywords: "knowledge upload files ai",
            run: () => setModal("create"),
          },
        ]
      : []),
    ...(collection
      ? [
          {
            id: "documents-ask",
            label: `Ask ${collection.name}`,
            keywords: "question documents ai",
            run: () => {
              setTab("ask");
              window.setTimeout(
                () =>
                  document.querySelector<HTMLTextAreaElement>("[data-testid=ask-input]")?.focus(),
                50,
              );
            },
          },
        ]
      : []),
  ]);
  const stats = overview.data;

  return {
    phone,
    term,
    setTerm,
    modal,
    setModal,
    passage,
    docPreview,
    threadId,
    tab,
    list,
    collections,
    activeId,
    detail,
    collection,
    visible,
    save,
    remove,
    select,
    setTab,
    setThread,
    cited,
    previewFile,
    openCitation,
    openDocument,
    canCreate,
    stats,
  };
}

export type DocumentsPageData = ReturnType<typeof useDocumentsPage>;
