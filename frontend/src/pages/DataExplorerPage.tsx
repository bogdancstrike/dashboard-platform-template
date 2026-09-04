import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
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
import { useSearchParams } from "react-router-dom";

import {
  explorerApi,
  type ExplorerRequest,
  type ExplorerResource,
  type ExplorerView,
  type SavedSearch,
} from "@/api/explorer";
import { AdvancedSearchDrawer } from "@/components/explorer/AdvancedSearchDrawer";
import { RecordPreview } from "@/components/explorer/RecordPreview";
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
import { ExplorerResults, type ExplorerRecord } from "@/components/explorer/ExplorerResults";
import type { QueryNode } from "@/components/explorer/queryTree";
import { SavedSearchDrawer } from "@/components/explorer/SavedSearchDrawer";
import { SavedSearchForm } from "@/components/explorer/SavedSearchForm";
import { PageHeader } from "@/components/PageHeader";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

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
  const [params, setParams] = useSearchParams();
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  /** The record shown in the preview drawer, if any. */
  const [preview, setPreview] = useState<ExplorerRecord | null>(null);

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
        next.set(`f.${name}`, Array.isArray(value) ? value.join(",") : String(value));
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
          <Badge count={activeFilterCount} size="small">
            <Button icon={<BuildOutlined />} onClick={() => setAdvancedOpen(true)}>Advanced</Button>
          </Badge>
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
        {!resource && catalogue.isLoading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : !resource ? (
          <Empty description="Your role has no explorable datasets" />
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
            onPreview={setPreview}
          />
        )}
      </Card>

      {resource && request && (
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

      <RecordPreview
        open={Boolean(preview)}
        record={preview}
        result={results.data}
        onClose={() => setPreview(null)}
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
