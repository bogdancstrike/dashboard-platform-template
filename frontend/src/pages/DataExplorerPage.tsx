import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Popover,
  Segmented,
  Select,
  Skeleton,
  Tooltip,
  Typography,
} from "antd";
import {
  BarChartOutlined,
  BarsOutlined,
  BuildOutlined,
  ClearOutlined,
  ColumnHeightOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { usePageCommands } from "@/commands/CommandContext";
import { exportsApi, type ExportRequest } from "@/api/exports";
import {
  explorerApi,
  type ExplorerRequest,
  type ExplorerResource,
  type ExplorerView,
  type SavedSearch,
} from "@/api/explorer";
import { AdvancedSearchDrawer } from "@/components/explorer/AdvancedSearchDrawer";
import { ConditionChips } from "@/components/explorer/ConditionChips";
import { humanise } from "@/components/explorer/ConditionBuilder";
import { treeStats } from "@/components/explorer/conditionTree";
import { FdIcon } from "@/components/explorer/fdIcons";
import { NxIcon } from "@/components/NxIcon";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { RecordPreview } from "@/components/explorer/RecordPreview";
import { useBulk } from "@/components/records/useBulk";
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
import { AskData } from "@/components/assistant/DescribeFilters";
import { ExplorerResults, type ExplorerRecord } from "@/components/explorer/ExplorerResults";
import type { QueryNode } from "@/components/explorer/queryTree";
import { SavedSearchDrawer } from "@/components/explorer/SavedSearchDrawer";
import { SavedSearchForm } from "@/components/explorer/SavedSearchForm";
import { ExportButton } from "@/components/ExportButton";
import { PageHeader } from "@/components/PageHeader";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { errorText } from "@/lib/errors";
import { asText } from "@/lib/text";
import { FEATURES, useFeature } from "@/settings/features";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

const VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "list", label: "List" },
  { value: "cards", label: "Cards" },
  { value: "compact", label: "Compact" },
];

/**
 * Data Explorer is the canonical composition of platform query primitives.
 * Its entire state is URL-backed, so back/forward, bookmarks and shared links
 * reproduce the same question and presentation for another authorized user.
 */
