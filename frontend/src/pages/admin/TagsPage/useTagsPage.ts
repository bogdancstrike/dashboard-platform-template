import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { Tag } from "@/api/tags";
import { tagsApi } from "@/api/tags";
import { usePageCommands } from "@/commands/CommandContext";
import { apiMessageToast } from "@/lib/errors";
import { formatNumber } from "@/lib/formats";
import { queryKeys } from "@/lib/queryKeys";
import { refreshRecordViews } from "@/lib/refresh";

/** The vocabulary, the category in the address, and removing a tag. */
export function useTagsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Tag | "new" | null>(null);

  const query = useQuery({
    queryKey: queryKeys.tagVocabulary(),
    queryFn: ({ signal }) => tagsApi.vocabulary(signal),
  });
  const vocabulary = query.data;

  usePageCommands("tags", [
    {
      id: "tags.new",
      label: "Add a tag to the vocabulary",
      keywords: "tag label new create",
      run: () => setEditing("new"),
    },
    {
      id: "tags.all",
      label: "Show the whole vocabulary",
      keywords: "tags all clear filter category every",
      run: () => setParams(new URLSearchParams()),
    },
    {
      id: "tags.unused",
      label: "Find the tags nobody uses",
      keywords: "tags unused retire empty zero prune",
      // Sorted rather than filtered: a tag at zero is a candidate for
      // retirement, not a mistake, so the page shows them first rather than
      // showing them alone.
      run: () => setParams(new URLSearchParams({ sort: "usage", order: "asc" })),
    },
    {
      id: "tags.records",
      label: "See the records that carry tags",
      keywords: "explore records tagged labelled find",
      run: () => navigate("/explore"),
    },
  ]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tagVocabulary() });
    // Every record's chips and every list's rows carry tag names.
    void queryClient.invalidateQueries({ queryKey: queryKeys.recordTags() });
    refreshRecordViews(queryClient);
  };

  const remove = useMutation({
    mutationFn: (tag: Tag) => tagsApi.remove(tag.id),
    onSuccess: (answer) => {
      message.success(
        answer.records
          ? `${answer.name} removed from ${formatNumber(answer.records)} records`
          : `${answer.name} removed`,
      );
      refresh();
    },
    onError: apiMessageToast(message, "That tag could not be removed."),
  });

  const rows = useMemo(
    () =>
      (vocabulary?.items ?? []).filter((tag) => !category || tag.category === category),
    [vocabulary, category],
  );

  const confirmRemove = (tag: Tag) => {
    modal.confirm({
      title: `Remove “${tag.name}”?`,
      // The consequence in the question: "remove urgent" and "remove urgent
      // from nine records" are different decisions.
      content: tag.usage_count
        ? `It comes off ${formatNumber(tag.usage_count)} records. Nothing else about them changes.`
        : "It is on nothing, so nothing else changes.",
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: () => remove.mutate(tag),
    });
  };

  const chooseCategory = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("category");
    else next.set("category", value);
    setParams(next, { replace: true });
  };

  return { query, vocabulary, category, rows, editing, setEditing, refresh, confirmRemove, chooseCategory };
}
