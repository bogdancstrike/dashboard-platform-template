import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import { useSearchParams } from "react-router-dom";

import { auditApi, type AuditQuery, type AuditRow } from "@/api/audit";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { applyParamChanges } from "@/hooks/useUrlState";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** The ledger's filters, sort and page in the address, the open entry, and the reads. */
export function useAuditPage() {
  const [params, setParams] = useSearchParams();

  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("page_size") ?? 25) || 25;
  const sort = params.get("sort") ?? "occurred_at";
  const order: "asc" | "desc" = params.get("order") === "asc" ? "asc" : "desc";
  const term = params.get("q") ?? "";
  const actionParam = params.get("action") ?? "";
  const resultParam = params.get("result") ?? "";
  const resourceParam = params.get("resource_type") ?? "";
  const actor = params.get("actor_label") ?? "";
  const correlation = params.get("correlation_id") ?? "";
  const impersonated = params.get("impersonated") ?? "";
  const from = params.get("occurred_at_from") ?? "";
  const to = params.get("occurred_at_to") ?? "";
  const openEntry = params.get("entry") ?? "";

  const actions = useMemo(() => actionParam.split(",").filter(Boolean), [actionParam]);
  const results = useMemo(() => resultParam.split(",").filter(Boolean), [resultParam]);
  const resourceTypes = useMemo(() => resourceParam.split(",").filter(Boolean), [resourceParam]);

  const [search, setSearch] = useState(term);
  const debouncedSearch = useDebouncedValue(search, 280);

  useEffect(() => setSearch(term), [term]);

  useEffect(() => {
    if (debouncedSearch === term) return;
    set({ q: debouncedSearch || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const set = (changes: Record<string, string | number | null>, replace = true) => {
    setParams(
      (current) => applyParamChanges(current, changes),
      { replace },
    );
  };

  const catalogue = useQuery({
    queryKey: queryKeys.audit("catalog"),
    queryFn: ({ signal }) => auditApi.catalogue(signal),
    staleTime: STALE.long,
  });

  const query = useMemo<AuditQuery>(
    () => ({
      page,
      page_size: pageSize,
      sort,
      order,
      q: term || undefined,
      action: actionParam || undefined,
      result: resultParam || undefined,
      resource_type: resourceParam || undefined,
      actor_label: actor || undefined,
      correlation_id: correlation || undefined,
      impersonated: impersonated || undefined,
      occurred_at_from: from || undefined,
      occurred_at_to: to || undefined,
    }),
    [
      page, pageSize, sort, order, term, actionParam, resultParam,
      resourceParam, actor, correlation, impersonated, from, to,
    ],
  );

  const ledger = useQuery({
    queryKey: queryKeys.audit("ledger", query),
    queryFn: ({ signal }) => auditApi.list(query, signal),
    placeholderData: (previous) => previous,
  });

  const entry = useQuery({
    queryKey: queryKeys.audit("entry", openEntry),
    queryFn: ({ signal }) => auditApi.entry(openEntry, signal),
    enabled: Boolean(openEntry),
  });

  const filterCount =
    actions.length +
    results.length +
    resourceTypes.length +
    (term ? 1 : 0) +
    (actor ? 1 : 0) +
    (correlation ? 1 : 0) +
    (impersonated ? 1 : 0) +
    (from || to ? 1 : 0);

  const clearFilters = () => setParams(new URLSearchParams());

  usePageCommands("audit", [
    {
      id: "audit.denied",
      label: "Show refused and failed actions only",
      keywords: "denied failure security",
      run: () => set({ result: "DENIED,FAILURE", page: null }),
    },
    {
      id: "audit.impersonated",
      label: "Show actions taken while impersonating",
      keywords: "impersonation admin acting as",
      run: () => set({ impersonated: "true", page: null }),
    },
    {
      id: "audit.deletions",
      label: "Show deletions",
      keywords: "delete removed destructive",
      run: () => set({ action: "DELETE,BULK_DELETE", page: null }),
    },
    {
      id: "audit.clear",
      label: "Clear every audit filter",
      keywords: "reset",
      run: clearFilters,
    },
  ]);

  const resourceOptions = (ledger.data?.facets["resource_type"] ?? []).map((facet) => ({
    value: facet.value,
    label: `${facet.value} (${facet.count.toLocaleString()})`,
  }));

  const onTableChange = (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<AuditRow> | SorterResult<AuditRow>[],
  ) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof single?.field === "string" ? single.field : sort;
    set({
      page: pagination.current === 1 ? null : (pagination.current ?? null),
      page_size: pagination.pageSize === 25 ? null : (pagination.pageSize ?? null),
      sort: single?.order ? field : null,
      order: single?.order === "ascend" ? "asc" : null,
    });
  };

  return {
    page, pageSize, order, term, actions, results, resourceTypes, from, to, impersonated, openEntry, search, setSearch, set,
    catalogue, query, ledger, entry, filterCount, clearFilters, resourceOptions, onTableChange,
  };
}
