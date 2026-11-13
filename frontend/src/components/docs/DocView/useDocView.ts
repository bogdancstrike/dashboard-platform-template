import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { docsApi, type DocBlock, type DocBlockKind, type DocPage } from "@/api/docs";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";

import { newDocBlock } from "../blocks";
import { FEATURES, useFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";
import { apiMessageToast } from "@/lib/errors";

const SAVE_AFTER_MS = 1000;

export interface Draft {
  title: string;
  icon: string | null;
  blocks: DocBlock[];
}

/**
 * A wiki page's state: the page, the draft being edited (saved a moment after
 * the last change, refused if somebody else saved first), linking, summarising,
 * turning action items into tasks, and deleting the page.
 */
export function useDocView(pageId: string, onDeleted: (spaceId: string) => void) {
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

  const setEditing = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set("edit", "1");
    else next.delete("edit");
    setParams(next, { replace: true });
    if (!on && dirty && draft) save.mutate(draft);
  };

  const move = (index: number, step: number) => {
    if (!draft) return;
    const blocks = [...draft.blocks];
    const [item] = blocks.splice(index, 1);
    blocks.splice(index + step, 0, item!);
    setBlocks(blocks);
  };
  const insertAt = (index: number, kind: DocBlockKind) => {
    if (!draft) return;
    const blocks = [...draft.blocks];
    blocks.splice(index, 0, newDocBlock(kind));
    setBlocks(blocks);
  };
  const tick = (blocks: DocBlock[]) => {
    if (!draft) return;
    const next = { ...draft, blocks };
    setDraft(next);
    save.mutate(next);
  };

  return { queryClient, navigate, message, modal, params, setParams, history, editing, draft, setDraft, dirty, setDirty, conflict, setConflict, linking, setLinking, summary, setSummary, version, page, data, people, accept, save, change, setBlocks, createTask, runTask, unlink, link, summariesOn, summarise, remove, setEditing, move, insertAt, tick };
}

export type DocViewModel = ReturnType<typeof useDocView>;
