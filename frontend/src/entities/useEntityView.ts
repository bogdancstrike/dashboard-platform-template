/**
 * The data layer every entity page shares (§7, §71).
 *
 * The six entity pages look nothing alike on purpose — a kanban board, a
 * portfolio timeline, a triage queue and a fleet monitor are not one page with
 * different columns. What they *do* share is the contract underneath: the same
 * `Resource` declaration decides their fields, facets, sort and export, and
 * the same URL keys carry their state. That part lives here, once, so six
 * pages cannot disagree about what "filtered" means or where the filter is
 * written down.
 *
 * What this hook deliberately does **not** decide is presentation. It returns
 * data and the setters that change the URL; it has no opinion about lanes,
 * cards, gauges or bars. The moment it grows a `view` prop it has become the
 * generic page these six exist to replace.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { explorerApi, type ExplorerRequest, type ExplorerResource } from "@/api/explorer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDefaultPageSize } from "@/settings/PreferencesProvider";

export interface EntityView {
  /** The dataset declaration, once the catalogue has answered. */
  resource: ExplorerResource | undefined;
  catalogue: ReturnType<typeof useCatalogue>;
  /** The request both the list and the summary are built from. */
  request: ExplorerRequest | null;
  rows: ReturnType<typeof useRows>;
  insights: ReturnType<typeof useInsights>;

  /** URL-backed state. */
  page: number;
  pageSize: number;
  sort: string;
  order: "asc" | "desc";
  term: string;
  filters: Record<string, string>;
  filterCount: number;

  /** The search box's own value, which leads the URL by a debounce. */
  search: string;
  setSearch: (value: string) => void;

  set: (changes: Record<string, string | number | null>) => void;
  setFilter: (field: string, value: string | null) => void;
  clearFilters: () => void;
}

function useCatalogue() {
  return useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
  });
}

function useRows(request: ExplorerRequest | null) {
  return useQuery({
    queryKey: ["entity-rows", request],
    queryFn: ({ signal }) => explorerApi.query(request!, signal),
    enabled: Boolean(request),
    placeholderData: (previous) => previous,
  });
}

function useInsights(request: ExplorerRequest | null, enabled: boolean) {
  return useQuery({
    queryKey: ["entity-insights", request?.resource_type, request?.query_text, request?.filters],
    queryFn: ({ signal }) =>
      explorerApi.insights(
        {
          resource_type: request!.resource_type,
          query_text: request!.query_text,
          filters: request!.filters,
        },
        signal,
      ),
    // Keyed on the *question*, not the page: paging through a filtered list
    // must not refetch four aggregates that cannot have changed.
    enabled: enabled && Boolean(request),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export interface EntityViewOptions {
  /** Columns to fetch. Defaults to the resource's own. */
  columns?: string[];
  defaultSort?: string;
  defaultOrder?: "asc" | "desc";
  defaultPageSize?: number;
  /** Skip the aggregates on a page that shows none of them. */
  withInsights?: boolean;
}

export function useEntityView(
  resourceKey: string,
  options: EntityViewOptions = {},
): EntityView {
  const { withInsights = true } = options;
  const [params, setParams] = useSearchParams();

  const catalogue = useCatalogue();
  const resource = catalogue.data?.items.find((item) => item.key === resourceKey);

  // The reader's own default (§40), unless this page has a shape that needs
  // its own — a card grid of twenty-five is a ragged last row — and unless
  // they have already paged, which the URL records.
  const preferred = useDefaultPageSize();
  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize =
    Number(params.get("page_size") ?? options.defaultPageSize ?? preferred) || preferred;
  const term = params.get("q") ?? "";
  const sort = params.get("sort") ?? options.defaultSort ?? resource?.default_sort ?? "updated_at";
  const order = params.get("order") === "asc" ? "asc" : options.defaultOrder ?? "desc";

  const [search, setSearch] = useState(term);
  const debounced = useDebouncedValue(search, 280);

  /** `f.status=OPEN` in the URL is `{status: "OPEN"}` on the wire. */
  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    params.forEach((value, key) => {
      if (key.startsWith("f.") && value) out[key.slice(2)] = value;
    });
    return out;
  }, [params]);

  const set = (changes: Record<string, string | number | null>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(changes).forEach(([key, value]) => {
          if (value === null || value === "") next.delete(key);
          else next.set(key, String(value));
        });
        return next;
      },
      { replace: true },
    );
  };

  // An effect rather than a memo: navigating is a side effect, and a memo that
  // performs one runs twice under StrictMode.
  useEffect(() => {
    if (debounced !== term) set({ q: debounced || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => setSearch(term), [term]);

  const columnKey = (options.columns ?? resource?.default_columns ?? []).join(",");
  const request = useMemo<ExplorerRequest | null>(
    () =>
      resource
        ? {
            resource_type: resource.key,
            query_text: term,
            filters,
            columns: columnKey ? columnKey.split(",") : resource.default_columns,
            page,
            page_size: pageSize,
            sort,
            order,
            facets: true,
          }
        : null,
    [resource, term, filters, columnKey, page, pageSize, sort, order],
  );

  return {
    resource,
    catalogue,
    request,
    rows: useRows(request),
    insights: useInsights(request, withInsights),
    page,
    pageSize,
    sort,
    order,
    term,
    filters,
    filterCount: Object.keys(filters).length + (term ? 1 : 0),
    search,
    setSearch,
    set,
    setFilter: (field, value) => set({ [`f.${field}`]: value, page: null }),
    clearFilters: () => setParams(new URLSearchParams()),
  };
}
