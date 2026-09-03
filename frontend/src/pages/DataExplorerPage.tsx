import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Popover,
  Segmented,
  Select,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import {
  ApartmentOutlined,
  BarsOutlined,
  BuildOutlined,
  ClearOutlined,
  ColumnHeightOutlined,
  FolderOpenOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";

import {
  explorerApi,
  type ExplorerRequest,
  type ExplorerResource,
  type ExplorerView,
  type SavedSearch,
} from "@/api/explorer";
import { AdvancedQueryBuilder } from "@/components/explorer/AdvancedQueryBuilder";
import { ExplorerResults } from "@/components/explorer/ExplorerResults";
import { SaveSearchModal, SavedSearchDrawer } from "@/components/explorer/SavedSearchControls";
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
  }) : null, [resource, queryText, tree, filters, columns, page, pageSize, sort, order]);
  const debouncedRequest = useDebouncedValue(request, 280);
  const results = useQuery({
    queryKey: ["explorer-results", debouncedRequest],
    queryFn: ({ signal }) => explorerApi.query(debouncedRequest!, signal),
    enabled: Boolean(debouncedRequest),
    placeholderData: (previous) => previous,
  });

  const savedOpen = params.get("panel") === "saved";
  const set = (changes: Record<string, string | number | null>, replace = true) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    });
    setParams(next, { replace });
  };

  const chooseResource = (key: string) => {
    const next = new URLSearchParams();
    next.set("resource", key);
    setParams(next);
  };

  const setFilter = (name: string, values: string[]) => {
    set({ [`f.${name}`]: values.length ? values.join(",") : null, page: null });
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
    condition_tree: request.condition_tree ?? null,
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
        tag={results.data && <Tag color="blue">{results.data.total.toLocaleString()} matches</Tag>}
        actions={
          <>
            <Button icon={<FolderOpenOutlined />} onClick={() => set({ panel: "saved" })}>
              Saved searches
            </Button>
            <Button type="primary" icon={<SaveOutlined />} disabled={!request} onClick={() => setSaveOpen(true)}>
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
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={`Search ${resource?.label.toLowerCase() ?? "records"}…`}
            value={queryText}
            onChange={(event) => set({ q: event.target.value, page: null })}
          />
          <Badge count={activeFilterCount} size="small">
            <Button icon={<BuildOutlined />} onClick={() => setAdvancedOpen(true)}>Advanced</Button>
          </Badge>
          <ColumnPicker resource={resource} value={columns} onChange={(next) => set({ columns: next.join(","), page: null })} />
          {activeFilterCount > 0 && <Button icon={<ClearOutlined />} onClick={clearQuestion}>Clear</Button>}
        </div>

        {results.data && Object.keys(results.data.facets).length > 0 && (
          <div className="nu-facets" aria-label="Dataset filters">
            {Object.entries(results.data.facets).slice(0, 5).map(([name, values]) => {
              const field = resource?.fields.find((candidate) => candidate.name === name);
              return (
                <Select
                  key={name}
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  aria-label={field?.label ?? name}
                  placeholder={field?.label ?? name}
                  value={asArray(filters[name])}
                  onChange={(next) => setFilter(name, next)}
                  options={values.map((item) => ({ value: item.value, label: `${item.value} · ${item.count}` }))}
                />
              );
            })}
          </div>
        )}
      </Card>

      <Card
        className="nu-explorer-results"
        title={<Space><BarsOutlined /><span>{resource?.label ?? "Results"}</span>{results.isFetching && <Text type="secondary">Updating…</Text>}</Space>}
        extra={
          <Segmented
            size="small"
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
            onPage={(nextPage, nextSize) => set({ page: nextPage, page_size: nextSize })}
            onSort={(field, direction) => set({ sort: field, order: direction, page: null })}
          />
        )}
      </Card>

      <Drawer
        open={advancedOpen}
        width="min(920px, 94vw)"
        title={<Space><ApartmentOutlined />Advanced conditions</Space>}
        onClose={() => setAdvancedOpen(false)}
        extra={results.data && <Statistic value={results.data.total} suffix="matches" valueStyle={{ fontSize: 16 }} />}
      >
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message="Build groups with AND, OR and NOT"
          description="Incomplete rules are ignored while you work. Results refresh automatically after a short pause."
        />
        {resource && (
          <AdvancedQueryBuilder
            key={resource.key}
            fields={resource.fields}
            value={tree}
            onChange={(next) => set({ tree: JSON.stringify(next), page: null })}
          />
        )}
        <Card size="small" title="Query inspector" className="nu-query-inspector">
          <pre>{results.data?.condition_text?.trim() || "All records"}</pre>
          <Text type="secondary">Rendered by the backend from the same tree compiled into SQL.</Text>
        </Card>
      </Drawer>

      <SavedSearchDrawer
        open={savedOpen}
        resourceType={resource?.key ?? ""}
        onClose={() => set({ panel: null })}
        onOpen={openSaved}
      />
      {saveValue && (
        <SaveSearchModal
          open={saveOpen}
          value={saveValue}
          onClose={() => setSaveOpen(false)}
          onSaved={(saved) => set({ saved: saved.id })}
        />
      )}
    </>
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

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined || value === null || value === "" ? [] : [String(value)];
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
