/** What the page reads, what it keeps in the address, and what it derives. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { App as AntApp } from "antd";

import { ApiError } from "@/api/client";
import { insightsApi, type InsightDraft, type SavedInsight } from "@/api/insights";
import { useSmartBack } from "@/app/history";
import { usePageCommands } from "@/commands/CommandContext";
import type { DashboardSubject } from "@/components/dashboards/AddToDashboard";
import { queryKeys } from "@/lib/queryKeys";

/** The page's state, queries and actions. */
export function useInsightsPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const back = useSmartBack();
  const [params, setParams] = useSearchParams();
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<InsightDraft | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [dashboardFor, setDashboardFor] = useState<DashboardSubject | null>(null);
  const [filter, setFilter] = useState<"all" | "mine">("all");

  const openId = params.get("insight");
  const showingDraft = params.get("draft") === "1" && draft !== null;

  const list = useQuery({
    queryKey: queryKeys.insights(),
    queryFn: ({ signal }) => insightsApi.list({}, signal),
  });
  const saved = useQuery({
    queryKey: queryKeys.insight(openId),
    queryFn: ({ signal }) => insightsApi.get(openId!, false, signal),
    enabled: Boolean(openId),
  });

  function openDraft(next: InsightDraft) {
    setDraft(next);
    const search = new URLSearchParams();
    search.set("draft", "1");
    setParams(search);
  }
  function openSaved(id: string) {
    setParams(new URLSearchParams({ insight: id }));
  }

  const failed = (error: Error) => {
    const unavailable = error instanceof ApiError && [429, 503, 504].includes(error.status);
    setFailure(
      unavailable
        ? "The AI model is not available right now. Try again in a moment, or pick a suggestion — those need no model."
        : error.message,
    );
  };
  const generate = useMutation({
    mutationFn: (text: string) => insightsApi.generate(text),
    onMutate: () => setFailure(null),
    onSuccess: openDraft,
    onError: failed,
  });
  const suggest = useMutation({
    mutationFn: (key: string) => insightsApi.suggestion(key),
    onMutate: () => setFailure(null),
    onSuccess: (result) => {
      setQuestion(result.question);
      openDraft(result);
    },
    onError: failed,
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.insights() });
  const save = useMutation({
    mutationFn: (current: InsightDraft) => insightsApi.save(current),
    onSuccess: (result) => {
      message.success("Insight saved");
      invalidate();
      queryClient.setQueryData(queryKeys.insight(result.id), result);
      setDraft(null);
      setParams(new URLSearchParams({ insight: result.id }), { replace: true });
    },
    onError: (error: Error) => message.error(error.message),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof insightsApi.update>[1] }) =>
      insightsApi.update(id, input),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.insight(result.id), result);
      invalidate();
    },
    onError: (error: Error) => message.error(error.message),
  });
  const refresh = useMutation({
    mutationFn: (id: string) => insightsApi.refresh(id),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.insight(result.id), result);
      message.success("Numbers re-read");
      invalidate();
    },
    onError: (error: Error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => insightsApi.remove(id),
    onSuccess: () => {
      message.success("Insight removed");
      invalidate();
      setParams(new URLSearchParams(), { replace: true });
    },
    onError: (error: Error) => message.error(error.message),
  });

  usePageCommands("insights", [
    {
      id: "insights-ask",
      label: "Ask a question about your data",
      keywords: "insight ai chart generate",
      run: () =>
        document.querySelector<HTMLInputElement>("[data-testid=insight-question]")?.focus(),
    },
  ]);

  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    return filter === "mine" ? all.filter((item) => item.can_edit) : all;
  }, [list.data, filter]);
  const busy = generate.isPending || suggest.isPending;
  const current: SavedInsight | InsightDraft | null = openId
    ? (saved.data ?? null)
    : showingDraft
      ? draft
      : null;

  function ask(text = question) {
    const trimmed = text.trim();
    if (trimmed && !busy) generate.mutate(trimmed);
  }

  return {
    message,
    back,
    question,
    setQuestion,
    failure,
    renaming,
    setRenaming,
    dashboardFor,
    setDashboardFor,
    filter,
    setFilter,
    openId,
    list,
    saved,
    openSaved,
    generate,
    suggest,
    save,
    update,
    refresh,
    remove,
    items,
    busy,
    current,
    ask,
  };
}

export type InsightsPageData = ReturnType<typeof useInsightsPage>;
