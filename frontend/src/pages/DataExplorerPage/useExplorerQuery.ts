import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { explorerApi, type ExplorerRequest } from "@/api/explorer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { asView, parseFilters, parseTree, positiveInt } from "./explorerUrl";

/** The question in the address, as a request, and its answer. */
export function useExplorerQuery(params: URLSearchParams) {
  const catalogue = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.minute,
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
    queryKey: queryKeys.explorerResults(debouncedRequest),
    queryFn: ({ signal }) => explorerApi.query(debouncedRequest!, signal),
    enabled: Boolean(debouncedRequest),
    placeholderData: (previous) => previous,
  });
  // True from the keystroke, not from the request: during the debounce the
  // numbers on screen already answer a question nobody is asking any more, and
  // saying so is the difference between "thinking" and "apparently ignored me".
  const settling = results.isFetching || request !== debouncedRequest;

  return {
    catalogue, resources, requestedResource, resource, view, page, pageSize, queryText, tree, filters, columns,
    sort, order, groupBy, request, debouncedRequest, results, settling,
  };
}
