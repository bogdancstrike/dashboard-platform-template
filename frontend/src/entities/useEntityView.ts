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
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  explorerApi,
  type ExplorerRequest,
  type ExplorerResource,
  type SavedSearch,
} from "@/api/explorer";
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

  /**
   * The address itself, for the state a page carries that the contract does
   * not — a previewed row (§64), a chosen tab.
   *
   * Read-only on purpose: writing goes through `set`, so one place applies
   * the "changing a question returns to page one" rule.
   */
  params: URLSearchParams;
  /** The saved searches for this dataset the reader can see (§46). */
  views: ReturnType<typeof useSavedViews>;
  /** The one the address says is applied, if any. */
  viewId: string | null;
  /** Show what a saved search asked for — or, with `null`, everything again. */
  applyView: (view: SavedSearch | null) => void;
}

/**
 * The keys that make an address a *question* rather than just a page (§46).
 *
 * `f.`-prefixed filters count too, and are matched by prefix rather than
 * listed, because which fields a dataset can be filtered by is the server's
 * declaration and not something this file gets to know.
 */
const VIEW_KEYS: readonly string[] = ["q", "sort", "order", "page", "page_size", "view"];

/** Whether the address already says what to show. */
export function statesItsOwnView(params: URLSearchParams): boolean {
  return Array.from(params.keys()).some(
    (key) => key.startsWith("f.") || VIEW_KEYS.includes(key),
  );
}

/**
 * The address that shows what a saved search asked for.
 *
 * The whole set, not a patch: applying a saved view must not leave a filter
 * from the previous one in place, because the reader would then be looking at
 * a question nobody saved and no name describes.
 */
export function paramsForView(view: SavedSearch): URLSearchParams {
  const next = new URLSearchParams();
  if (view.query_text) next.set("q", view.query_text);
  Object.entries(view.filters).forEach(([field, value]) => {
    // Scalars only. A search saved from the Data Explorer may carry a filter
    // value of any shape, and an address holding `[object Object]` is a filter
    // that matches nothing under a name that promises rows.
    if (typeof value === "string" && value === "") return;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return;
    next.set(`f.${field}`, String(value));
  });
  next.set("sort", view.sort);
  next.set("order", view.order);
  next.set("page_size", String(view.page_size));
  // So the picker can say which view is on screen, and "update this view" has
  // something to update.
  next.set("view", view.id);
  return next;
}

/**
 * Whether a saved search can be shown on an entity list at all (§46).
 *
 * A nested tree of rules is expressible in the Data Explorer's builder and not
 * in a row of facet selects. Applying one as "the handful of filters it is
 * not" would show a different set of rows under its name, so a list offers it
 * as a link to `/explore` instead.
 */
export function fitsAList(view: SavedSearch): boolean {
  return !view.condition_tree || view.rule_count === 0;
}

/** The reader's own default for this dataset — never somebody else's. */
export function defaultView(views: SavedSearch[]): SavedSearch | undefined {
  // `can_edit` is the serializer's word for "you own this": a colleague's
  // shared search marked default by its author decides what *their* list opens
  // with, not everybody's.
  return views.find((view) => view.is_default && view.can_edit && fitsAList(view));
}

function useSavedViews(resourceKey: string) {
  return useQuery({
    // The Data Explorer's drawer and its save dialog read and invalidate this
    // exact key. Sharing it rather than keeping a parallel one is why saving a
    // view in one place shows up in the other without either knowing.
    queryKey: ["saved-searches", resourceKey],
    queryFn: ({ signal }) => explorerApi.saved(resourceKey, signal),
    staleTime: 30_000,
  });
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

  // Saved views for this dataset, and the reader's own default applied on
  // arrival (§46). Once per mount, and only when the address says nothing:
  // a link somebody pasted, a filter chip they clicked, or a list they just
  // cleared all beat a default they set weeks ago.
  const views = useSavedViews(resourceKey);
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current || !views.data) return;
    settled.current = true;
    if (statesItsOwnView(params)) return;
    const mine = defaultView(views.data.items);
    if (mine) setParams(paramsForView(mine), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.data]);

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
    params,
    views,
    viewId: params.get("view"),
    // `replace`, like every other change here: a saved view is a way of
    // looking at a list, and six of them in the back button is not a history
    // anybody wanted.
    applyView: (view) =>
      setParams(view ? paramsForView(view) : new URLSearchParams(), { replace: true }),
  };
}