export default function DataExplorerPage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  /** Two features of this page live behind flags (§27). */
  const advancedSearch = useFeature(FEATURES.advancedSearch);
  const bulkAllowed = useFeature(FEATURES.bulkOperations);
  const [saveOpen, setSaveOpen] = useState(false);
  // "Save as…" inside the advanced editor names the draft condition, which
  // by definition has not been run yet, so the modal is handed that tree
  // rather than the one behind it. `undefined` means "whatever is on screen".
  const [draftToSave, setDraftToSave] = useState<QueryNode | null | undefined>(undefined);
  //: The saved search being edited, if the form was opened from the panel.
  const [editing, setEditing] = useState<SavedSearch | undefined>(undefined);

  const catalogue = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
  });
  const resources = catalogue.data?.items ?? [];
  const requestedResource = params.get("resource") ?? "task";
  const resource = resources.find((item) => item.key === requestedResource) ?? resources[0];

  const view = asView(params.get("view"));
  const page = positiveInt(params.get("page"), 1);
  const pageSize = positiveInt(params.get("page_size"), 25);
  const queryText = params.get("q") ?? "";
  const tree = useMemo(() => parseTree(params.get("tree")), [params]);
  const filters = useMemo(() => parseFilters(params), [params]);
  const columns = useMemo(
    () => params.get("columns")?.split(",").filter(Boolean) ?? resource?.default_columns ?? [],
    [params, resource],
  );
  const sort = params.get("sort") ?? resource?.default_sort ?? "updated_at";
  const order = params.get("order") === "asc" ? "asc" : "desc";

  const groupBy = params.get("group") ?? "";
  const request = useMemo<ExplorerRequest | null>(() => resource ? ({
    resource_type: resource.key,
    query_text: queryText,
    condition_tree: tree,
    filters,
    columns,
    page,
    page_size: pageSize,
    sort,
    order,
    // Section headers count the whole result, not the rows on screen, and the
    // facet counts are where that number comes from.
    ...(groupBy ? { facets: true } : {}),
  }) : null, [resource, queryText, tree, filters, columns, page, pageSize, sort, order, groupBy]);
  const debouncedRequest = useDebouncedValue(request, 280);
  const results = useQuery({
    queryKey: ["explorer-results", debouncedRequest],
    queryFn: ({ signal }) => explorerApi.query(debouncedRequest!, signal),
    enabled: Boolean(debouncedRequest),
    placeholderData: (previous) => previous,
  });
  // True from the keystroke, not from the request: during the debounce the
  // numbers on screen already answer a question nobody is asking any more, and
  // saying so is the difference between "thinking" and "apparently ignored me".
  const settling = results.isFetching || request !== debouncedRequest;

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

  /**
   * List and card modes accumulate pages instead of replacing them (§52).
   *
   * The rows are held here rather than in the results component so that
   * changing the question — a new term, another filter — throws them away: a
   * "load more" that keeps rows from a question nobody is asking any more is
   * a list that quietly mixes two answers.
   */
  const scanning = view === "list" || view === "cards";
  const [scanned, setScanned] = useState<ExplorerRecord[]>([]);
  const questionKey = JSON.stringify({ ...request, page: undefined });

  useEffect(() => {
    setScanned([]);
  }, [questionKey, scanning]);

  useEffect(() => {
    if (!scanning || !results.data) return;
    setScanned((current) => {
      if (results.data.page === 1) return results.data.items;
      const seen = new Set(current.map((row) => row.id));
      return [...current, ...results.data.items.filter((row) => !seen.has(row.id))];
    });
  }, [scanning, results.data]);

  const loadMore = () => set({ page: (results.data?.page ?? 1) + 1 });

  const savedOpen = params.get("panel") === "saved";

  /**
   * Change part of the question, leaving the rest of the URL alone.
   *
   * Built from the *current* parameters rather than the ones this render
   * captured: two handlers firing in one tick — opening a saved search and
   * closing the panel it came from — would otherwise have the second write
   * back the state the first had just replaced, silently discarding it.
   */
  const set = (changes: Record<string, string | number | null>, replace = true, overlay = false) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === null || value === "") next.delete(key);
        else next.set(key, String(value));
      });
      return next;
    }, { replace, ...(overlay ? { state: { overlay: true } } : {}) });
  };

  /**
   * Drawers live in the address, pushed, so back walks out of them one at a
   * time — Saved → Rules → the page — on a browser and on a phone's gesture.
   * Closing with × is the same step back when this entry was pushed by an
   * open; arriving on a deep link, it just drops the parameter.
   */
  const openPanel = (changes: Record<string, string | null>) => set(changes, false, true);
  const pushed = Boolean((location.state as { overlay?: boolean } | null)?.overlay);
  const closePanel = (changes: Record<string, string | null>) => {
    if (pushed) navigate(-1);
    else set(changes);
  };
  const advancedOpen = params.get("panel") === "rules" && advancedSearch;
  const setAdvancedOpen = (open: boolean) => (open ? openPanel({ panel: "rules" }) : closePanel({ panel: null }));

  const chooseResource = (key: string) => {
    const next = new URLSearchParams();
    next.set("resource", key);
    setParams(next);
  };

  const openSaved = (saved: SavedSearch) => {
    const next = new URLSearchParams();
    next.set("resource", saved.resource_type);
    if (saved.query_text) next.set("q", saved.query_text);
    if (saved.condition_tree) next.set("tree", JSON.stringify(saved.condition_tree));
    Object.entries(saved.filters).forEach(([name, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        next.set(`f.${name}`, Array.isArray(value) ? value.join(",") : asText(value));
      }
    });
    next.set("columns", saved.columns.join(","));
    next.set("sort", saved.sort);
    next.set("order", saved.order);
    next.set("page_size", String(saved.page_size));
    next.set("view", saved.view_mode);
    next.set("saved", saved.id);
    // Everything, including closing the panel, in one write: `panel` is simply
    // absent from the parameters a saved search restores.
    setParams(next);
  };

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
    queryKey: ["explorer", "saved-link", savedInUrl],
    queryFn: ({ signal }) => explorerApi.openSaved(savedInUrl, signal),
    // Also fetched once the question is on screen, for its name in the title.
    enabled: Boolean(savedInUrl),
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

  /**
   * What this page can do, for the palette (§31).
   *
   * The page with the most controls on it had none of them here, which is
   * backwards: the palette earns its keystroke on the screens where the thing
   * you want is behind a picker you have to find first. Every command is the
   * same action the visible control performs — not a second implementation —
   * and the ones a flag has switched off are absent rather than offered and
   * refused (§27, §76).
   */
  usePageCommands("explore", [
    ...(advancedSearch
      ? [
          {
            id: "explore.advanced",
            label: "Build an advanced condition",
            icon: <BuildOutlined />,
            keywords: "query builder rule group nested and or filter",
            run: () => setAdvancedOpen(true),
          },
        ]
      : []),
    ...(activeFilterCount > 0
      ? [
          {
            id: "explore.clear",
            label: `Clear the question (${activeFilterCount} active)`,
            icon: <ClearOutlined />,
            keywords: "reset filters start over empty",
            run: clearQuestion,
          },
        ]
      : []),
    {
      id: "explore.save",
      label: "Save this as a search",
      icon: <SaveOutlined />,
      keywords: "saved search bookmark keep reuse share",
      run: () => {
        setDraftToSave(undefined);
        setEditing(undefined);
        setSaveOpen(true);
      },
    },
    {
      id: "explore.saved",
      label: "Open the saved searches",
      icon: <FolderOpenOutlined />,
      keywords: "saved views panel mine shared",
      run: () => openPanel({ panel: "saved" }),
    },
    ...VIEW_OPTIONS.filter((option) => option.value !== view).map((option) => ({
      id: `explore.view.${option.value}`,
      label: `Read as ${option.label.toLowerCase()}`,
      icon: <BarsOutlined />,
      keywords: "view mode layout table list cards compact",
      run: () => set({ view: option.value, page: null }),
    })),
    ...(resource
      ? [
          {
            id: "explore.analyse",
            label: `Analyse ${resource.label.toLowerCase()} instead`,
            icon: <BarChartOutlined />,
            keywords: "analytics group chart measure cut",
            run: () => navigate(`/analytics?resource=${resource.key}`),
          },
        ]
      : []),
    {
      id: "explore.refresh",
      label: "Ask the question again",
      icon: <ReloadOutlined />,
      keywords: "refresh reload rerun current",
      run: () => void results.refetch(),
    },
  ]);
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

  const header = (
    <PageHeader
      title={
        mode === "results" && savedName
          ? <span data-testid="explorer-title">{savedName}</span>
          : <>Data <em>explorer</em></>
      }
      subtitle={
        mode === "results"
          ? [
              resource?.label,
              stats.rules ? `${stats.rules} ${stats.rules === 1 ? "rule" : "rules"}${stats.groups ? ` in ${stats.groups + 1} groups` : ""}` : "",
              total !== undefined ? `${total.toLocaleString()} ${total === 1 ? "result" : "results"}` : "",
            ].filter(Boolean).join(" · ")
          : `Ask a question of ${allRecords.toLocaleString()} records — simply, or with rules and groups`
      }
      actions={
        <>
          <Button icon={<NxIcon name="heart" size={15} />} onClick={() => openPanel({ panel: "saved" })}>
            Saved searches
          </Button>
          {mode === "results" || !advancedSearch ? (
            <Button
              type="primary"
              icon={<NxIcon name="heart" size={15} />}
              data-testid="save-search"
              disabled={!request}
              onClick={() => setSaveOpen(true)}
            >
              Save search
            </Button>
          ) : null}
        </>
      }
    />
  );

  return (
    <div className={`nx-fd-explore nx-fd-explore--${mode}`}>
      {header}

      {catalogue.isError && (
        <Alert type="error" showIcon message="The explorer catalogue could not be loaded" description={errorText(catalogue.error)} />
      )}

      <>
          <section className="nx-fd-bar nx-glass nx-glass--strong nx-fd-slim" aria-label="Search">
            <div className="nx-fd-bar-row">
              {/* Rules sits where the dataset used to: the drawer it opens
                  starts with "Find [dataset] where …", so the dataset and the
                  conditions on it are chosen in one place, and the label keeps
                  both visible on the page. */}
              <Button
                className={`nx-fd-rulesbtn${tree ? " is-on" : ""}`}
                icon={<NxIcon name="filter" size={15} />}
                data-testid="open-rules"
                onClick={() => setAdvancedOpen(true)}
                aria-label={`Rules, ${stats.rules} ${stats.rules === 1 ? "rule" : "rules"}, on ${resource?.label ?? "this dataset"}`}
              >
                Rules
                {stats.rules > 0 && <span className="nx-fd-rulesn">· {stats.rules}</span>}
              </Button>
              <span className="nx-fd-rulesds" data-testid="rules-dataset">
                {catalogue.isLoading ? "…" : `in ${resource?.label ?? "—"}`}
              </span>
              {tree && (
                <button
                  type="button"
                  className="nx-fd-iconbtn is-plain"
                  aria-label="Remove the rules"
                  onClick={() => set({ tree: null, page: null })}
                >
                  <NxIcon name="close" size={14} />
                </button>
              )}
              <div className="nx-fd-q">
                <ExplorerSearch
                  dataset={resource?.key ?? "records"}
                  label={resource?.label.toLowerCase() ?? "records"}
                  value={queryText}
                  onChange={(next: string) => set({ q: next, page: null })}
                />
              </div>
              {/* AI (§23): "Ask" — a question becomes rules, reviewed in the Rules drawer. */}
              <AskData
                onReview={(key) =>
                  key === resource?.key ? openPanel({ panel: "rules" }) : setParams(new URLSearchParams({ resource: key, panel: "rules" }))
                }
              />
              <Button type="primary" className="nx-fd-go" icon={<NxIcon name="search" size={15} />} onClick={() => void results.refetch()}>
                Search
              </Button>
            </div>
            {mode === "start" && suggestions.length > 0 && (
              <div className="nx-fd-try nx-fd-try--slim">
                <span className="nx-fd-eyebrow">Try</span>
                {suggestions.map((item) => (
                  <button
                    key={`${item.field}:${item.value}`}
                    type="button"
                    className="nx-fd-trychip"
                    onClick={() => set({ [`f.${item.field}`]: item.value, page: null })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </section>

          {mode === "results" && resource && (
            <ConditionChips
              tree={tree}
              fields={resource.fields}
              extra={
                <>
                  {Object.entries(filters).map(([name, values]) => {
                    const field = resource.fields.find((item) => item.name === name);
                    return (
                      <span className="nx-fd-chiprule is-removable" key={name}>
                        <b>{field?.label ?? name}</b>
                        <span className="nx-fd-chipop">{values.length > 1 ? "is any of" : "is"}</span>
                        <b>{values.map((value) => (field?.kind === "enum" ? humanise(value) : value)).join(", ")}</b>
                        <button type="button" aria-label={`Remove ${field?.label ?? name}`} onClick={() => set({ [`f.${name}`]: null, page: null })}>
                          <NxIcon name="close" size={11} />
                        </button>
                      </span>
                    );
                  })}
                  {queryText && (
                    <span className="nx-fd-chiprule is-removable">
                      <b>Anything</b>
                      <span className="nx-fd-chipop">contains</span>
                      <b className="nx-fd-mono">“{queryText}”</b>
                      <button type="button" aria-label="Remove the search term" onClick={() => set({ q: null, page: null })}>
                        <NxIcon name="close" size={11} />
                      </button>
                    </span>
                  )}
                  {activeFilterCount > 0 && (
                    <button type="button" className="nx-fd-link nx-fd-clear" onClick={clearQuestion}>
                      <ClearOutlined /> Clear
                    </button>
                  )}
                </>
              }
            />
          )}

          {mode === "start" && resource && (
            <StartPanels
              dataset={resource.key}
              label={resource.label}
              onAsk={(term) => set({ q: term, page: null })}
            />
          )}

          <section className="nx-fd-results nx-glass" aria-label="Results">
            <div className="nx-fd-reshead">
              <div className="nx-fd-count">
                {mode === "start" ? (
                  <span className="nx-fd-h2">All {noun}</span>
                ) : (
                  <>
                    <span className="nx-fd-countn">{total === undefined ? "—" : total.toLocaleString()}</span>
                    <span className="nx-fd-countnoun">{noun}</span>
                  </>
                )}
                {results.data && (
                  <span
                    className={mode === "start" ? "nx-fd-pill nx-fd-pill--acc" : "nx-fd-sr"}
                    data-testid="explorer-match-count"
                  >
                    {results.data.total.toLocaleString()} {results.data.total === 1 ? "match" : "matches"}
                  </span>
                )}
                {resource && mode !== "start" && (
                  <span className="nx-fd-muted nx-fd-small">of {resource.record_count.toLocaleString()}</span>
                )}
                {settling && <Text type="secondary" data-testid="explorer-settling">Updating…</Text>}
              </div>
              <div className="nx-fd-restools">
                {sortable.length > 0 && (
                  <Select
                    className="nx-fd-sort"
                    aria-label="Sort by"
                    value={sort}
                    popupMatchSelectWidth={false}
                    onChange={(next: string) => set({ sort: next, page: null })}
                    labelRender={() => (
                      <span className="nx-fd-typelabel">
                        <span className="nx-fd-muted">Sort</span>
                        <b>{sortable.find((field) => field.name === sort)?.label ?? sort}</b>
                      </span>
                    )}
                    options={sortable.map((field) => ({ value: field.name, label: field.label }))}
                  />
                )}
                <Tooltip title={order === "asc" ? "Ascending — press for descending" : "Descending — press for ascending"}>
                  <Button
                    className="nx-fd-order"
                    aria-label={order === "asc" ? "Sorted ascending" : "Sorted descending"}
                    icon={<span style={{ display: "inline-flex", transform: order === "asc" ? "scaleY(-1)" : undefined }}><NxIcon name="chevronDown" size={14} /></span>}
                    onClick={() => set({ order: order === "asc" ? "desc" : "asc", page: null })}
                  />
                </Tooltip>
                <ColumnPicker resource={resource} value={columns} onChange={(next) => set({ columns: next.join(","), page: null })} />
                {scanning && (
                  <GroupPicker
                    resource={resource}
                    value={groupBy}
                    onChange={(next) => set({ group: next || null, page: null })}
                  />
                )}
                <Segmented
                  className="nx-fd-views"
                  data-testid="view-mode"
                  value={view}
                  options={VIEW_OPTIONS}
                  onChange={(next) => set({ view: String(next), page: null })}
                />
                {/* Exports the question, not the page — the same request the
                    results came from, without its LIMIT. And when that question
                    is too large to download, `onQueue` asks it again as a
                    background export rather than leaving the refusal as the
                    answer (§30). Both take the same request, which is what makes
                    the queued file provably the query on screen. */}
                <ExportButton
                  disabled={!request}
                  onExport={(format) =>
                    explorerApi.export({ ...request!, page: 1, format })
                  }
                  onQueue={async (format) => {
                    const made = await exportsApi.queue({
                      ...(request as unknown as ExportRequest),
                      format,
                    });
                    message.success(
                      `${made.reference} queued. It will appear on the Exports page.`,
                    );
                    navigate("/exports");
                  }}
                />
              </div>
            </div>
            {results.isError && (
              <Alert style={{ marginBottom: 12 }} type="error" showIcon message="This question could not be run" description={errorText(results.error)} />
            )}
            {/* Above the rows it acts on, and only once something is ticked. A bar
                that is always there is a bar nobody reads when it matters. */}
            {bulkAllowed && bulk.bar}
            {!resource && catalogue.isLoading ? (
              <Skeleton active paragraph={{ rows: 8 }} />
            ) : !resource ? (
              <EmptyState title="Your role has no explorable datasets" />
            ) : (
              <ExplorerResults
                result={results.data}
                view={view}
                loading={results.isLoading}
                {...(scanning
                  ? { rows: scanned, groupBy, onLoadMore: loadMore, loadingMore: results.isFetching }
                  : {})}
                onPage={(nextPage, nextSize) => set({ page: nextPage, page_size: nextSize })}
                onSort={(field, direction) => set({ sort: field, order: direction, page: null })}
                onPreview={(record) => openPanel({ record: record.id, resource: results.data?.resource_type ?? requestedResource })}
                // Ticking is offered only in the table. A card grid with tick
                // boxes on it is a table wearing a costume, and the scanning views
                // exist for reading rather than for acting (§6).
                {...(view === "table" && bulkAllowed ? { selection: bulk.rowSelection } : {})}
                starrable
                path={resource?.path ?? ""}
              />
            )}
          </section>
      </>

      {resource && request && advancedSearch && (
        <AdvancedSearchDrawer
          open={advancedOpen}
          fields={resource.fields}
          request={request}
          datasetLabel={resource.label}
          recordCount={resource.record_count}
          resources={resources}
          onChooseResource={chooseResource}
          onOpenSaved={() => openPanel({ panel: "saved", from: "rules" })}
          onClose={closeRules}
          onSearch={(next) => set({ tree: next ? JSON.stringify(next) : null, page: null, panel: null })}
          onSave={(next) => {
            setDraftToSave(next);
            setSaveOpen(true);
          }}
        />
      )}

      {bulk.dialog}

      <RecordPreview
        resourceType={requestedResource}
        recordId={previewId}
        term={queryText}
        onClose={() => closePanel({ record: null })}
      />

      <SavedSearchDrawer
        open={savedOpen}
        resourceType={resource?.key ?? ""}
        onClose={() => closePanel({ panel: null, from: null })}
        {...(params.get("from") === "rules"
          ? { onBack: () => closePanel({ panel: "rules", from: null }), backLabel: "Rules" }
          : {})}
        onOpen={openSaved}
        onEdit={(search) => {
          setEditing(search);
          setSaveOpen(true);
        }}
      />
      {saveValue && (
        <SavedSearchForm
          open={saveOpen}
          value={editing ? savedQuestion(editing) : saveValue}
          {...(editing ? { search: editing } : {})}
          onClose={() => {
            setSaveOpen(false);
            setDraftToSave(undefined);
            setEditing(undefined);
          }}
          // Saving a draft also runs it: a search worth naming is one the
          // person is about to look at, and leaving the page showing something
          // else would make the saved name refer to rows nobody can see.
          onSaved={(saved) => {
            // Editing changes the name or the audience, not the question on
            // screen; only a freshly saved draft has a new question to show.
            if (!editing) {
              set({
                ...(draftToSave !== undefined
                  ? { tree: draftToSave ? JSON.stringify(draftToSave) : null }
                  : {}),
                saved: saved.id,
              });
            }
            setDraftToSave(undefined);
            setEditing(undefined);
          }}
          onTransferred={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

/**
 * "Try" chips for the start screen: real values of the dataset's first two
 * choice fields, each one a filter that reproduces it. Never the design's
 * sample sentences — a chip that answers nothing is a chip nobody presses twice.
 */
function trySuggestions(resource?: ExplorerResource) {
  if (!resource) return [];
  const enums = resource.fields.filter((field) => field.kind === "enum" && field.filterable && field.choices.length > 0).slice(0, 2);
  return enums.flatMap((field) =>
    field.choices.slice(0, 3).map((value) => ({
      field: field.name,
      value,
      label: `${field.label.toLowerCase()}: ${humanise(value).toLowerCase()}`,
    })),
  ).slice(0, 5);
}

/**
 * What you asked before and what you saved, as one compact line of chips
 * under the search bar — never more than a row, so the results stay where
 * the eye expects them. Overflow folds into "+N more"; the saved overflow
 * opens the saved-search drawer.
 */
const RECENT_SHOWN = 4;

function StartPanels({ dataset, label, onAsk }: {
  dataset: string;
  label: string;
  onAsk: (term: string) => void;
}) {
  const recent = useRecentSearches(dataset);
  const [allRecent, setAllRecent] = useState(false);
  const terms = allRecent ? recent.terms : recent.terms.slice(0, RECENT_SHOWN);
  const moreRecent = recent.terms.length - RECENT_SHOWN;

  if (recent.terms.length === 0) return null;

  return (
    <div className={`nx-fd-quick${allRecent ? " is-open" : ""}`} aria-label={`Recent searches in ${label.toLowerCase()}`}>
      {recent.terms.length > 0 && (
        <div className="nx-fd-quickgroup" role="group" aria-labelledby="nx-fd-recent">
          <h2 id="nx-fd-recent" className="nx-fd-eyebrow">Recent searches</h2>
          {terms.map((term) => (
            <span className="nx-fd-qchip" key={term}>
              <button type="button" className="nx-fd-qchip-main" onClick={() => onAsk(term)}>
                <FdIcon name="clock" size={12} />
                {term}
              </button>
              <button type="button" className="nx-fd-qchip-x" aria-label={`Remove recent search: ${term}`} onClick={() => recent.forget(term)}>
                <NxIcon name="close" size={10} />
              </button>
            </span>
          ))}
          {moreRecent > 0 && (
            <button type="button" className="nx-fd-qmore" onClick={() => setAllRecent((open) => !open)}>
              {allRecent ? "Fewer" : `+${moreRecent} more`}
            </button>
          )}
          <button type="button" className="nx-fd-link nx-fd-tiny" onClick={recent.clear}>Clear</button>
        </div>
      )}
    </div>
  );
}

/**
 * Section the scanning modes by one field (§6).
 *
 * Offered only for fields declared as facets, because those are the ones with
 * a small enough vocabulary to be worth reading as headings — grouping a list
 * by "Title" produces one section per row.
 */
function GroupPicker({ resource, value, onChange }: {
  resource?: ExplorerResource;
  value: string;
  onChange: (field: string) => void;
}) {
  const options = (resource?.fields ?? [])
    .filter((field) => field.facet)
    .map((field) => ({ value: field.name, label: `Group by ${field.label.toLowerCase()}` }));
  if (options.length === 0) return null;

  return (
    <Select
      allowClear
      className="nu-group-select"
      aria-label="Group results"
      data-testid="group-select"
      placeholder="No grouping"
      value={value || undefined}
      onChange={(next) => onChange(next ?? "")}
      options={options}
    />
  );
}

function ColumnPicker({ resource, value, onChange }: {
  resource?: ExplorerResource;
  value: string[];
  onChange: (columns: string[]) => void;
}) {
  const options = resource?.fields.map((field) => ({ label: field.label, value: field.name })) ?? [];
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Visible columns"
      content={
        <Checkbox.Group
          className="nu-column-picker"
          value={value}
          options={options}
          onChange={(next) => next.length && onChange(next.map(String))}
        />
      }
    >
      <Button icon={<ColumnHeightOutlined />}>Columns</Button>
    </Popover>
  );
}

/**
 * The question a saved search stores, in the shape the form saves back.
 *
 * Editing a saved search must not silently rewrite its question to whatever
 * happens to be on screen: renaming somebody's "Critical work" should not turn
 * it into the customer list the editor was looking at when they renamed it.
 */
function savedQuestion(search: SavedSearch) {
  return {
    resource_type: search.resource_type,
    condition_tree: search.condition_tree,
    filters: search.filters,
    query_text: search.query_text,
    sort: search.sort,
    order: search.order,
    columns: search.columns,
    page_size: search.page_size,
    view_mode: search.view_mode,
  };
}

function parseTree(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseFilters(params: URLSearchParams): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  params.forEach((value, key) => {
    if (key.startsWith("f.") && value) out[key.slice(2)] = value.split(",").filter(Boolean);
  });
  return out;
}

function asView(value: string | null): ExplorerView {
  return value === "list" || value === "cards" || value === "compact" ? value : "table";
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

