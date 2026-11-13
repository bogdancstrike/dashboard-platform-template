import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { explorerApi, type SavedSearch } from "@/api/explorer";
import { treeStats } from "@/components/explorer/conditionTree";
import type { QueryNode } from "@/components/explorer/queryTree";
import { useBulk } from "@/components/records/useBulk";
import { queryKeys } from "@/lib/queryKeys";
import { FEATURES, useFeature } from "@/settings/features";

import { trySuggestions } from "./explorerUrl";
import { useExplorerNav } from "./useExplorerNav";
import { useExplorerQuery } from "./useExplorerQuery";
import { useScannedRows } from "./useScannedRows";

/**
 * Everything the explorer decides — the question, its answer, which drawer is
 * open, what a save would store — with the URL as the only state that
 * matters. The page and its parts draw it.
 */
export function useExplorerPage() {
  /** Two features of this page live behind flags (§27). */
  const advancedSearch = useFeature(FEATURES.advancedSearch);
  const bulkAllowed = useFeature(FEATURES.bulkOperations);
  const savedOn = useFeature(FEATURES.savedViews);
  const [saveOpen, setSaveOpen] = useState(false);
  // "Save as…" inside the advanced editor names the draft condition, which
  // by definition has not been run yet, so the modal is handed that tree
  // rather than the one behind it. `undefined` means "whatever is on screen".
  const [draftToSave, setDraftToSave] = useState<QueryNode | null | undefined>(undefined);
  //: The saved search being edited, if the form was opened from the panel.
  const [editing, setEditing] = useState<SavedSearch | undefined>(undefined);

  const nav = useExplorerNav();
  const { params, setParams, set, openPanel, closePanel, openSaved } = nav;
  const query = useExplorerQuery(params);
  const { resources, resource, view, results, debouncedRequest, request, tree, filters, queryText } = query;

  /**
   * One change over many records (§43, §75).
   *
   * The same hook the entity lists use, given the explorer's *own* request —
   * which is what makes "select everything matching" mean the question on
   * screen rather than a hand-built copy of it. The explorer is where a
   * reader composes the narrowest question they can; acting on the answer
   * without re-finding it somewhere else is the point.
   */
  const bulk = useBulk(resource, {
    request: debouncedRequest,
    total: results.data?.total ?? 0,
  });

  /** The record shown in the preview drawer, if any. */
  const previewId = params.get("record") ?? "";
  const { scanning, scanned } = useScannedRows(view, request, results);

  const loadMore = () => set({ page: (results.data?.page ?? 1) + 1 });

  const savedOpen = params.get("panel") === "saved";
  const advancedOpen = params.get("panel") === "rules" && advancedSearch;
  const setAdvancedOpen = (open: boolean) => (open ? openPanel({ panel: "rules" }) : closePanel({ panel: null }));

  /**
   * A saved search named in the URL and nothing else: load it and apply it.
   *
   * What makes a saved search *linkable*, which §5 asks for and which it was
   * not: `openSaved` writes the whole question into the URL and adds `saved`
   * as a marker of provenance, but nothing ever read that marker back — so
   * `/explore?saved=<id>` opened an empty explorer, and `/search/saved/:id`
   * redirected here while discarding the id entirely. A bookmark to a saved
   * search therefore opened the explorer and not the search, which
   * `/favorites` (§38) made visible.
   *
   * Guarded on the URL carrying no question of its own, so this only fires
   * for a bare link — applying it over a question somebody has since edited
   * would throw their edit away.
   */
  const savedInUrl = params.get("saved") ?? "";
  const hasQuestion = params.has("columns") || params.has("tree") || params.has("q");
  const savedLink = useQuery({
    queryKey: queryKeys.explorer("saved-link", savedInUrl),
    queryFn: ({ signal }) => explorerApi.openSaved(savedInUrl, signal),
    // Also fetched once the question is on screen, for its name in the title.
    enabled: Boolean(savedInUrl) && savedOn,
  });

  useEffect(() => {
    if (savedLink.data && !hasQuestion) openSaved(savedLink.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedLink.data, hasQuestion]);

  const clearQuestion = () => {
    const next = new URLSearchParams();
    if (resource) next.set("resource", resource.key);
    setParams(next);
  };

  const activeFilterCount = Object.keys(filters).length + (tree ? 1 : 0) + (queryText ? 1 : 0);

  /**
   * Which of the three screens this is (the design's start / results /
   * advanced). Start and results are one tree with the same search box in the
   * same place, so the first keystroke turns one into the other without the
   * box losing focus; advanced is its own page, `?mode=advanced`.
   */
  const mode: "start" | "results" = activeFilterCount > 0 || Boolean(savedInUrl) ? "results" : "start";

  /**
   * `?mode=advanced` is a link straight into the rules: it opens the drawer
   * over the results, and closing the drawer drops it from the address.
   */
  // The old deep link, `?mode=advanced`, now means "with the rules open".
  const askedForRules = params.get("mode") === "advanced" && advancedSearch;
  useEffect(() => {
    if (askedForRules) set({ mode: null, panel: "rules" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedForRules]);
  const closeRules = () => closePanel({ panel: null });

  const saveValue = request ? {
    resource_type: request.resource_type,
    condition_tree: draftToSave !== undefined ? draftToSave : request.condition_tree ?? null,
    filters: request.filters ?? {},
    query_text: request.query_text ?? "",
    sort: request.sort ?? resource?.default_sort ?? "updated_at",
    order: request.order ?? "desc" as const,
    columns: request.columns ?? resource?.default_columns ?? [],
    page_size: request.page_size ?? 25,
    view_mode: view,
  } : null;

  const savedName = savedLink.data && savedLink.data.id === savedInUrl ? savedLink.data.name : "";
  const stats = treeStats(tree);
  const total = results.data?.total;
  const noun = resource?.label.toLowerCase() ?? "records";
  const allRecords = resources.reduce((sum, item) => sum + item.record_count, 0);
  const sortable = resource?.fields.filter((field) => field.sortable) ?? [];
  const suggestions = trySuggestions(resource);

  return {
    ...nav, ...query, advancedSearch, bulkAllowed, savedOn, saveOpen, setSaveOpen, draftToSave, setDraftToSave,
    editing, setEditing, bulk, previewId, scanning, scanned, loadMore, savedOpen, advancedOpen, setAdvancedOpen,
    savedInUrl, savedLink, clearQuestion, activeFilterCount, mode, closeRules, saveValue, savedName, stats, total,
    noun, allRecords, sortable, suggestions,
  };
}

export type ExplorerPage = ReturnType<typeof useExplorerPage>;
