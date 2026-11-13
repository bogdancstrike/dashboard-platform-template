import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import { useNavigate, useSearchParams } from "react-router-dom";

import { usersApi, type UserQuery, type UserRow } from "@/api/users";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { applyParamChanges } from "@/hooks/useUrlState";
import { queryKeys } from "@/lib/queryKeys";

/** The directory's page, sort and filters in the address, the debounced search, and the read. */
export function useUsersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("page_size") ?? 25) || 25;
  const sort = params.get("sort") ?? "full_name";
  const order: "asc" | "desc" = params.get("order") === "desc" ? "desc" : "asc";
  const term = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const roleCode = params.get("role_code") ?? "";

  const [search, setSearch] = useState(term);
  const debounced = useDebouncedValue(search, 280);

  useEffect(() => setSearch(term), [term]);
  useEffect(() => {
    if (debounced !== term) set({ q: debounced || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const set = (changes: Record<string, string | number | null>, replace = true) => {
    setParams(
      (current) => applyParamChanges(current, changes),
      { replace },
    );
  };

  const query = useMemo<UserQuery>(
    () => ({
      page,
      page_size: pageSize,
      sort,
      order,
      q: term || undefined,
      status: status || undefined,
      role_code: roleCode || undefined,
    }),
    [page, pageSize, sort, order, term, status, roleCode],
  );

  const people = useQuery({
    queryKey: queryKeys.admin("users", query),
    queryFn: ({ signal }) => usersApi.list(query, signal),
    placeholderData: (previous) => previous,
  });

  const filterCount = (term ? 1 : 0) + (status ? 1 : 0) + (roleCode ? 1 : 0);
  const clearFilters = () => setParams(new URLSearchParams());

  usePageCommands("users", [
    {
      id: "users.suspended",
      label: "Show suspended accounts",
      keywords: "disabled locked",
      run: () => set({ status: "SUSPENDED", page: null }),
    },
    {
      id: "users.roles",
      label: "Open the permission matrix",
      keywords: "roles permissions",
      run: () => navigate("/admin/roles"),
    },
  ]);

  const onTableChange = (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<UserRow> | SorterResult<UserRow>[],
  ) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof single?.field === "string" ? single.field : sort;
    set({
      page: pagination.current === 1 ? null : (pagination.current ?? null),
      page_size: pagination.pageSize === 25 ? null : (pagination.pageSize ?? null),
      sort: single?.order ? field : null,
      order: single?.order === "descend" ? "desc" : null,
    });
  };

  return { navigate, setParams, page, pageSize, order, term, status, roleCode, search, setSearch, set, people, filterCount, clearFilters, onTableChange };
}
