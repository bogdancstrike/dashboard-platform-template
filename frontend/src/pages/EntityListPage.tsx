import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Select, Skeleton, Space, Tag, Typography } from "antd";
import { ClearOutlined, SearchOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { explorerApi, type ExplorerRequest, type ExplorerResource } from "@/api/explorer";
import { ExplorerResults, type ExplorerRecord } from "@/components/explorer/ExplorerResults";
import { RecordPreview } from "@/components/explorer/RecordPreview";
import { ExportButton } from "@/components/ExportButton";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Input } from "antd";

const { Text } = Typography;

/**
 * Every entity list, from one page (§7).
 *
 * There is exactly one of these because there is exactly one declaration
 * behind them: `services/explorer.py` says what a ticket is, and the list, its
 * filters, its facets, its sort and its export all follow from that. Eleven
 * hand-written list pages is eleven places for "case-insensitive" to be
 * decided differently.
 *
 * It is not the Data Explorer, and the difference is deliberate. The explorer
 * is where somebody goes to *ask a question* — arbitrary conditions, four
 * result modes, saved searches. This is where somebody goes to *work*: the
 * entity's own columns, its facets across the top, and a row that opens the
 * record rather than a drawer. The link to the explorer is there for when the
 * question outgrows the page.
 */
export function EntityListPage({ resourceKey }: { resourceKey: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const catalogue = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
  });
  const resource: ExplorerResource | undefined = catalogue.data?.items.find(
    (item) => item.key === resourceKey,
  );

  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("page_size") ?? 25) || 25;
  const term = params.get("q") ?? "";
  const sort = params.get("sort") ?? resource?.default_sort ?? "updated_at";
  const order = params.get("order") === "asc" ? "asc" : "desc";

  const [search, setSearch] = useState(term);
  const debounced = useDebouncedValue(search, 280);

  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    params.forEach((value, key) => {
      if (key.startsWith("f.") && value) out[key.slice(2)] = value;
    });
    return out;
  }, [params]);

  const set = (changes: Record<string, string | number | null>, replace = true) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(changes).forEach(([key, value]) => {
          if (value === null || value === "") next.delete(key);
          else next.set(key, String(value));
        });
        return next;
      },
      { replace },
    );
  };

  // The box is local so typing is never throttled by a URL write; the URL
  // catches up once the reader pauses. An effect, not a memo: navigating is a
  // side effect, and a memo that performs one runs twice under StrictMode.
  useEffect(() => {
    if (debounced !== term) set({ q: debounced || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => setSearch(term), [term]);

  const request = useMemo<ExplorerRequest | null>(
    () =>
      resource
        ? {
            resource_type: resource.key,
            query_text: term,
            filters,
            columns: resource.default_columns,
            page,
            page_size: pageSize,
            sort,
            order,
            facets: true,
          }
        : null,
    [resource, term, filters, page, pageSize, sort, order],
  );

  const results = useQuery({
    queryKey: ["entity-list", request],
    queryFn: ({ signal }) => explorerApi.query(request!, signal),
    enabled: Boolean(request),
    placeholderData: (previous) => previous,
  });

  const [preview, setPreview] = useState<ExplorerRecord | null>(null);

  const facetFields = (resource?.fields ?? []).filter((field) => field.facet);
  const filterCount = Object.keys(filters).length + (term ? 1 : 0);
  const clearFilters = () => setParams(new URLSearchParams());

  usePageCommands(`entity:${resourceKey}`, [
    {
      id: `${resourceKey}.explore`,
      label: `Ask a wider question about ${resource?.label.toLowerCase() ?? resourceKey}`,
      keywords: "explore advanced search conditions",
      run: () => navigate(`/explore?resource=${resourceKey}`),
    },
    {
      id: `${resourceKey}.clear`,
      label: "Clear the filters on this list",
      keywords: "reset",
      run: clearFilters,
    },
  ]);

  if (catalogue.isLoading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  if (!resource) {
    // Either the catalogue does not carry this dataset, or the caller may not
    // read it — and the API is what decides that, not the menu.
    return (
      <Alert
        type="warning"
        showIcon
        message="That record type is not available to you"
        description={
          catalogue.error instanceof ApiError ? (
            <Space direction="vertical" size={4}>
              {catalogue.error.missingPermissions.length > 0 && (
                <Text type="secondary">
                  Missing: {catalogue.error.missingPermissions.join(", ")}
                </Text>
              )}
              <Text code copyable={{ text: catalogue.error.correlationId }}>
                {catalogue.error.correlationId}
              </Text>
            </Space>
          ) : (
            "It may have been renamed, or your role may not include it."
          )
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={resource.label}
        subtitle={resource.description}
        tag={
          results.data ? (
            <Tag color="blue" data-testid="entity-total">
              {results.data.total.toLocaleString()} of{" "}
              {resource.record_count.toLocaleString()}
            </Tag>
          ) : undefined
        }
        actions={
          <>
            {filterCount > 0 && (
              <Button icon={<ClearOutlined />} onClick={clearFilters}>
                Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
              </Button>
            )}
            <Button
              icon={<SearchOutlined />}
              onClick={() => navigate(`/explore?resource=${resource.key}`)}
            >
              Ask a wider question
            </Button>
            <ExportButton
              disabled={!request}
              onExport={(format) => explorerApi.export({ ...request!, page: 1, format })}
            />
          </>
        }
      />

      <Card size="small" className="nu-filter-bar">
        <Space wrap size={8} align="center">
          <Input.Search
            allowClear
            placeholder={`Search ${resource.label.toLowerCase()}`}
            aria-label={`Search ${resource.label.toLowerCase()}`}
            style={{ width: 280 }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {/* Facets rather than free selects: the options and their counts
              come from the rows that are actually reachable under the other
              filters, so the menu can never offer a value that finds nothing. */}
          {facetFields.map((field) => {
            const options = results.data?.facets[field.name] ?? [];
            return (
              <Select
                key={field.name}
                allowClear
                showSearch
                placeholder={field.label}
                aria-label={field.label}
                style={{ minWidth: 170 }}
                value={filters[field.name] ?? undefined}
                options={options.map((facet) => ({
                  value: facet.value,
                  label: `${facet.value} · ${facet.count.toLocaleString()}`,
                }))}
                onChange={(value?: string) =>
                  set({ [`f.${field.name}`]: value ?? null, page: null })
                }
              />
            );
          })}
        </Space>
      </Card>

      {results.isError && (
        <Alert
          className="nu-block"
          type="error"
          showIcon
          message={
            results.error instanceof ApiError
              ? results.error.message
              : `Could not load ${resource.label.toLowerCase()}`
          }
          description={
            results.error instanceof ApiError ? (
              <Text code copyable={{ text: results.error.correlationId }}>
                {results.error.correlationId}
              </Text>
            ) : undefined
          }
          action={
            <Button size="small" onClick={() => void results.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      <Card size="small" className="nu-block">
        <ExplorerResults
          result={results.data}
          view="table"
          loading={results.isLoading}
          onPage={(next, size) =>
            set({ page: next === 1 ? null : next, page_size: size === 25 ? null : size })
          }
          onSort={(field, direction) => set({ sort: field, order: direction })}
          onPreview={setPreview}
          // A row on a working list opens the record; the preview button
          // beside it is still there for a look without leaving the page.
          onOpen={(record) => navigate(`${resource.path}/${record.id}`)}
        />
      </Card>

      <RecordPreview
        open={Boolean(preview)}
        record={preview}
        result={results.data}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

export default EntityListPage;
