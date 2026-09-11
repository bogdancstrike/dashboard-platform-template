import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Checkbox,
  Popover,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  BarsOutlined,
  BuildOutlined,
  ClearOutlined,
  ColumnHeightOutlined,
  FolderOpenOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";

import { exportsApi, type ExportRequest } from "@/api/exports";
import {
  explorerApi,
  type ExplorerRequest,
  type ExplorerResource,
  type ExplorerView,
  type SavedSearch,
} from "@/api/explorer";
import { AdvancedSearchDrawer } from "@/components/explorer/AdvancedSearchDrawer";
import { RecordPreview } from "@/components/explorer/RecordPreview";
import { useBulk } from "@/components/records/useBulk";
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const set = (changes: Record<string, string | number | null>, replace = true) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === null || value === "") next.delete(key);
        else next.set(key, String(value));
      });
      return next;
    }, { replace });
  };

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
    enabled: Boolean(savedInUrl) && !hasQuestion,
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

  return (
    <>
      <PageHeader
        title="Data Explorer"
        subtitle="Ask precise questions across platform datasets. Every filter, sort and condition executes in PostgreSQL."
        tag={results.data && (
          <Tag color="blue" data-testid="explorer-match-count">
            {results.data.total.toLocaleString()} matches
          </Tag>
        )}
        actions={
          <>
            <Button icon={<FolderOpenOutlined />} onClick={() => set({ panel: "saved" })}>
              Saved searches
            </Button>
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
            <Button
              type="primary"
              icon={<SaveOutlined />}
              data-testid="save-search"
              disabled={!request}
              onClick={() => setSaveOpen(true)}
            >
              Save
            </Button>
          </>
        }
      />

      {catalogue.isError && (
        <Alert type="error" showIcon message="The explorer catalogue could not be loaded" description={errorText(catalogue.error)} />
      )}

      <Card className="nu-explorer-controls" size="small">
        <div className="nu-explorer-toolbar">
          <Select
            className="nu-resource-select"
            aria-label="Dataset"
            data-testid="dataset-select"
            value={resource?.key}
            loading={catalogue.isLoading}
            onChange={chooseResource}
            options={resources.map((item) => ({
              value: item.key,
              label: <Space><span>{item.label}</span><Text type="secondary">{item.record_count.toLocaleString()}</Text></Space>,
            }))}
            optionRender={(option) => {
              const item = resources.find((candidate) => candidate.key === option.value);
              return <div><div>{item?.label}</div><Text type="secondary">{item?.description}</Text></div>;
            }}
          />
          <ExplorerSearch
            dataset={resource?.key ?? "records"}
            label={resource?.label.toLowerCase() ?? "records"}
            value={queryText}
            onChange={(next: string) => set({ q: next, page: null })}
          />
          {/* Behind a flag (§27), and hidden rather than disabled: a control
              a platform has switched off is not a control the reader failed
              to qualify for. Their simple search and their filters are
              untouched — a flag gates a feature, never access. */}
          {advancedSearch && (
            <Badge count={activeFilterCount} size="small">
              <Button icon={<BuildOutlined />} onClick={() => setAdvancedOpen(true)}>
                Advanced
              </Button>
            </Badge>
          )}
          <ColumnPicker resource={resource} value={columns} onChange={(next) => set({ columns: next.join(","), page: null })} />
          {scanning && (
            <GroupPicker
              resource={resource}
              value={groupBy}
              onChange={(next) => set({ group: next || null, page: null })}
            />
          )}
          {activeFilterCount > 0 && <Button icon={<ClearOutlined />} onClick={clearQuestion}>Clear</Button>}
        </div>
      </Card>

      <Card
        className="nu-explorer-results"
        title={
          <Space>
            <BarsOutlined />
            <span>{resource?.label ?? "Results"}</span>
            {settling && <Text type="secondary" data-testid="explorer-settling">Updating…</Text>}
          </Space>
        }
        extra={
          <Segmented
            size="small"
            data-testid="view-mode"
            value={view}
            options={VIEW_OPTIONS}
            onChange={(next) => set({ view: String(next), page: null })}
          />
        }
      >
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
            onPreview={(record) => set({ record: record.id, resource: results.data?.resource_type ?? requestedResource }, false)}
            // Ticking is offered only in the table. A card grid with tick
            // boxes on it is a table wearing a costume, and the scanning views
            // exist for reading rather than for acting (§6).
            {...(view === "table" && bulkAllowed ? { selection: bulk.rowSelection } : {})}
            starrable
            path={resource?.path ?? ""}
          />
        )}
      </Card>

      {resource && request && advancedSearch && (
        <AdvancedSearchDrawer
          open={advancedOpen}
          fields={resource.fields}
          request={request}
          onClose={() => setAdvancedOpen(false)}
          onSearch={(next) => set({ tree: next ? JSON.stringify(next) : null, page: null })}
          onSave={(next) => {
            setAdvancedOpen(false);
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
        onClose={() => set({ record: null })}
      />

      <SavedSearchDrawer
        open={savedOpen}
        resourceType={resource?.key ?? ""}
        onClose={() => set({ panel: null })}
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
    </>
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

